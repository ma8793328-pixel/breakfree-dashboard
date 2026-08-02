// BreakFree offline coach - runs entirely on device. No API, no network, no accounts.
// It blends pattern recognition over the user's own data with warm, human templates.

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function pick(list, seed) {
  return list[seed % list.length];
}

function habitLabel(ctx) {
  return ctx?.habitName || 'the habit';
}

export function checkinNote(ctx = {}) {
  const ci = ctx?.dailyCheckin;
  if (!ci) return '';
  const lows = [];
  if (ci.sleep < 3) lows.push(['sleep', ci.sleep, 'low rest quietly lowers your resistance to urges']);
  if (ci.energy < 3) lows.push(['energy', ci.energy, 'fatigue can masquerade as a craving']);
  if (ci.mood < 3) lows.push(['mood', ci.mood, 'heavy feelings are temporary — they pass like weather']);
  if (lows.length === 0) return '';
  const [label, score, tip] = lows[0];
  return `I noticed your ${label} was rated ${score}/5 in today's check-in — ${tip}.`;
}

function cleanDays(ctx) {
  return ctx?.totalClean ?? 0;
}

function slipCount(ctx) {
  return ctx?.totalSlips ?? 0;
}

function resistRate(ctx) {
  const urges = ctx?.urges || [];
  if (urges.length === 0) return null;
  const resisted = urges.filter((u) => u.resisted).length;
  return Math.round((resisted / urges.length) * 100);
}

export function correlationInsights(ctx = {}) {
  const checkins = ctx?.dailyCheckins || [];
  const urges = ctx?.urges || [];
  if (checkins.length < 3) return [];
  const byDate = new Map();
  for (const u of urges) {
    const key = String(u.logged_at || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) byDate.set(key, (byDate.get(key) || 0) + 1);
  }
  const days = checkins.map((c) => ({ ...c, urgeCount: byDate.get(c.date) || 0 }));
  const avgAll = days.reduce((s, d) => s + d.urgeCount, 0) / days.length;

  const RULES = [
    { key: 'sleep', threshold: 1.3, minLowDays: 2, label: 'rough sleep (≤2/5)' },
    { key: 'energy', threshold: 1.2, minLowDays: 2, label: 'low energy (≤2/5)' },
    { key: 'mood', threshold: 1.5, minLowDays: 2, label: 'low mood (≤2/5)' },
  ];

  const insights = [];
  for (const rule of RULES) {
    const lowDays = days.filter((d) => d[rule.key] <= 2);
    if (lowDays.length < rule.minLowDays) continue;
    const avgLow = lowDays.reduce((s, d) => s + d.urgeCount, 0) / lowDays.length;
    if (avgLow <= 0) continue;
    const otherDays = days.filter((d) => d[rule.key] > 2);
    const avgOther = otherDays.length > 0 ? otherDays.reduce((s, d) => s + d.urgeCount, 0) / otherDays.length : 0;
    if (avgOther === 0) {
      insights.push(`Every urge you logged came on a day with ${rule.label} — that's a real pattern worth planning for.`);
      continue;
    }
    if (avgLow > avgAll * rule.threshold) {
      const pct = Math.round((avgLow / avgAll) * 100);
      insights.push(`On days with ${rule.label}, your urge count averages ${avgLow.toFixed(1)} — ${pct}% higher than your overall average of ${avgAll.toFixed(1)}.`);
    }
  }
  const highWellnessDays = days.filter((d) => d.sleep >= 4 && d.energy >= 4 && d.mood >= 4);
  if (highWellnessDays.length >= 2) {
    const zeroUrgeHigh = highWellnessDays.filter((d) => d.urgeCount === 0).length;
    if (zeroUrgeHigh > 0) {
      insights.push(`On days with high wellness (4–5/5 across the board), you logged zero urges ${zeroUrgeHigh} ${zeroUrgeHigh === 1 ? 'time' : 'times'} — keep that momentum.`);
    }
  }
  return insights;
}

export const STRATEGIES = [
  { name: 'urge surfing', text: 'Urges are waves — they crest and pass in roughly 10–20 minutes if you don\'t act on them. Ride it: notice the feeling, breathe slowly and steadily, and say to yourself, "this is just a wave, it will pass." You\'ve already ridden several.' },
  { name: 'the 10-minute delay', text: 'Tell yourself you\'re allowed to have it — but in 10 minutes. Set a timer and do something else. In most cases the wave peaks and rolls away before the timer ends, and you get to feel the quiet win of choosing yourself.' },
  { name: '5-4-3-2-1 grounding', text: 'Anchor your senses: name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. It pulls your mind out of the craving and back into the room — and the urge usually softens.' },
  { name: 'changing your state', text: 'Step outside for 60 seconds, splash cold water on your face, or do 20 quick jumping jacks. A small physical shift interrupts the autopilot the habit runs on.' },
  { name: 'writing it out', text: 'Open your journal and write down what\'s driving this right now — the situation, the feeling, what the habit promises you. Naming it takes away a surprising amount of its power.' },
];

const STRATEGY_ALIASES = [
  { strategy: 'urge surfing', re: /urge surf/ },
  { strategy: 'the 10-minute delay', re: /10[- ]?min(?:ute)?\b|delay (?:it|this)/ },
  { strategy: '5-4-3-2-1 grounding', re: /5[- ]?4[- ]?3[- ]?2[- ]?1/ },
  { strategy: 'changing your state', re: /state change|chang(?:e|ing) (?:my|your) state/ },
  { strategy: 'writing it out', re: /write it out|writing it out/ },
];

// Curated, general-knowledge substance info. Never personal medical advice.
// The disclaimer is mandatory in every reply that uses this.
const SUBSTANCES = {
  nicotine: {
    names: ['nicotine', 'nic'],
    effects: 'Nicotine is a stimulant that can raise heart rate and disrupt sleep cycles. Withdrawal often shows up as irritability, anxiety, difficulty concentrating, and sleep disturbances.',
    withdrawal: ['Irritability', 'Anxiety', 'Difficulty concentrating', 'Sleep disturbances'],
  },
  caffeine: {
    names: ['caffeine', 'coffee', 'caffeinated'],
    effects: 'Caffeine is a stimulant that can interfere with sleep when consumed late in the day, and can heighten anxiety at high doses.',
    withdrawal: ['Headache', 'Fatigue', 'Irritability'],
  },
  alcohol: {
    names: ['alcohol', 'beer', 'wine', 'booze'],
    effects: 'Alcohol is a depressant that can disrupt sleep architecture — it may help you fall asleep, but often fragments deep sleep and can increase nighttime urges.',
    withdrawal: ['Trouble sleeping', 'Anxiety', 'Restlessness'],
  },
  cannabis: {
    names: ['cannabis', 'weed', 'marijuana', 'thc', 'pot'],
    effects: 'Cannabis can affect memory and motivation, and can interact with sleep — some people find it helps them fall asleep, while others report disrupted sleep.',
    withdrawal: ['Irritability', 'Sleep problems', 'Cravings', 'Low appetite'],
  },
};
const SUBSTANCE_DISCLAIMER = 'This is general information, not medical advice — please consult your doctor for anything personal.';
const SUBSTANCE_MEDICAL_WORDS = /medication|medicine|prescription|pill|is it safe|side effect|interaction|interacts|drugs?/;
const SUBSTANCE_NOT_FOUND = 'I don\u2019t have specific data on that substance. Please consult a medical professional or a reliable drug database — and I\u2019m here for the habit side of things whenever you need me.';

export function coachReply(message, ctx = {}) {
  const text = String(message || '').trim();
  const low = text.toLowerCase();
  const seed = hash(text + (ctx.seed || 0));
  const streak = ctx.streak ?? 0;
  const rate = resistRate(ctx);
  const days = cleanDays(ctx);
  const slips = slipCount(ctx);
  const habit = habitLabel(ctx);
  const ci = ctx.dailyCheckin || null;

  function urgeCheckinLine() {
    if (!ci) return '';
    if (ci.sleep < 3 && ci.energy < 3) return ' Low sleep plus low energy is a double whammy for cravings — go easy on yourself.';
    if (ci.sleep < 3) return ' Rough sleep makes urges hit harder — that\'s biology, not weakness.';
    if (ci.energy < 3) return ' Low energy can amplify cravings — a snack and some water first might take the edge off.';
    return '';
  }

  const quick = (arr) => ({ quickReplies: arr });

  const urgeQ = ["I'm having an urge right now", "Give me a quick strategy", "Help me distract myself"];
  const helpQ = ["Give me a strategy", "Motivate me", "How am I doing?"];
  const motiQ = ["Why is this worth it?", "Give me a strategy", "I feel like giving up"];
  const celebrateQ = ["I had a win today", "What should I do today?", "Motivate me"];
  const sadQ = ["I'm having an urge right now", "Tell me I can do this", "What helps with loneliness?"];

  function urgeResponse() {
    const s = STRATEGIES[seed % STRATEGIES.length];
    const rateLine = rate != null
      ? (rate >= 50
        ? ` You've resisted ${rate}% of the urges you've logged — that's real strength showing up.`
        : ` You've logged ${ctx?.urges?.length ?? 0} urges so far; each one you notice is a small win.`)
      : '';
    return {
      text: pick([
        `Okay, let's sit with it for a second. ${s.text}${rateLine}`,
        `I hear you — that pull can feel huge in the moment. ${s.text}${rateLine}`,
        `Good job noticing it instead of acting on it. That's the skill that matters most. ${s.text}${rateLine}`,
      ], seed) + urgeCheckinLine(),
      ...quick(urgeQ),
    };
  }

  function sadResponse() {
    const moodLine = ci?.mood != null && ci.mood < 3
      ? ` Your check-in rated mood at ${ci.mood}/5 today — I'm glad you told me instead of sitting with it alone.`
      : '';
    return {
      text: pick([
        `I'm here with you. Low days are heavy, and it's okay to not be okay right now. You don't have to perform strength for anyone — not even me. Just be with the feeling, and know that feelings move through us like weather. Is there one small thing that could offer a little comfort that isn't ${habit}?${moodLine}`,
        `That matters, and I'm glad you said it out loud. You're not alone in this — plenty of people break habits while feeling low. If you can, reach out to one person today, even just a text. Connection is a quiet kind of medicine.${moodLine}`,
        `Sit with it as long as you need. You don't have to fix your mood to keep your streak — you can feel low and still choose yourself. That's not weakness; it's endurance. What's one tiny act of self-care you could give yourself in the next hour?${moodLine}`,
      ], seed),
      ...quick(sadQ),
    };
  }

  // ---- Explicit strategy pick (from the strategy picker) ----
  for (const a of STRATEGY_ALIASES) {
    if (a.re.test(low)) {
      const s = STRATEGIES.find((x) => x.name === a.strategy) || STRATEGIES[seed % STRATEGIES.length];
      return {
        text: pick([
          `Good call — here's the ${s.name} strategy, step by step: ${s.text} Want me to walk you through it right now?`,
          `Here's how ${s.name} works: ${s.text} Try it with me and tell me how it feels.`,
        ], seed),
        ...quick(urgeQ),
      };
    }
  }

  // ---- Substance / medication lookup (safe, general info only) ----
  if (SUBSTANCE_MEDICAL_WORDS.test(low) || Object.values(SUBSTANCES).some((s) => s.names.some((n) => low.includes(n)))) {
    const hit = Object.values(SUBSTANCES).find((s) => s.names.some((n) => low.includes(n)));
    if (!hit) {
      return {
        text: pick([
          `I don't have specific data on that substance — this is outside what I can safely speak to. ${SUBSTANCE_NOT_FOUND}`,
          `I'd rather be honest than guess here. ${SUBSTANCE_NOT_FOUND}`,
        ], seed),
        ...quick(["I'm having an urge right now", "How am I doing?", "Give me a strategy"]),
      };
    }
    return {
      text: `${hit.effects} Common withdrawal signs include: ${hit.withdrawal.join(', ')}. ${SUBSTANCE_DISCLAIMER}`,
      ...quick(["I'm having an urge right now", "How am I doing?", "Give me a strategy"]),
    };
  }

  // ---- Relapse / slip ----
  if (/(slip|relapse|relapsed|messed up|gave in|gave up|fell off|fucked up|broke|reset|failed)/.test(low) ||
      /\b(i|we) (smoked|drank|ate|did it|went back)\b/.test(low)) {
    return {
      text: pick([
        `I'm really glad you told me. A slip is a data point, not a verdict — you logged ${Math.max(days, 1)} clean ${days === 1 ? 'day' : 'days'} before it, and that experience is still yours. Nothing about those days was wasted. Right now the only thing that matters is the very next choice. Want to talk about what happened?`,
        `Okay, breathe. This is one day in a much longer story, and nearly everyone who breaks a habit slips at some point. You have ${days} clean ${days === 1 ? 'day' : 'days'} of proof that you can do this. What was the situation when it happened — anything we can learn from?`,
        `Thank you for being honest with me. That takes more courage than a perfect streak does. The streak restarts tomorrow, but your wisdom doesn't. What was the trigger — a place, a person, a feeling, a time of day?`,
        `I won't pretend it's nothing — but I also won't let you believe it undoes your progress. ${days} clean ${days === 1 ? 'day' : 'days'}, and now you have fresh information about what trips you up. That's not failure. That's intel. Want to note what you learned in your journal?`,
      ], seed),
      ...quick(["It was stress", "It was boredom", "Help me make a plan for tomorrow", "I just need to talk"]),
    };
  }

  // ---- Urge / craving / trigger ----
  if (/(urge|urges|craving|crave|tempted|so hard|itch|trigger|want one|dying to|want to (smoke|drink|eat|use|check|scroll|relapse|slip)|need (a )?(weed|smoke|cig|cigarette|joint|vape|hit|blunt|bong|nicotine)|want (a )?(weed|cig|cigarette|joint|vape|hit|blunt|bong|smoke|nicotine))/.test(low)) {
    return urgeResponse();
  }

  // ---- Stress / anxiety / overwhelm ----
  if (/(stress|stressed|anxious|anxiety|overwhelmed|pressure|worry|worried|panic|frazzled|tense)/.test(low)) {
    return {
      text: pick([
        `Stress is one of the most common reasons ${habit} shows up — it's not a character flaw, it's the habit doing its old job as a coping mechanism. Your job right now is a kinder coping tool. Try this: breathe in for 4, hold for 4, out for 6, three times. Then ask yourself what you actually need in this moment — rest, movement, company, or just a minute of quiet.`,
        `That sounds heavy. When stress piles up, the craving isn't really about ${habit} — it's about relief. Let's find you relief that doesn't cost your progress: a hot shower, a walk around the block, music that helps, or 5-4-3-2-1 grounding. What feels available to you right now?`,
        `I'm sorry today's been a lot. Be gentle with yourself — you don't need to solve everything today, just the next five minutes. When your shoulders are this tight, the win is simply not making it worse for yourself.`,
      ], seed),
      ...quick(["Help me calm down now", "It's about work", "Give me a strategy"]),
    };
  }

  // ---- Sadness / loneliness / low mood ----
  if (/(sad|lonely|alone|down|depress|hopeless|worthless|crying|cry|empty|blue|hurt|heartbroken|\blow\b|rough|awful|terrible|miserable|unhappy|numb|not great|bad day|sucks)/.test(low)) {
    return sadResponse();
  }

  // ---- Boredom ----
  if (/(bored|boring|nothing to do|killing time|idle)/.test(low)) {
    return {
      text: pick([
        `Boredom is where a lot of habits sneak back in — the old habit was an instant filler for empty moments. So let's give that space something better. Quick ideas: a 5-minute walk, put on a song you love, tidy one small corner, call a friend, or write two lines in your journal. What's a tiny thing you could do right now?`,
        `Boredom feels empty, but it's actually room to move — a gap where you get to choose. You don't have to fill every minute productively; just don't hand the empty minutes back to ${habit}. Pick a small thing and let that be enough.`,
      ], seed),
      ...quick(["Give me a quick strategy", "Suggest something to do", "I'm having an urge right now"]),
    };
  }

  // ---- Exhaustion ----
  if (/(tired|exhausted|exhaustion|fatigue|no energy|drained|worn out)/.test(low)) {
    const energyLine = ci?.energy != null && ci.energy < 3
      ? ` Your check-in says energy's at ${ci.energy}/5 today — that tracks.`
      : '';
    return {
      text: pick([
        `When you're exhausted, your willpower is on a lower setting — that's biology, not weakness. The smart move isn't to white-knuckle it; it's to lower the stakes for today. Get some water, eat something real, and if you can, rest early. Protect tonight's sleep and tomorrow will feel far more doable.${energyLine}`,
        `Fatigue makes every craving louder. Be kind to yourself — this is a day for maintenance, not heroics. What would take the least effort but still move you forward?${energyLine}`,
      ], seed),
      ...quick(["I'm having an urge right now", "Help me plan for tonight", "Motivate me"]),
    };
  }

  // ---- Motivation ----
  if (/(motivat|encourag|need a push|\ba push\b|push me|pump me up|psyc(h|he) me up|cheer me up|inspire)/.test(low)) {
    return {
      text: pick([
        `Here's your motivation, straight from the data: ${streak} ${streak === 1 ? 'day' : 'days'} in a row, ${days} clean ${days === 1 ? 'day' : 'days'} total. You're not starting from zero — you're adding to a number that's already yours. The version of you who doesn't need ${habit} is being built one day at a time, and you're the one building it.`,
        `Let's talk about why this matters. Every clean day is a deposit into the person you're becoming — more energy, more freedom, more trust in yourself. ${days} clean ${days === 1 ? 'day' : 'days'} is real evidence you can do this. The hardest part is behind you; the rest is momentum.`,
        `You asked for motivation, so here it is: you don't need to feel ready to keep going — you just need to show up today. And you already are. ${streak > 0 ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row says your future self is already winning.` : 'A fresh start is a superpower — today counts.'}`,
      ], seed),
      ...quick(motiQ),
    };
  }

  // ---- Give up / motivation ----
  if (/(give up|giving up|can't do it|cannot do|too hard|quit on myself|why bother|useless|pointless|no point|hopeless|not strong enough|weak)/.test(low)) {
    return {
      text: pick([
        `I hear how heavy that feels. But here's the thing — the urge to give up is just the habit negotiating. It wants you to believe you can't, because as long as you believe that, it wins. You've already logged ${days} clean ${days === 1 ? 'day' : 'days'}. That's not nothing. That's evidence. You don't have to feel strong today — you just have to not make the worst choice tonight.`,
        `Let's reframe: you're not behind schedule, you're on the hardest part of the road — the middle. Most people quit here, which is exactly why keeping going quietly separates you from almost everyone. ${days} clean ${days === 1 ? 'day' : 'days'} behind you. What do you actually want this for?`,
        `It's okay to be tired of fighting. Nobody wins a marathon by sprinting. Scale today way down: you just need to get through it. One clean day. Then another. That's the whole strategy — and it's working.`,
      ], seed),
      ...quick(motiQ),
    };
  }

  // ---- Sleep / night ----
  if (/(sleep|insomnia|can't sleep|bedtime|late night|wide awake)/.test(low)) {
    const sleepLine = ci?.sleep != null && ci.sleep < 3
      ? ` Your check-in rated sleep at ${ci.sleep}/5 — no wonder tonight's hard; low rest weakens resistance.`
      : '';
    return {
      text: pick([
        `Nights are a classic danger zone for ${habit} — the day ends, the guard drops, and the old ritual calls. If you're lying awake, don't fight yourself: get up, do something quiet for a few minutes (tea, a book, stretching), and come back when you're sleepy. Breaking the loop of "awake in bed + craving" matters more than the exact hour you sleep.${sleepLine}`,
        `A tired brain is an impulsive brain, so give yourself a gentle evening plan: put screens away an hour before bed, do a wind-down ritual, and keep a glass of water by the bed. When the night urge hits, it's just a wave — it passes faster than you think.${sleepLine}`,
      ], seed),
      ...quick(["I'm having an urge right now", "Help me wind down", "Give me a strategy"]),
    };
  }

  // ---- Win / celebration ----
  if (/(win|won|proud|great|amazing|awesome|good day|made it|clean day|did it|feels good|feel good|happy|strong|free)/.test(low)) {
    const badgeNote = ctx?.badges?.length
      ? ` And you've earned ${ctx.badges.length} milestone ${ctx.badges.length === 1 ? 'badge' : 'badges'} along the way — that's worth wearing with pride.`
      : '';
    return {
      text: pick([
        `Yes! Look at you. ${streak} ${streak === 1 ? 'day' : 'days'} strong, ${days} total clean ${days === 1 ? 'day' : 'days'} in the bank — and days like this are the ones that stack up into a new life. I'm genuinely proud of you.${badgeNote} Savor this feeling for a moment — you earned it. What did today look like?`,
        `That's a real achievement and I don't say that lightly. Every clean day is a promise you made to yourself and kept.${badgeNote} Take a second to actually feel how good this is — your brain deserves to register the win, not just move past it.`,
        `Beautiful. You're not just avoiding ${habit} — you're actively building a version of yourself who doesn't need it. That's the deeper work, and you're doing it.${badgeNote}`,
      ], seed),
      ...quick(celebrateQ),
    };
  }

  // ---- How am I doing / data / patterns ----
  if (/(how am i doing|progress|stats|pattern|patterns|insight|insights|am i doing ok|summary|track record|data)/.test(low)) {
    const lines = [
      `Here's your picture right now: ${streak} ${streak === 1 ? 'day' : 'days'} clean in a row, ${days} clean ${days === 1 ? 'day' : 'days'} total, and a longest streak of ${ctx.longestStreak ?? streak} days.`,
    ];
    if (slips > 0) lines.push(`You've had ${slips} ${slips === 1 ? 'slip' : 'slips'} — and you logged ${days} clean ${days === 1 ? 'day' : 'days'} to ${slips}. The clean days outnumber the slips ${days}:${slips}. That's the real score.`);
    if (rate != null) lines.push(rate >= 50 ? `You've resisted ${rate}% of your logged urges. Your willpower is showing up more than you give it credit for.` : `You're resisting about ${rate}% of urges so far — that's a start, and it's climbing. Every resisted urge makes the next one weaker.`);
    if (ctx?.badges?.length) lines.push(`Milestones earned: ${ctx.badges.map((b) => `${b.threshold} days`).join(', ')}.`);
    if (ci) {
      const lowBits = [];
      if (ci.energy < 3) lowBits.push(`energy ${ci.energy}/5`);
      if (ci.sleep < 3) lowBits.push(`sleep ${ci.sleep}/5`);
      if (ci.mood < 3) lowBits.push(`mood ${ci.mood}/5`);
      lines.push(lowBits.length
        ? `Today's check-in: ${lowBits.join(', ')} — worth honoring before anything else.`
        : `Today's check-in: energy ${ci.energy}/5, sleep ${ci.sleep}/5, mood ${ci.mood}/5 — a solid baseline.`);
    }
    const insights = correlationInsights(ctx);
    for (const line of insights) lines.push(line);
    lines.push(`Overall: this isn't a straight line, but the direction is unmistakably forward.`);
    return { text: lines.join(' '), ...quick(helpQ) };
  }

  // ---- Help / advice / questions ----
  if (/(how do|how can|what should|what can|give me|help me|advice|tip|tips|strategy|suggest|guide|tell me what to)/.test(low)) {
    const s = STRATEGIES[seed % STRATEGIES.length];
    return {
      text: pick([
        `Happy to help. Here's the strategy I'd start with: ${s.text} Beyond that, three habits beat almost any trick — check in every day, log urges when they hit, and write one honest line in your journal. What part is hardest for you right now?`,
        `Here's what works for most people: ${s.text} The daily check-in is your anchor, urge logging is your early-warning system, and journaling turns feelings into information. Which of those do you want to lean into?`,
      ], seed),
      ...quick(helpQ),
    };
  }

  // ---- Thanks ----
  if (/(thank|thanks|appreciate|grateful)/.test(low)) {
    return {
      text: pick([
        `Always. You're the one doing the hard part — I'm just the voice on the sideline. Come back whenever you need me.`,
        `Anytime. That's what I'm here for. Now go be kind to yourself today.`,
        `You've got this. And when you don't, I've got you.`,
      ], seed),
      ...quick(["I'm having an urge right now", "Motivate me", "How am I doing?"]),
    };
  }

  // ---- Greeting ----
  if (/(^|\s)(hi|hello|hey|good morning|good afternoon|good evening|yo|sup)(\s|$|!|\.|\?)/.test(low)) {
    const streakLine = streak > 0
      ? `Today you're on a ${streak}-day streak — nice momentum to protect.`
      : streak === 0 && days > 0
        ? 'Today is a fresh start after a slip, and I love a good comeback story.'
        : 'Today is the start of something real.';
    return {
      text: pick([
        `Hey — good to see you. I'm your coach for ${habit}. ${streakLine} How's your day feeling?`,
        `Hello, you. Ready when you are. ${streakLine} What's on your mind?`,
      ], seed),
      ...quick(["I'm having an urge", "I had a win today", "How am I doing?"]),
    };
  }

  // ---- Goodbye ----
  if (/(bye|goodbye|see you|gotta go|gtg|later)/.test(low)) {
    return {
      text: pick([
        `Take care of yourself. I'll be right here — and so will your ${streak}-day streak if you keep showing up.`,
        `See you. Remember: one clean day at a time. That's the whole secret.`,
      ], seed),
      ...quick(["I had a win today", "Motivate me"]),
    };
  }

  // ---- Word-guessing: signals the strict patterns missed ----
  if (/\b(weed|smoke|cig|cigarette|joint|vape|blunt|bong|nicotine|toke)\b/.test(low)) {
    return urgeResponse();
  }
  if (/\b(low|rough|awful|terrible|miserable|unhappy|heavy|numb|not great|bad day)\b/.test(low)) {
    return sadResponse();
  }

  // ---- Fallback ----
  return {
    text: pick([
      `I'm listening. Tell me a bit more — are we talking about an urge, how you're feeling, or something you want to plan for?`,
      `I want to respond to the real thing here. Is a craving showing up, are you carrying a heavy feeling, or are you looking for a plan?`,
      `Got it. Whatever it is, you're safe to say it to me — no judgement, ever. Is this about an urge, a feeling, or a situation?`,
      `I'm here and I'm not going anywhere. Say a little more — the sooner I know what's pulling at you, the sooner we can work with it.`,
      `Thank you for telling me. Rather than assume, let me ask: is a craving knocking, is your mood heavy, or are you deciding what's next?`,
    ], seed),
    ...quick(["I'm having an urge right now", "I'm feeling low", "Give me a strategy", "How am I doing?"]),
  };
}

// ---------- Journal reflection ----------

const POSITIVE = ['proud', 'good', 'great', 'happy', 'win', 'winning', 'better', 'hopeful', 'strong', 'free', 'easy', 'excited', 'calm', 'accomplished', 'relieved', 'glad'];
const NEGATIVE = ['hard', 'struggl', 'tired', 'sad', 'stress', 'anxious', 'bad', 'urge', 'craving', 'slip', 'gave', 'weak', 'lonely', 'overwhelm', 'fail', 'guilt', 'ashamed', 'afraid'];
const SLIP_WORDS = ['slip', 'relapse', 'gave in', 'messed', 'failed', 'broke', 'smoked', 'drank', 'gave up', 'fell'];
const TRIGGER_WORDS = [
  { key: 'stress', words: ['stress', 'anxious', 'work', 'pressure', 'overwhelm', 'deadline'] },
  { key: 'boredom', words: ['bored', 'boring', 'idle'] },
  { key: 'social situations', words: ['friend', 'party', 'social', 'dinner', 'drinks', 'bar'] },
  { key: 'evenings', words: ['night', 'evening', 'late', 'bed', 'sleep'] },
  { key: 'loneliness', words: ['lonely', 'alone', 'isolated'] },
];

export function reflectOnJournal(content, ctx = {}) {
  const low = String(content || '').toLowerCase();
  const seed = hash(low + 'reflect');
  const streak = ctx.streak ?? 0;

  const posHits = POSITIVE.filter((w) => low.includes(w));
  const negHits = NEGATIVE.filter((w) => low.includes(w));
  const slipped = SLIP_WORDS.some((w) => low.includes(w));
  const trigger = TRIGGER_WORDS.find((t) => t.words.some((w) => low.includes(w)));

  const quote = extractPhrase(content);

  let tone = posHits.length > negHits.length ? 'positive' : negHits.length > posHits.length ? 'negative' : 'mixed';

  let text = '';
  if (slipped) {
    text = pick([
      `You wrote honestly about a hard moment, and that takes guts. ${quote ? `"${quote}" — ` : ''}that's the part worth keeping. This entry is proof that even on a tough day, you choose to show up for yourself. ${streak > 0 ? `Your ${streak}-day streak is behind you as evidence, not pressure.` : 'Your next clean day starts the count again — and you know how to do this.'}`,
      `There's no shame in what you wrote — there's honesty, which is far more valuable. A slip logged is a lesson banked. ${quote ? `Keep that line: "${quote}".` : ''}Read this back before your next urge hits.`,
    ], seed);
  } else if (tone === 'positive') {
    text = pick([
      `I can feel the lightness in this. ${quote ? `"${quote}"` : 'The hope comes through'} — hold onto exactly this feeling; it's your fuel. Days like this are how a new identity gets built, one entry at a time.`,
      `This is the good stuff worth revisiting. ${quote ? `"${quote}"` : 'What you described'} is real progress, and you took the time to notice it — that's self-awareness working for you.`,
    ], seed);
  } else if (tone === 'negative') {
    text = pick([
      `Thank you for writing the heavy part down — that's how it loses some of its grip. ${trigger ? `I notice ${trigger.key} showing up as a theme. ` : ''}${quote ? `"${quote}"` : 'What you described'} sounds genuinely hard. You don't have to solve it today; just setting it down on the page is a step.`,
      `This entry matters because it's honest. ${trigger ? `${trigger.key.charAt(0).toUpperCase() + trigger.key.slice(1)} keeps coming up in what you write — worth keeping an eye on when that situation appears. ` : ''}Feeling this way and writing anyway is strength, not weakness.`,
    ], seed);
  } else {
    text = pick([
      `A little of both today — that's just life, and I love that you noted it. ${quote ? `"${quote}" — ` : ''}the self-awareness here is the whole game. Keep noticing, keep writing.`,
      `Mixed feelings are part of every real journey. ${quote ? `That line — "${quote}" — is worth coming back to.` : 'What you wrote is worth coming back to.'} You're doing the deep work of paying attention, and it's working.`,
    ], seed);
  }

  return text;
}

function extractPhrase(content) {
  const clean = String(content || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 8) return null;
  const words = clean.split(' ');
  if (words.length <= 6) return clean.length > 60 ? clean.slice(0, 57) + '...' : clean;
  const start = Math.max(0, Math.floor(words.length * 0.2));
  const slice = words.slice(start, start + 8).join(' ');
  const phrase = (slice.length > 60 ? slice.slice(0, 57) + '...' : slice).replace(/[.,!?;:]+$/, '');
  return phrase;
}

// ---------- Urge insights ----------

function hourBucket(iso) {
  const h = new Date(iso).getHours();
  if (h >= 5 && h < 12) return 'mornings';
  if (h >= 12 && h < 17) return 'afternoons';
  if (h >= 17 && h < 22) return 'evenings';
  return 'nights';
}

function bestTrigger(urges) {
  const counts = {};
  let best = null;
  for (const u of urges) {
    const t = (u.trigger || '').trim().toLowerCase();
    if (!t) continue;
    const n = (counts[t] || 0) + 1;
    counts[t] = n;
    if (!best || n > best.n) best = { t, n };
  }
  return best ? { trigger: best.t, n: best.n } : null;
}

export function urgeInsight(urges = [], ctx = {}) {
  if (!urges || urges.length < 2) return null;
  const seed = hash('urgeinsight' + urges.length + (ctx.streak ?? 0));

  const avg = urges.reduce((s, u) => s + u.intensity, 0) / urges.length;
  const resisted = urges.filter((u) => u.resisted).length;
  const resistedPct = Math.round((resisted / urges.length) * 100);
  const peak = {};
  for (const u of urges) {
    const b = hourBucket(u.logged_at);
    peak[b] = (peak[b] || 0) + 1;
  }
  const peakPeriod = Object.entries(peak).sort((a, b) => b[1] - a[1])[0];
  const trig = bestTrigger(urges);

  const bullets = [];
  if (trig) {
    bullets.push({ label: 'Your most common trigger', text: `"${trig.trigger}" showed up ${trig.n}× — if you can see it coming, you can out-plan it.` });
  }
  bullets.push({
    label: 'Your resistance rate',
    text: `You've resisted ${resistedPct}% of ${urges.length} logged urges — ${resistedPct >= 50 ? 'that\'s quiet strength, showing up more than you realize.' : 'a real foundation to build on. Every resisted urge weakens the next one.'}`,
  });
  bullets.push({
    label: `Average intensity ${avg.toFixed(1)}/5`,
    text: avg >= 3.5
      ? 'These urges hit hard. Plan ahead for peak moments with a distraction ready to go.'
      : 'Mostly manageable intensity — catch them early, before they build momentum.',
  });
  if (peakPeriod) {
    bullets.push({
      label: 'Peak window',
      text: `Urges cluster in the ${peakPeriod[0]} — have a small ritual ready then (water, a walk, 10-minute delay).`,
    });
  }

  const headline = pick([
    'Here\'s what your urges are telling you',
    'A look at the patterns in your urges',
    'Your urge patterns, gently unpacked',
  ], seed);

  return { headline, bullets, resistedPct, count: urges.length };
}
