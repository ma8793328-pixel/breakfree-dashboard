// AI routes for the Workers build: same engine (aiCoach.js runs unmodified),
// but the context is built from D1 and the premium streaming reply is emitted
// over an SSE ReadableStream.

import { coachReply, reflectOnJournal, urgeInsight } from './aiCoach.js';
import { computeStats, todayKey } from './stats.js';
import { milestoneFor } from './recovery.js';
import { chat, streamChat, buildMessages } from './openai.js';
import { loadMemory, saveMemory, memoryToPrompt } from './coachMemory.js';

export async function buildCoachCtx(env, habit) {
  const checkins = (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all())
    .results;
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
  const badges = (await env.DB.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').bind(habit.id).all())
    .results;
  const urges = (await env.DB.prepare('SELECT intensity, trigger, resisted, logged_at FROM urges WHERE habit_id = ? ORDER BY logged_at').bind(habit.id).all())
    .results;
  const journals = (await env.DB.prepare('SELECT id, date, content FROM journals WHERE habit_id = ? ORDER BY date').bind(habit.id).all())
    .results;
  const dailyCheckin = (await env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?').bind(habit.id, todayKey()).all())
    .results[0] || null;
  const dailyRows = (await env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date DESC LIMIT 14').bind(habit.id).all())
    .results
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
    dailyCheckin,
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

export function registerAiRoutes(app, { env, userOf }) {
  app.post('/api/ai/chat', async (c) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    if (!body.message || !String(body.message).trim()) return c.json({ error: 'Message cannot be empty.' }, 400);
    const ctx = { ...(await buildCoachCtx(env(c), habit)), seed: Number(body.seed || 0) };
    const history = historyFromBody(body);
    try {
      const memory = await loadMemory(env(c), u.id, habit.id);
      const memoryPrompt = memoryToPrompt(memory);
      const text = await chat(env(c), buildMessages(body.message, ctx, history, memoryPrompt));
      await saveMemory(env(c), u.id, habit.id, body.message);
      return c.json({ text, quickReplies: [] });
    } catch (e) {
      console.error('AI chat failed, falling back to canned reply:', e.message, e.stack);
      return c.json(coachReply(String(body.message), ctx));
    }
  });

  app.post('/api/ai/chat/stream', async (c) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    if (!body.message || !String(body.message).trim()) return c.json({ error: 'Message cannot be empty.' }, 400);
    const ctx = { ...(await buildCoachCtx(env(c), habit)), seed: Number(body.seed || 0) };
    const history = historyFromBody(body);
    let memory;
    try {
      memory = await loadMemory(env(c), u.id, habit.id);
    } catch {
      memory = null;
    }
    const memoryPrompt = memoryToPrompt(memory);
    const messages = buildMessages(body.message, ctx, history, memoryPrompt);

    let closed = false;
    let timer = null;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (payload) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        (async () => {
          try {
            await streamChat(env(c), messages, (delta) => send({ delta }), () => {
              send({ done: true, quickReplies: [] });
              controller.close();
            });
            await saveMemory(env(c), u.id, habit.id, body.message);
          } catch (e) {
            console.error('AI stream failed, falling back to canned reply:', e.message, e.stack);
            const reply = coachReply(String(body.message), ctx);
            const words = reply.text.split(/(\s+)/);
            let i = 0;
            timer = setInterval(() => {
              if (closed || i >= words.length) {
                clearInterval(timer);
                if (!closed && i >= words.length) {
                  send({ done: true, quickReplies: reply.quickReplies || [], fallback: true });
                  controller.close();
                }
                return;
              }
              send({ delta: words[i++] });
            }, 32);
          }
        })();
      },
      cancel() {
        closed = true;
        if (timer) clearInterval(timer);
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  });

  app.post('/api/ai/reflect', async (c) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    if (!body.content || !String(body.content).trim()) return c.json({ error: 'Journal entry cannot be empty.' }, 400);
    const text = reflectOnJournal(String(body.content), await buildCoachCtx(env(c), habit));
    return c.json({ text });
  });

  app.post('/api/ai/urge-insights', async (c) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    const ctx = await buildCoachCtx(env(c), habit);
    return c.json({ insight: urgeInsight(ctx.urges, ctx) });
  });

  app.post('/api/ai/journal-search', async (c) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    const query = String(body.query || '').trim();
    const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
    if (!tokens) return c.json({ results: [] });
    const rows = await env(c).DB.prepare(
      `SELECT j.id, j.date, j.content FROM journals_fts f
       JOIN journals j ON j.id = f.rowid
       WHERE f.journals_fts MATCH ?
       ORDER BY rank LIMIT 20`
    ).bind(tokens).all();
    return c.json({ results: rows.results });
  });

  app.post('/api/ai/save-journal', async (c) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    const content = String(body.content || '').trim();
    if (!content) return c.json({ error: 'Content cannot be empty.' }, 400);
    const now = new Date().toISOString().slice(0, 10);
    const info = await env(c).DB.prepare('INSERT INTO journals (habit_id, date, content) VALUES (?, ?, ?)').bind(habit.id, now, content).run();
    const row = await env(c).DB.prepare('SELECT id, date, content FROM journals WHERE id = ?').bind(info.meta.last_row_id).first();
    return c.json({ journal: row });
  });
}
