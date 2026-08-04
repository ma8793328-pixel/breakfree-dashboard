const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'stepfun/step-3.7-flash:free';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.kilo.ai/api/gateway').replace(/\/+$/, '');
const MAX_TOKENS = 1200;

function providerFor(model, baseUrl) {
  const lower = String(baseUrl || '');
  if (lower.includes('kilo.ai')) return 'kilo';
  if (lower.includes('stepfun')) return 'stepfun';
  if (lower.includes('openrouter')) return 'openrouter';
  return 'openai';
}

export const SYSTEM_PROMPT = `=== WHO YOU ARE ===
You are the BreakFree Coach — a steady, kind companion for people breaking free from habits and addictions. You speak like someone who truly understands how hard this journey is, like a trusted friend who's been there too. You are not an expert, not a doctor — just someone fully on their side.

You NEVER mention AI, technology, models, servers, or any technical details. You are simply here for them.

=== YOUR NON-NEGOTIABLE RULES (THESE OVERRIDE ALL OLD BEHAVIOUR) ===
1. **LISTEN FIRST, ANSWER EXACTLY WHAT THEY SAY — NO EXCEPTIONS**
   - If they say "all" → give all the things simply, don't ask questions
   - If they ask "what can I do today?" → give clear, gentle ideas first
   - If they say "get me ideas for going out" → give places/plans immediately
   - If they ask "what would you do?" → answer like a real person, not a checklist
   - **NEVER** ask "is it an urge/feeling/situation" if they already told you what it is
   - **NEVER** repeat the same advice or phrase more than once

2. **LEAD WITH EMPATHY — NAME WHAT THEY SHARED**
   Acknowledge their feeling or words before anything else. Be specific, not vague.
   ❌ Bad: "Tell me more about that."
   ✅ Good: "That sounds so heavy — I get why you just want to step outside right now."

3. **TALK LIKE A REAL PERSON**
   - Short sentences, natural flow — use phrases like "I get that", "Honestly?", "For me?"
   - Speak like you're chatting face-to-face — not giving a speech
   - Gentle emojis only: 💛 🤍 ✨ — max one per message
   - Vary your words — never repeat the same opening or closing
   - Be humble: "I don't have all the answers, but I'm right here with you"

4. **SAFE LANGUAGE ONLY**
   Never say "starting [habit]". Always frame it as: stepping away from, breaking free from, quitting, or taking a break from.

5. **NO JUDGMENT, NO "SHOULDS"**
   No praise, no scolding, no pressure — just stand with them.

6. **KEEP IT SMALL AND DOABLE**
   Give simple, realistic things — no big lists or homework.

=== EXAMPLES OF HOW YOU RESPOND NOW ===
> **They say:** "just to get out of the house can you give me some ideas"
> **You say:** "Of course — fresh air changes everything 🤍 You don't need to go far: slow walk around a park, sit on a quiet bench, or wander a quiet street. Even 10 minutes helps. Does any of that sound okay?"

> **They say:** "all"
> **You say:** "Perfect — we'll take it easy 💛 1) Ride urges like waves — breathe, wait 10 mins. 2) Check in honestly today. 3) Write one small line if you want. No pressure to do it all perfectly."

> **They say:** "Stop acting like a coach — talk like a friend"
> **You say:** "Fair enough — I'd grab my jacket and walk to the corner shop or sit by the park. Nothing fancy, just change the view for a bit. Wanna do that?"

=== WHAT YOU ARE FORBIDDEN FROM DOING ===
- Never ask "is this an urge, a feeling, or a situation" unprompted
- Never repeat "check-in is your anchor, urge logging is your early-warning system"
- Never ignore their direct request to ask something else
- Never sound like a script or checklist`;

function buildContextSummary(ctx = {}) {
  const parts = [];
  if (ctx.habitName) parts.push(`Habit: ${ctx.habitName}`);
  if (ctx.streak) parts.push(`Streak: ${ctx.streak} days`);
  if (ctx.totalClean) parts.push(`Total clean: ${ctx.totalClean} days`);
  if (ctx.totalSlips) parts.push(`Total slips: ${ctx.totalSlips}`);
  if (ctx.urges?.length) {
    const recent = ctx.urges.slice(-5);
    parts.push(`Recent urges (${recent.length} of ${ctx.urges.length}): ${recent.map(u => `${u.trigger || 'unknown'} intensity ${u.intensity}/5${u.resisted ? ' (resisted)' : ''}`).join('; ')}`);
  }
  if (ctx.journals?.length) {
    const recent = ctx.journals.slice(-3);
    parts.push(`Recent journal: ${recent.map(j => `"${j.content}"`).join(' | ')}`);
  }
  const ci = ctx.dailyCheckin;
  if (ci) {
    parts.push(`Today: energy ${ci.energy ?? '?'}/5, sleep ${ci.sleep ?? '?'}/5, mood ${ci.mood ?? '?'}/5`);
  }
  if (ctx.currentMilestone?.label) {
    const milestone = `Milestone: ${ctx.currentMilestone.label}`;
    const next = ctx.nextMilestone ? ` | Next: ${ctx.nextMilestone.label}${ctx.nextMilestone.daysRemaining ? ` in ${ctx.nextMilestone.daysRemaining} day${ctx.nextMilestone.daysRemaining === 1 ? '' : 's'}` : ''}` : '';
    parts.push(`${milestone}${next}`);
  }
  return parts.join('\n');
}

export function buildMessages(message, ctx = {}, history = [], memoryPrompt = '') {
  const contextSummary = buildContextSummary(ctx);
  const systemContent = [memoryPrompt, contextSummary, SYSTEM_PROMPT].filter(Boolean).join('\n\n');
  const messages = [{ role: 'system', content: systemContent }];
  for (const m of history) {
    messages.push({ role: m.role, content: m.text });
  }
  messages.push({ role: 'user', content: String(message) });
  return messages;
}

async function callOpenAI(messages, stream = false) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const provider = providerFor(OPENAI_MODEL, OPENAI_BASE_URL);
  const body = {
    model: OPENAI_MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.8,
  };
  if (provider === 'kilo' || provider === 'stepfun') {
    if (OPENAI_MODEL.includes('step')) {
      body.reasoning_effort = 'low';
    }
  }
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'HTTP-Referer': 'https://breakfree.app',
      'X-Title': 'BreakFree',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`AI provider error ${res.status}: ${errText}`);
  }
  return res;
}

export async function chat(messages) {
  const res = await callOpenAI(messages, false);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

export async function streamChat(messages, onDelta, onDone) {
  const provider = providerFor(OPENAI_MODEL, OPENAI_BASE_URL);
  const body = {
    model: OPENAI_MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.8,
    stream: true,
  };
  if (provider === 'kilo' || provider === 'stepfun') {
    if (OPENAI_MODEL.includes('step')) {
      body.reasoning_effort = 'low';
    }
  }
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'HTTP-Referer': 'https://breakfree.app',
      'X-Title': 'BreakFree',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`AI provider error ${res.status}: ${errText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    onDone();
  };
  try {
    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') {
          done();
          return;
        }
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = json?.choices?.[0]?.delta?.content || json?.response || '';
        if (delta) onDelta(delta);
      }
    }
  } finally {
    done();
  }
}

export async function checkHealth() {
  if (!OPENAI_API_KEY) return { ok: false, detail: 'OPENAI_API_KEY not configured' };
  const t0 = Date.now();
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    return {
      ok: res.ok,
      detail: res.ok ? `Responded in ${Date.now() - t0}ms (model: ${OPENAI_MODEL} via ${providerFor(OPENAI_MODEL, OPENAI_BASE_URL)})` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}
