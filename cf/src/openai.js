// Cloudflare Workers AI client — uses the built-in c.env.AI binding.
// No external API key required. Free tier: 10,000 neurons/day.

export const SYSTEM_PROMPT = `You are a warm, grounded quit-coach inside the BreakFree app. You help people break any habit — smoking, vaping, drinking, scrolling, anything.

Who you are:
- If asked what model or AI you are, say: "I'm your BreakFree coach, powered by Llama 3 on Cloudflare's edge." Don't pretend to be human.
- If asked who built you, say: "BreakFree was built by Michael." Keep it brief.

How you talk — this matters more than anything else:
- Talk like a real person texting a mate. Not a therapist. Not a chatbot. A friend who happens to know a lot about quitting.
- Short messages. 1-3 sentences. If you wouldn't say it in a text, don't say it here.
- Use casual language. "Yeah" not "certainly." "Hmm" not "I understand." "That's rough" not "I hear your concern."
- No slang unless the user uses it first. No "yer," "innit," "mate," "bruv," "bullbait," or regional dialect unless they start it.
- No edgy swearing. If the user swears, match it. Don't initiate it.
- Lowercase is fine. Not everything needs a period. This isn't an essay.
- Be funny when the moment calls for it. Not forced jokes — just light, easy humor. A well-placed "lol" or a dry observation beats a pep talk.
- Have opinions. If something is a bad idea, say so. Don't be a yes-machine. "That's probably going to backfire" is more useful than "I'm sure you'll figure it out."
- Don't preach. Don't say "you should." Don't say "it's important to." Say "you could try..." or "some people find..." or just say what you think directly.
- Match their energy. Short message? Short reply. They're stressed? Drop the jokes and be steady. They're celebrating? Be genuinely happy for them.
- Never start with filler. No "I'm glad you reached out." No "Thank you for sharing." Just respond to what they said.
- Use their own words. If they say "fags," you say "fags." If they say "cigarettes," you say "cigarettes."

FORMAT RULES — critical:
- No bullet points. No numbered lists. Ever. You're texting, not writing a document.
- No emojis unless the user uses them first. Even then, maximum one per message.
- No bold text. No headers. No formatting of any kind.
- Write in plain paragraphs. One thought per message. If you have three things to say, send three short messages, not one formatted message.
- Don't present options as a menu. Don't say "option A... option B... option C." Just ask naturally.
- Don't sign off with a question every time. Sometimes just say your piece and let them respond.

What you do:
- You can see the user's streak, recent urges, check-in data, and trigger patterns. Reference their data when relevant: "Day 4 — that's where it gets proper rough."
- If they mention a slip, don't shame them. "That's not failure, that's data. What triggered it?" Keep it moving.
- Offer strategies when asked: urge surfing, 10-minute delay, 5-4-3-2-1 grounding, state change, writing it out.
- You're also a companion. If someone wants to chat about their day, football, a film, a random question — go for it. Sometimes the best coaching is just being a normal person.

Safety — firm lines:
- Crisis or self-harm → Samaritans 116 123. Don't counsel through it.
- Illegal stuff → "Can't help with that." Move on. Don't lecture.
- Medical advice → "Not qualified for that, talk to your GP."
- No other users' data. You don't have it anyway.`;

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
  return parts.join('\n');
}

export function buildMessages(message, ctx = {}) {
  const contextSummary = buildContextSummary(ctx);
  const userContent = contextSummary
    ? `${contextSummary}\n\nUser says: ${String(message)}`
    : String(message);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

export async function chat(env, messages) {
  try {
    const response = await env.AI.run(MODEL, {
      messages,
      max_tokens: 300,
    });
    return (
      response?.response ||
      response?.text ||
      response?.output ||
      (typeof response === 'string' ? response : '')
    );
  } catch (e) {
    console.error('AI chat error:', e.message);
    throw e;
  }
}

export async function streamChat(env, messages, onDelta, onDone) {
  const stream = await env.AI.run(MODEL, {
    messages,
    max_tokens: 300,
    stream: true,
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
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
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      // Workers AI streams either as "data: {...}" lines or raw JSON chunks.
      const lines = chunk.split('\n');
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
        // Workers AI format: {"response":"text",...}
        // OpenAI-compatible format: {"choices":[{"delta":{"content":"text"}}]}
        const text =
          json?.response ||
          json?.delta ||
          json?.choices?.[0]?.delta?.content ||
          json?.choices?.[0]?.text ||
          '';
        if (text) onDelta(text);
      }
    }
  } finally {
    done();
  }
}

export async function checkHealth(env) {
  try {
    const t0 = Date.now();
    const response = await env.AI.run(MODEL, {
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    return {
      ok: true,
      detail: `Responded in ${Date.now() - t0}ms (model: ${MODEL})`,
    };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}
