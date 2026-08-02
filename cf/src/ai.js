// AI routes for the Workers build: same engine (aiCoach.js runs unmodified),
// but the context is built from D1 and the premium streaming reply is emitted
// over an SSE ReadableStream.

import { coachReply, reflectOnJournal, urgeInsight } from './aiCoach.js';
import { computeStats, todayKey } from './stats.js';

export async function buildCoachCtx(env, habit) {
  const checkins = (await env.DB.prepare('SELECT date, status FROM checkins WHERE habit_id = ?').bind(habit.id).all())
    .results;
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time);
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
    dailyCheckins: dailyRows,
  };
}

async function isPremium(env, userId) {
  const row = await env.DB.prepare('SELECT plan FROM subscriptions WHERE user_id = ?').bind(userId).first();
  return !!row && row.plan !== 'free';
}

function sseStream(words, quickReplies) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      let i = 0;
      let done = false;
      const timer = setInterval(() => {
        if (done) return;
        if (i >= words.length) {
          done = true;
          clearInterval(timer);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, quickReplies: quickReplies || [] })}\n\n`));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: words[i++] })}\n\n`));
      }, 32);
      controller._timer = timer;
    },
    cancel() {
      clearInterval(this._timer);
    },
  });
}

export function registerAiRoutes(app, { env, userOf }) {
  const needPremium = async (c, next) => {
    const u = userOf(c);
    if (!u) return c.json({ error: 'Not authenticated' }, 401);
    if (!(await isPremium(env(c), u.id))) {
      return c.json({ error: 'This is a Premium feature.', code: 'PREMIUM_REQUIRED' }, 402);
    }
    await next();
  };

  app.post('/api/ai/chat', needPremium, async (c) => {
    const u = userOf(c);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    if (!body.message || !String(body.message).trim()) return c.json({ error: 'Message cannot be empty.' }, 400);
    const ctx = { ...(await buildCoachCtx(env(c), habit)), seed: Number(body.seed || 0) };
    return c.json(coachReply(String(body.message), ctx));
  });

  app.post('/api/ai/chat/stream', needPremium, async (c) => {
    const u = userOf(c);
    const body = await c.req.json().catch(() => ({}));
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(body.habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    if (!body.message || !String(body.message).trim()) return c.json({ error: 'Message cannot be empty.' }, 400);
    const ctx = { ...(await buildCoachCtx(env(c), habit)), seed: Number(body.seed || 0) };
    const reply = coachReply(String(body.message), ctx);
    const words = reply.text.split(/(\s+)/);
    return new Response(sseStream(words, reply.quickReplies || []), {
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

  app.post('/api/ai/urge-insights', needPremium, async (c) => {
    const u = userOf(c);
    const habit = await env(c).DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number((await c.req.json().catch(() => ({}))).habitId), u.id).first();
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    const ctx = await buildCoachCtx(env(c), habit);
    return c.json({ insight: urgeInsight(ctx.urges, ctx) });
  });

  app.post('/api/ai/journal-search', needPremium, async (c) => {
    const u = userOf(c);
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
}