import { db } from './db.js';
import { computeStats, todayKey } from './stats.js';
import { milestoneFor } from './recovery.js';
import { coachReply, reflectOnJournal, urgeInsight } from './aiCoach.js';
import { chat, streamChat, buildMessages } from './openai.js';
import { loadMemory, saveMemory, memoryToPrompt } from './coachMemory.js';

export function buildCoachCtx(habit) {
  const checkins = db.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').all(habit.id);
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
  const badges = db.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').all(habit.id);
  const urges = db
    .prepare('SELECT intensity, trigger, resisted, logged_at FROM urges WHERE habit_id = ? ORDER BY logged_at')
    .all(habit.id);
  const journals = db.prepare('SELECT id, date, content FROM journals WHERE habit_id = ? ORDER BY date').all(habit.id);
  const dailyCheckin = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?')
    .get(habit.id, todayKey());
  const dailyCheckins = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date DESC LIMIT 14')
    .all(habit.id)
    .reverse();
  const { current: currentMilestone, next: nextMilestone } = milestoneFor(habit.name, stats.totalClean);
  return {
    habitName: habit.name,
    streak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    totalClean: stats.totalClean,
    totalSlips: stats.totalSlips,
    todayStatus: stats.todayStatus,
    badges,
    urges,
    journals,
    dailyCheckin: dailyCheckin || null,
    dailyCheckins,
    currentMilestone,
    nextMilestone,
  };
}

function historyFromBody(body) {
  const raw = Array.isArray(body.history) ? body.history : [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'coach'))
    .map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', text: String(m.text || '') }))
    .slice(-10);
}

export function registerAiRoutes(app, { requireAuth, habitForUser }) {
  // Chat — free for all users.
  app.post('/api/ai/chat', requireAuth, async (req, res) => {
    const { habitId, message, seed, history } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    const ctx = { ...buildCoachCtx(habit), seed: Number(seed) || 0 };
    try {
      const memory = loadMemory(db, req.user.id, habit.id);
      const memoryPrompt = memoryToPrompt(memory);
      const text = await chat(buildMessages(message, ctx, historyFromBody({ history }), memoryPrompt));
      saveMemory(db, req.user.id, habit.id, message);
      res.json({ text, quickReplies: [] });
    } catch (e) {
      console.error('AI chat error:', e.message);
      const reply = coachReply(message, ctx);
      res.json(reply);
    }
  });

  // Chat with real-time streaming — free for all users.
  app.post('/api/ai/chat/stream', requireAuth, (req, res) => {
    const { habitId, message, seed, history } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    const ctx = { ...buildCoachCtx(habit), seed: Number(seed) || 0 };
    const memory = loadMemory(db, req.user.id, habit.id);
    const memoryPrompt = memoryToPrompt(memory);
    const messages = buildMessages(message, ctx, historyFromBody({ history }), memoryPrompt);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
    };
    res.on('close', close);

    const send = (payload) => {
      if (!closed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    (async () => {
      try {
        await streamChat(messages, (delta) => send({ delta }), () => {
          send({ done: true, quickReplies: [] });
          res.end();
        });
        saveMemory(db, req.user.id, habit.id, message);
      } catch (e) {
        console.error('AI stream error:', e.message);
        if (!closed) {
          saveMemory(db, req.user.id, habit.id, message);
          const reply = coachReply(message, ctx);
          const words = reply.text.split(/(\s+)/);
          let i = 0;
          const timer = setInterval(() => {
            if (closed || i >= words.length) {
              clearInterval(timer);
              if (!closed && i >= words.length) {
                send({ done: true, quickReplies: reply.quickReplies || [], fallback: true });
                res.end();
              }
              return;
            }
            send({ delta: words[i++] });
          }, 32);
          res.on('close', () => clearInterval(timer));
        }
      }
    })();
  });

  // Journal reflection — free.
  app.post('/api/ai/reflect', requireAuth, (req, res) => {
    const { habitId, content } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Journal entry cannot be empty.' });
    }
    res.json({ text: reflectOnJournal(String(content), buildCoachCtx(habit)) });
  });

  // Urge insights — free.
  app.post('/api/ai/urge-insights', requireAuth, (req, res) => {
    const { habitId } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    const ctx = buildCoachCtx(habit);
    res.json({ insight: urgeInsight(ctx.urges, ctx) });
  });

  // Journal search — free. Finds relevant past entries via FTS so the
  // "AI" can ground its replies in the user's own history.
  app.post('/api/ai/journal-search', requireAuth, (req, res) => {
    const { habitId, query } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: 'Search query cannot be empty.' });
    }
    const tokens = String(query)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
    if (!tokens) return res.json({ results: [] });
    const rows = db
      .prepare(
        `SELECT j.id, j.date, j.content FROM journals_fts f
         JOIN journals j ON j.id = f.rowid
         JOIN habits h ON h.id = j.habit_id
         WHERE h.user_id = ? AND journals_fts MATCH ?
         ORDER BY rank LIMIT 20`
      )
      .all(req.user.id, tokens);
    res.json({ results: rows });
  });

  app.post('/api/ai/save-journal', requireAuth, (req, res) => {
    const { habitId, content } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    const text = String(content || '').trim();
    if (!text) return res.status(400).json({ error: 'Content cannot be empty.' });
    const now = todayKey();
    const info = db
      .prepare('INSERT INTO journals (habit_id, date, content) VALUES (?, ?, ?)')
      .run(habit.id, now, text);
    const row = db.prepare('SELECT id, date, content FROM journals WHERE id = ?').get(info.lastInsertRowid);
    res.json({ journal: row });
  });
}
