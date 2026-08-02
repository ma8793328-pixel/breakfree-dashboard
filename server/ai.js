import { db } from './db.js';
import { computeStats, todayKey } from './stats.js';
import { coachReply, reflectOnJournal, urgeInsight } from './aiCoach.js';

export function buildCoachCtx(habit) {
  const checkins = db.prepare('SELECT date, status FROM checkins WHERE habit_id = ?').all(habit.id);
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time);
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
  };
}

export function registerAiRoutes(app, { requireAuth, requirePremium, habitForUser }) {
  // Chat — premium only. The engine runs here (no external AI APIs).
  app.post('/api/ai/chat', requireAuth, requirePremium, (req, res) => {
    const { habitId, message, seed } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    const reply = coachReply(message, { ...buildCoachCtx(habit), seed: Number(seed) || 0 });
    res.json(reply);
  });

  // Chat with real-time streaming — premium only. Same engine, but the reply is
  // written out word by word over SSE so the coach feels live.
  app.post('/api/ai/chat/stream', requireAuth, requirePremium, (req, res) => {
    const { habitId, message, seed } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    const reply = coachReply(message, { ...buildCoachCtx(habit), seed: Number(seed) || 0 });
    const words = reply.text.split(/(\s+)/);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let i = 0;
    let closed = false;
    let timer = null;
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
    };
    // Note: only res 'close' means the client disconnected. req 'close' fires
    // as soon as the request body has been read, which would kill the stream.
    res.on('close', close);

    const send = (payload) => {
      if (!closed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    // A beat of "thinking" before the first word, then stream at typing pace.
    const kickoff = setTimeout(() => {
      if (closed) return;
      send({ thinking: true });
      timer = setInterval(() => {
        if (closed || i >= words.length) {
          if (timer) clearInterval(timer);
          if (!closed && i >= words.length) {
            send({ done: true, quickReplies: reply.quickReplies || [] });
            res.end();
          }
          return;
        }
        const piece = words[i++];
        send({ delta: piece });
      }, 32);
    }, 450);

    res.on('close', () => clearTimeout(kickoff));
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

  // Urge insights — premium only.
  app.post('/api/ai/urge-insights', requireAuth, requirePremium, (req, res) => {
    const { habitId } = req.body || {};
    const habit = habitForUser(Number(habitId), req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found.' });
    const ctx = buildCoachCtx(habit);
    res.json({ insight: urgeInsight(ctx.urges, ctx) });
  });

  // Journal search — premium only. Finds relevant past entries via FTS so the
  // "AI" can ground its replies in the user's own history.
  app.post('/api/ai/journal-search', requireAuth, requirePremium, (req, res) => {
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
}
