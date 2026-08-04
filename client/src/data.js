export const MILESTONES = [
  { days: 7, label: 'Rookie', icon: '🌱', tier: '#CD7F32' },
  { days: 14, label: 'Steadfast', icon: '✨', tier: '#C0C0C0' },
  { days: 30, label: 'Champion', icon: '🌙', tier: '#F5A623' },
  { days: 60, label: 'Dedicated', icon: '🌤️', tier: '#00B894' },
  { days: 90, label: 'Elite', icon: '🌟', tier: '#4A90D9' },
  { days: 180, label: 'Veteran', icon: '🌞', tier: '#9B59B6' },
  { days: 365, label: 'Legend', icon: '👑', tier: '#E50914' },
];

export const SKILL_BADGES = [
  { id: 'urge_surfer', label: 'Urge Surfer', icon: '🏄', tier: '#00B894', desc: 'Ridden out 5 urges', check: (ctx) => (ctx?.urges?.filter((u) => u.resisted).length || 0) >= 5 },
  { id: 'financial_guardian', label: 'Financial Guardian', icon: '🛡️', tier: '#F5A623', desc: 'Saved £500', check: (ctx) => (ctx?.moneySaved || 0) >= 500 },
  { id: 'week_reflector', label: 'Reflector', icon: '📝', tier: '#A8C09A', desc: 'Journal 3× this week', check: (ctx) => !!ctx?.journalWeekBadgeEarned },
  { id: 'streak_builder', label: 'Streak Builder', icon: '🔥', tier: '#E50914', desc: '14-day streak', check: (ctx) => (ctx?.streak || 0) >= 14 },
  { id: 'urge_logger', label: 'Urge Logger', icon: '📋', tier: '#4A90D9', desc: 'Logged 10 urges', check: (ctx) => (ctx?.urges?.length || 0) >= 10 },
];

export const QUOTES = [
  { text: 'Every day you stay true is a day you get closer to the person you want to be.', source: 'BreakFree' },
  { text: 'You don\'t have to be perfect. You just have to begin again — today counts.', source: 'BreakFree' },
  { text: 'Progress is not linear. It is a spiral of small steps that keep turning upward.', source: 'BreakFree' },
  { text: 'The habit you are breaking is not who you are. It is just a road you are leaving.', source: 'BreakFree' },
  { text: 'One clean day is a tiny act of self-respect. String enough together and you change your life.', source: 'BreakFree' },
  { text: 'You are not starting over. You are starting from experience.', source: 'BreakFree' },
  { text: 'Be gentle with yourself. You are doing something hard, and you are still here.', source: 'BreakFree' },
  { text: 'We do not rise to the level of our goals. We fall to the level of our systems — so protect today.', source: 'James Clear' },
  { text: 'Fall seven times, stand up eight.', source: 'Japanese Proverb' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', source: 'Confucius' },
  { text: 'The secret of getting ahead is getting started.', source: 'Mark Twain' },
  { text: 'Little by little, one travels far.', source: 'J.R.R. Tolkien' },
  { text: 'He who conquers himself is the mightiest warrior.', source: 'Confucius' },
  { text: 'You have power over your mind, not outside events. Realize this, and you will find strength.', source: 'Marcus Aurelius' },
  { text: 'Hard choices, easy life. Easy choices, hard life.', source: 'Jerzy Gregorek' },
  { text: 'Discipline is choosing between what you want now and what you want most.', source: 'Abraham Lincoln' },
  { text: 'Every moment is a fresh beginning.', source: 'T.S. Eliot' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', source: 'Chinese Proverb' },
  { text: 'You are braver than you believe, stronger than you seem, and smarter than you think.', source: 'A.A. Milne' },
  { text: 'Nothing can dim the light which shines from within.', source: 'Maya Angelou' },
];

export function pickQuote(seed) {
  return QUOTES[seed % QUOTES.length];
}

// ---------- Journal prompts ----------

export const JOURNAL_PROMPTS = [
  'What was your biggest win today?',
  'What triggered you today — and how did you handle it?',
  'What would make tomorrow a little easier?',
  'What did an urge feel like today, and what did you do instead?',
  'Who are you becoming, one day at a time?',
  'What\u2019s one thing you\u2019re proud of yourself for today?',
  'If your future self wrote you a note today, what would it say?',
  'What\u2019s one small act of self-care you gave yourself today?',
  'What\u2019s the hardest part right now — and what\u2019s the truest thing you know about it?',
  'What did you notice about your body, mood or mind today?',
];

export function todayPrompt(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d - start) / 86400000);
  return JOURNAL_PROMPTS[dayOfYear % JOURNAL_PROMPTS.length];
}

export function randomPrompt(except) {
  const others = JOURNAL_PROMPTS.filter((p) => p !== except);
  return others[Math.floor(Math.random() * others.length)];
}

// ---------- Habit classification ----------

const NICOTINE_WORDS  = /\b(smok\w*|vap\w*|nic\w*|tobacco\w*|cig\w*|e-?cig\w*|juul\w*|snus\w*)\b/i;
const ALCOHOL_WORDS   = /\b(alc\w*|beer\w*|wine\w*|vodka\w*|whiskey\w*|drink\w*|sober\w*|booze\w*|liquor\w*)\b/i;
const CAFFEINE_WORDS  = /\b(caff\w*|coffee\w*|teas?\b|espresso\w*|latte\w*|mocha\w*|brew\w*|decaf\w*)\b/i;
const CANNABIS_WORDS  = /\b(weed\w*|marijuana\w*|cannabis\w*|pot\b|ganja\w*|blunt\w*|joint\w*|thc|cbd)\b/i;
const GAMBLING_WORDS  = /\b(bets?\b|bettin\w*|gambl\w*|poker\w*|casino\w*|slots?\b|wager\w*|lottery\w*|sportsbook\w*)\b/i;
const PORN_WORDS      = /\b(porn\w*|xxx|nsfw|masturbat\w*|onlyfan\w*|hentai\w*|explicit\w*)\b/i;
const SOCIAL_WORDS    = /\b(instagram\w*|tiktok\w*|snapchat\w*|twitter\w*|facebook\w*|scroll\w*|reels\w*|social\w*)\b/i;
const SHOPPING_WORDS  = /\b(shop\w*|spend\w*|retail\w*|amazon\w*|purchas\w*|binge.?buy\w*|sales?\b|cart\w*)\b/i;
const GAMING_WORDS    = /\b(gam\w*|playstation\w*|xbox\w*|steam\w*|twitch\w*|esport\w*)\b/i;
const SUGAR_WORDS     = /\b(sugar\w*|sweet\w*|chocolate\w*|candy\w*|donut\w*|junk.?food\w*|dessert\w*|soda\w*|pops?\b)\b/i;

export function classifyHabit(name) {
  const n = String(name || '');
  if (NICOTINE_WORDS.test(n))  return 'nicotine';
  if (ALCOHOL_WORDS.test(n))   return 'alcohol';
  if (CAFFEINE_WORDS.test(n))  return 'caffeine';
  if (CANNABIS_WORDS.test(n))  return 'cannabis';
  if (GAMBLING_WORDS.test(n))  return 'gambling';
  if (PORN_WORDS.test(n))      return 'porn';
  if (SOCIAL_WORDS.test(n))    return 'social_media';
  if (SHOPPING_WORDS.test(n))  return 'shopping';
  if (GAMING_WORDS.test(n))    return 'gaming';
  if (SUGAR_WORDS.test(n))     return 'sugar';
  return 'general';
}

export function unitLabel(name) {
  const cat = classifyHabit(name);
  const map = {
    nicotine:   'cigarettes',
    alcohol:    'drinks',
    caffeine:   'cups',
    cannabis:   'sessions',
    gambling:   'episodes',
    porn:       'episodes',
    social_media: 'sessions',
    shopping:   'purchases',
    gaming:     'sessions',
    sugar:      'treats',
    general:    'times',
  };
  return map[cat] || 'times';
}

// ---------- Recovery timelines ----------

export function recoveryTimeline(name) {
  const cat = classifyHabit(name);

  if (cat === 'nicotine') {
    return [
      { days: 0.02,  label: '20 minutes', text: 'Heart rate and blood pressure start to return to normal.' },
      { days: 0.33,  label: '8 hours',    text: 'Carbon monoxide in your blood drops by half.' },
      { days: 1,     label: '24 hours',   text: 'Your body has cleared most of the nicotine.' },
      { days: 2,     label: '48 hours',   text: 'Nicotine is fully cleared — taste and smell begin to sharpen.' },
      { days: 3,     label: '72 hours',   text: 'Withdrawal peaks, then starts to ease.' },
      { days: 14,    label: '2 weeks',    text: 'Circulation improves; everyday movement gets easier.' },
      { days: 30,    label: '1 month',    text: 'Lungs begin to repair; cravings are fewer and weaker.' },
      { days: 90,    label: '3 months',   text: 'Lung function shows measurable improvement.' },
      { days: 270,   label: '9 months',   text: 'Tiny airways heal — that lingering cough often fades.' },
      { days: 365,   label: '1 year',     text: 'Heart disease risk drops to about half of a smoker\u2019s.' },
    ];
  }

  if (cat === 'alcohol') {
    return [
      { days: 0.25,  label: '6 hours',    text: 'Tremors, anxiety, and nausea may surface as withdrawal begins.' },
      { days: 1,     label: '24 hours',   text: 'Withdrawal peaks. Stay hydrated and seek support if symptoms are severe.' },
      { days: 3,     label: '72 hours',   text: 'Acute withdrawal subsides. Sleep is still restless but improving.' },
      { days: 7,     label: '1 week',     text: 'Sleep deepens and your liver begins the first wave of repair.' },
      { days: 14,    label: '2 weeks',    text: 'Skin brightens, mood stabilises, and energy starts to return.' },
      { days: 30,    label: '1 month',    text: 'Blood pressure and liver enzymes move toward healthy ranges.' },
      { days: 90,    label: '3 months',   text: 'Cognitive clarity returns and emotional regulation feels more natural.' },
      { days: 180,   label: '6 months',   text: 'Your body has adapted to life without alcohol. Cravings are rare.' },
      { days: 365,   label: '1 year',     text: 'A full year sober — you have rebuilt your relationship with yourself.' },
    ];
  }

  if (cat === 'caffeine') {
    return [
      { days: 0.5,   label: '12 hours',   text: 'Withdrawal begins — headaches, fatigue, and brain fog may arrive.' },
      { days: 1,     label: '24 hours',   text: 'Headaches often peak. Drink extra water and rest.' },
      { days: 2,     label: '48 hours',   text: 'Caffeine clears your system. The worst symptoms start to fade.' },
      { days: 3,     label: '3 days',     text: 'Energy feels low but stable. Your body is recalibrating.' },
      { days: 7,     label: '1 week',     text: 'Headaches gone. Natural energy starts to return.' },
      { days: 14,    label: '2 weeks',    text: 'Sleep quality improves. No more afternoon crashes.' },
      { days: 30,    label: '1 month',    text: 'Your baseline energy is steady. Cortisol levels normalise.' },
      { days: 90,    label: '3 months',   text: 'Your adenosine receptors have fully rebalanced. Caffeine-free life feels normal.' },
      { days: 365,   label: '1 year',     text: 'You rely on your own energy, not a stimulant, to show up.' },
    ];
  }

  if (cat === 'cannabis') {
    return [
      { days: 1,     label: '24 hours',   text: 'Irritability, anxiety, and vivid dreams may start.' },
      { days: 3,     label: '3 days',     text: 'Sleep is restless and appetite shifts. Your brain is adjusting.' },
      { days: 7,     label: '1 week',     text: 'Cravings ease. Vivid dreams may persist as your REM sleep recovers.' },
      { days: 14,    label: '2 weeks',    text: 'Brain fog lifts. Motivation and mental clarity improve noticeably.' },
      { days: 30,    label: '1 month',    text: 'Short-term memory sharpens. Your emotional baseline feels more even.' },
      { days: 60,    label: '2 months',   text: 'Anxiety and depression symptoms often decrease significantly.' },
      { days: 90,    label: '3 months',   text: 'Dopamine receptors recalibrate. Pleasure from everyday activities returns.' },
      { days: 180,   label: '6 months',   text: 'Your reward system is rewired. You feel present without cannabis.' },
      { days: 365,   label: '1 year',     text: 'A full year of clear-headed living. You know who you are without it.' },
    ];
  }

  if (cat === 'gambling') {
    return [
      { days: 1,     label: '24 hours',   text: 'Urges are intense. Boredom and anxiety are your biggest enemies.' },
      { days: 3,     label: '3 days',     text: 'Cravings spike. Block access to betting apps and venues.' },
      { days: 7,     label: '1 week',     text: 'The initial fog clears. Financial anxiety may hit hard — face it now.' },
      { days: 14,    label: '2 weeks',    text: 'Dopamine receptors start to reset. Small wins in life feel meaningful again.' },
      { days: 30,    label: '1 month',    text: 'Urges become manageable. You are re-learning how to feel without a bet.' },
      { days: 60,    label: '2 months',   text: 'Financial habits stabilise. Impulse control strengthens.' },
      { days: 90,    label: '3 months',   text: 'Your brain\'s reward system recalibrates. Non-gambling pleasures feel real again.' },
      { days: 180,   label: '6 months',   text: 'Gambling feels distant, almost like a story about someone else.' },
      { days: 365,   label: '1 year',     text: 'A full year of freedom. You have rebuilt trust in yourself.' },
    ];
  }

  if (cat === 'porn') {
    return [
      { days: 1,     label: '24 hours',   text: 'Urges hit hard. Your brain is experiencing withdrawal from supernormal stimuli.' },
      { days: 3,     label: '3 days',     text: 'Flat libido and anxiety are common — your brain is resetting sensitivity.' },
      { days: 7,     label: '1 week',     text: 'Cravings persist but begin to weaken. Real-world connections feel different.' },
      { days: 14,    label: '2 weeks',    text: 'Dopamine sensitivity starts recovering. Social interaction feels more rewarding.' },
      { days: 30,    label: '1 month',    text: 'Mental clarity returns. Motivation and focus improve significantly.' },
      { days: 60,    label: '2 months',   text: 'Sexual response normalises. Intimacy feels more authentic.' },
      { days: 90,    label: '3 months',   text: 'Your reward system recalibrates. You notice real people and real life more.' },
      { days: 180,   label: '6 months',   text: 'Supernormal stimuli lose their grip. You feel in control of your desires.' },
      { days: 365,   label: '1 year',     text: 'You have rewired your brain to connect with real life — not pixels on a screen.' },
    ];
  }

  if (cat === 'social_media') {
    return [
      { days: 1,     label: '24 hours',   text: 'FOMO and boredom are intense. You reach for your phone automatically.' },
      { days: 3,     label: '3 days',     text: 'The pull weakens slightly. Silence feels uncomfortable at first.' },
      { days: 7,     label: '1 week',     text: 'You notice how much time you used to waste. Curiosity replaces compulsion.' },
      { days: 14,    label: '2 weeks',    text: 'Focus improves. The urge to check notifications fades.' },
      { days: 30,    label: '1 month',    text: 'You have reclaimed hours each week. Real activities feel more engaging.' },
      { days: 60,    label: '2 months',   text: 'Your attention span deepens. Deep work and reading feel natural again.' },
      { days: 90,    label: '3 months',   text: 'You no longer measure life through a screen. Presence becomes your default.' },
      { days: 180,   label: '6 months',   text: 'Social media feels like a tool, not a trap. You use it intentionally.' },
      { days: 365,   label: '1 year',     text: 'A full year of intentional living. You own your attention.' },
    ];
  }

  if (cat === 'shopping') {
    return [
      { days: 1,     label: '24 hours',   text: 'Urges hit when bored or stressed. Retail therapy is a hard habit to break.' },
      { days: 3,     label: '3 days',     text: 'Financial anxiety and emptiness surface. Avoid browsing online stores.' },
      { days: 7,     label: '1 week',     text: 'The emotional void is visible. You start to see what you were actually filling.' },
      { days: 14,    label: '2 weeks',    text: 'Impulse control strengthens. You question each purchase before making it.' },
      { days: 30,    label: '1 month',    text: 'Dopamine shifts away from buying and toward saving or meaningful goals.' },
      { days: 60,    label: '2 months',   text: 'Your finances visibly improve. Pride in restraint replaces guilt from spending.' },
      { days: 90,    label: '3 months',   text: 'You derive satisfaction from delayed gratification, not instant ownership.' },
      { days: 180,   label: '6 months',   text: 'Money becomes a tool for freedom, not a balm for emotions.' },
      { days: 365,   label: '1 year',     text: 'You have rebuilt your relationship with money and yourself.' },
    ];
  }

  if (cat === 'gaming') {
    return [
      { days: 1,     label: '24 hours',   text: 'Boredom and restlessness hit hard. The world feels flat without the game.' },
      { days: 3,     label: '3 days',     text: 'Irritability peaks. Your brain misses the constant dopamine hits.' },
      { days: 7,     label: '1 week',     text: 'Sleep may improve. You start noticing boredom for the first time.' },
      { days: 14,    label: '2 weeks',    text: 'Real-life activities begin to feel more engaging. Energy returns.' },
      { days: 30,    label: '1 month',    text: 'You have reclaimed dozens of hours. New hobbies feel possible.' },
      { days: 60,    label: '2 months',   text: 'Focus deepens. Social connections outside gaming strengthen.' },
      { days: 90,    label: '3 months',   text: 'Your brain\'s reward system rebalances. Achievement in real life feels rewarding.' },
      { days: 180,   label: '6 months',   text: 'Gaming is just one option among many. You choose it mindfully or not at all.' },
      { days: 365,   label: '1 year',     text: 'A full year of intentional leisure. You are present in your own life.' },
    ];
  }

  if (cat === 'sugar') {
    return [
      { days: 1,     label: '24 hours',   text: 'Headaches, fatigue, and strong cravings for sugar are common.' },
      { days: 2,     label: '48 hours',   text: 'Sugar cravings peak. Your gut bacteria are protesting the change.' },
      { days: 3,     label: '3 days',     text: 'The worst cravings subside. Taste buds start to reset.' },
      { days: 7,     label: '1 week',     text: 'Sugary foods taste overly sweet. You notice natural flavours more.' },
      { days: 14,    label: '2 weeks',    text: 'Energy stabilises. No more sugar crashes mid-afternoon.' },
      { days: 30,    label: '1 month',    text: 'Skin may clear up. Weight loss becomes noticeable. Inflammation decreases.' },
      { days: 60,    label: '2 months',   text: 'Your palate has shifted. Whole foods genuinely taste better.' },
      { days: 90,    label: '3 months',   text: 'Metabolic health improves. Cravings are rare and easy to dismiss.' },
      { days: 365,   label: '1 year',     text: 'You have rebuilt your relationship with food — nourished, not numbed.' },
    ];
  }

  return [
    { days: 1,     label: 'Day 1',      text: 'You made the decision real. That\u2019s the hardest step.' },
    { days: 3,     label: '3 days',     text: 'The first hump — cravings are loudest now, and already learning they don\u2019t win.' },
    { days: 7,     label: '1 week',     text: 'A full week of showing up. New patterns start to take root in your habit loop.' },
    { days: 14,    label: '2 weeks',    text: 'Dopamine receptors begin to recalibrate. The new way feels more familiar.' },
    { days: 30,    label: '1 month',    text: 'A month in — many compulsive habits lose a big chunk of their grip around now.' },
    { days: 66,    label: '~66 days',   text: 'Research suggests a new behaviour becomes automatic around this point.' },
    { days: 90,    label: '3 months',   text: 'Your brain chemistry is stabilising. Identity shifts solidify.' },
    { days: 180,   label: '6 months',   text: 'Half a year. The old habit feels distant. You are someone new now.' },
    { days: 365,   label: '1 year',     text: 'A full year. You rewired a life and rebuilt your relationship with yourself.' },
  ];
}

// ---------- Substance / behaviour info ----------

export const SUBSTANCE_INFO = {
  nicotine: {
    label: 'Nicotine',
    unit: 'cigarettes',
    timeline: [
      { days: 0.02,  label: '20 minutes', text: 'Heart rate and blood pressure start to return to normal.' },
      { days: 0.33,  label: '8 hours',    text: 'Carbon monoxide in your blood drops by half.' },
      { days: 1,     label: '24 hours',   text: 'Your body has cleared most of the nicotine.' },
      { days: 2,     label: '48 hours',   text: 'Nicotine is fully cleared — taste and smell begin to sharpen.' },
      { days: 3,     label: '72 hours',   text: 'Withdrawal peaks, then starts to ease.' },
      { days: 14,    label: '2 weeks',    text: 'Circulation improves; everyday movement gets easier.' },
      { days: 30,    label: '1 month',    text: 'Lungs begin to repair; cravings are fewer and weaker.' },
      { days: 90,    label: '3 months',   text: 'Lung function shows measurable improvement.' },
      { days: 270,   label: '9 months',   text: 'Tiny airways heal — that lingering cough often fades.' },
      { days: 365,   label: '1 year',     text: 'Heart disease risk drops to about half of a smoker\u2019s.' },
    ],
    tips: [
      'Chew sugar-free gum or keep your hands busy with a fidget tool to break the oral/hand habit.',
      'Exercise for 10 minutes when a craving hits — it reduces urge intensity within minutes.',
      'Avoid alcohol and coffee triggers in the first 2 weeks; they are powerful cue triggers.',
      'Tell a friend or join a quit-smoking group — accountability doubles your success rate.',
      'Delay each craving: tell yourself "wait 10 minutes." Most urges pass within that window.',
    ],
  },
  alcohol: {
    label: 'Alcohol',
    unit: 'drinks',
    timeline: [
      { days: 0.25,  label: '6 hours',    text: 'Tremors, anxiety, and nausea may surface as withdrawal begins.' },
      { days: 1,     label: '24 hours',   text: 'Withdrawal peaks. Stay hydrated and seek support if symptoms are severe.' },
      { days: 3,     label: '72 hours',   text: 'Acute withdrawal subsides. Sleep is still restless but improving.' },
      { days: 7,     label: '1 week',     text: 'Sleep deepens and your liver begins the first wave of repair.' },
      { days: 14,    label: '2 weeks',    text: 'Skin brightens, mood stabilises, and energy starts to return.' },
      { days: 30,    label: '1 month',    text: 'Blood pressure and liver enzymes move toward healthy ranges.' },
      { days: 90,    label: '3 months',   text: 'Cognitive clarity returns and emotional regulation feels more natural.' },
      { days: 180,   label: '6 months',   text: 'Your body has adapted to life without alcohol. Cravings are rare.' },
      { days: 365,   label: '1 year',     text: 'A full year sober — you have rebuilt your relationship with yourself.' },
    ],
    tips: [
      'Replace evening drinks with a sparkling water ritual — the ritual satisfies even if the drink does not.',
      'Avoid bars, parties, and alcohol-heavy environments until your confidence is solid.',
      'Find a sober community (AA, SMART Recovery, online groups) — connection replaces the need to drink.',
      'Track how much money you save; visualising the financial gain is a powerful motivator.',
      'Learn the HALT rule: never let yourself get too Hungry, Angry, Lonely, or Tired.',
    ],
  },
  caffeine: {
    label: 'Caffeine',
    unit: 'cups',
    timeline: [
      { days: 0.5,   label: '12 hours',   text: 'Withdrawal begins — headaches, fatigue, and brain fog may arrive.' },
      { days: 1,     label: '24 hours',   text: 'Headaches often peak. Drink extra water and rest.' },
      { days: 2,     label: '48 hours',   text: 'Caffeine clears your system. The worst symptoms start to fade.' },
      { days: 3,     label: '3 days',     text: 'Energy feels low but stable. Your body is recalibrating.' },
      { days: 7,     label: '1 week',     text: 'Headaches gone. Natural energy starts to return.' },
      { days: 14,    label: '2 weeks',    text: 'Sleep quality improves. No more afternoon crashes.' },
      { days: 30,    label: '1 month',    text: 'Your baseline energy is steady. Cortisol levels normalise.' },
      { days: 90,    label: '3 months',   text: 'Your adenosine receptors have fully rebalanced. Caffeine-free life feels normal.' },
      { days: 365,   label: '1 year',     text: 'You rely on your own energy, not a stimulant, to show up.' },
    ],
    tips: [
      'Taper gradually rather than quitting cold turkey — reduce by one cup every 2-3 days.',
      'Switch to decaf or herbal tea to keep the ritual without the caffeine hit.',
      'Prioritise quality sleep so your body can naturally recharge each morning.',
      'Take short movement breaks (5-minute walk) instead of reaching for a caffeine boost.',
      'Stay hydrated — dehydration mimics caffeine withdrawal symptoms and makes them worse.',
    ],
  },
  cannabis: {
    label: 'Cannabis',
    unit: 'sessions',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'Irritability, anxiety, and vivid dreams may start.' },
      { days: 3,     label: '3 days',     text: 'Sleep is restless and appetite shifts. Your brain is adjusting.' },
      { days: 7,     label: '1 week',     text: 'Cravings ease. Vivid dreams may persist as your REM sleep recovers.' },
      { days: 14,    label: '2 weeks',    text: 'Brain fog lifts. Motivation and mental clarity improve noticeably.' },
      { days: 30,    label: '1 month',    text: 'Short-term memory sharpens. Your emotional baseline feels more even.' },
      { days: 60,    label: '2 months',   text: 'Anxiety and depression symptoms often decrease significantly.' },
      { days: 90,    label: '3 months',   text: 'Dopamine receptors recalibrate. Pleasure from everyday activities returns.' },
      { days: 180,   label: '6 months',   text: 'Your reward system is rewired. You feel present without cannabis.' },
      { days: 365,   label: '1 year',     text: 'A full year of clear-headed living. You know who you are without it.' },
    ],
    tips: [
      'Expect vivid dreams for the first 2 weeks — it is your REM sleep recovering, not a bad sign.',
      'Replace the ritual of cannabis with a new evening routine: tea, stretching, or journaling.',
      'Exercise is one of the most effective ways to reduce cannabis cravings and improve mood.',
      'Be honest with supportive friends about your goal so they can avoid offering or using around you.',
      'If you were using for anxiety, explore non-substance coping tools — CBT, meditation, or breathwork.',
    ],
  },
  gambling: {
    label: 'Gambling',
    unit: 'episodes',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'Urges are intense. Boredom and anxiety are your biggest enemies.' },
      { days: 3,     label: '3 days',     text: 'Cravings spike. Block access to betting apps and venues.' },
      { days: 7,     label: '1 week',     text: 'The initial fog clears. Financial anxiety may hit hard — face it now.' },
      { days: 14,    label: '2 weeks',    text: 'Dopamine receptors start to reset. Small wins in life feel meaningful again.' },
      { days: 30,    label: '1 month',    text: 'Urges become manageable. You are re-learning how to feel without a bet.' },
      { days: 60,    label: '2 months',   text: 'Financial habits stabilise. Impulse control strengthens.' },
      { days: 90,    label: '3 months',   text: 'Your brain\u2019s reward system recalibrates. Non-gambling pleasures feel real again.' },
      { days: 180,   label: '6 months',   text: 'Gambling feels distant, almost like a story about someone else.' },
      { days: 365,   label: '1 year',     text: 'A full year of freedom. You have rebuilt trust in yourself.' },
    ],
    tips: [
      'Self-exclude from all betting platforms and casinos — remove the option before the urge hits.',
      'Hand over financial control temporarily to a trusted person to prevent impulsive behaviour.',
      'Track every urge — not just relapses. Seeing craving frequency drop is deeply motivating.',
      'Find a thrill substitute: extreme sports, competitive games, or fitness challenges.',
      'Seek professional help early. Gambling addiction has one of the highest suicide risks of any addiction.',
    ],
  },
  porn: {
    label: 'Porn / Sexual Compulsion',
    unit: 'episodes',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'Urges hit hard. Your brain is experiencing withdrawal from supernormal stimuli.' },
      { days: 3,     label: '3 days',     text: 'Flat libido and anxiety are common — your brain is resetting sensitivity.' },
      { days: 7,     label: '1 week',     text: 'Cravings persist but begin to weaken. Real-world connections feel different.' },
      { days: 14,    label: '2 weeks',    text: 'Dopamine sensitivity starts recovering. Social interaction feels more rewarding.' },
      { days: 30,    label: '1 month',    text: 'Mental clarity returns. Motivation and focus improve significantly.' },
      { days: 60,    label: '2 months',   text: 'Sexual response normalises. Intimacy feels more authentic.' },
      { days: 90,    label: '3 months',   text: 'Your reward system recalibrates. You notice real people and real life more.' },
      { days: 180,   label: '6 months',   text: 'Supernormal stimuli lose their grip. You feel in control of your desires.' },
      { days: 365,   label: '1 year',     text: 'You have rewired your brain to connect with real life — not pixels on a screen.' },
    ],
    tips: [
      'Install content blockers and delete saved material — don\u2019t rely on willpower alone.',
      'When an urge hits, do 20 push-ups or a cold shower — disrupt the pattern physically.',
      'Channel sexual energy into creative output, exercise, or building real relationships.',
      'Practice mindfulness to observe urges without acting on them — they pass faster than you think.',
      'If this behaviour is causing distress, consider speaking with a therapist specialising in sexual health.',
    ],
  },
  social_media: {
    label: 'Social Media',
    unit: 'sessions',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'FOMO and boredom are intense. You reach for your phone automatically.' },
      { days: 3,     label: '3 days',     text: 'The pull weakens slightly. Silence feels uncomfortable at first.' },
      { days: 7,     label: '1 week',     text: 'You notice how much time you used to waste. Curiosity replaces compulsion.' },
      { days: 14,    label: '2 weeks',    text: 'Focus improves. The urge to check notifications fades.' },
      { days: 30,    label: '1 month',    text: 'You have reclaimed hours each week. Real activities feel more engaging.' },
      { days: 60,    label: '2 months',   text: 'Your attention span deepens. Deep work and reading feel natural again.' },
      { days: 90,    label: '3 months',   text: 'You no longer measure life through a screen. Presence becomes your default.' },
      { days: 180,   label: '6 months',   text: 'Social media feels like a tool, not a trap. You use it intentionally.' },
      { days: 365,   label: '1 year',     text: 'A full year of intentional living. You own your attention.' },
    ],
    tips: [
      'Delete the most addictive apps from your phone — keep only the web version for planned use.',
      'Turn off all non-human notifications. Your phone should not decide when to interrupt you.',
      'Replace the first 30 minutes of your day (usually scrolling) with water, movement, or gratitude.',
      'Set a 20-minute daily limit for social media using built-in screen-time tools.',
      'Cultivate a "boredom practice" — sit with quiet discomfort instead of immediately reaching for your phone.',
    ],
  },
  shopping: {
    label: 'Shopping / Spending',
    unit: 'purchases',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'Urges hit when bored or stressed. Retail therapy is a hard habit to break.' },
      { days: 3,     label: '3 days',     text: 'Financial anxiety and emptiness surface. Avoid browsing online stores.' },
      { days: 7,     label: '1 week',     text: 'The emotional void is visible. You start to see what you were actually filling.' },
      { days: 14,    label: '2 weeks',    text: 'Impulse control strengthens. You question each purchase before making it.' },
      { days: 30,    label: '1 month',    text: 'Dopamine shifts away from buying and toward saving or meaningful goals.' },
      { days: 60,    label: '2 months',   text: 'Your finances visibly improve. Pride in restraint replaces guilt from spending.' },
      { days: 90,    label: '3 months',   text: 'You derive satisfaction from delayed gratification, not instant ownership.' },
      { days: 180,   label: '6 months',   text: 'Money becomes a tool for freedom, not a balm for emotions.' },
      { days: 365,   label: '1 year',     text: 'You have rebuilt your relationship with money and yourself.' },
    ],
    tips: [
      'Unsubscribe from all marketing emails and unfollow brands on social media — remove the triggers.',
      'Wait 72 hours before any non-essential purchase. Most impulse buys lose their appeal by then.',
      'Track every purchase in an app. Seeing the numbers creates accountability in real time.',
      'Replace shopping trips with free activities: walks, libraries, or meeting friends.',
      'Build a "splurge fund" — save for one meaningful purchase instead of many small, forgettable ones.',
    ],
  },
  gaming: {
    label: 'Gaming',
    unit: 'sessions',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'Boredom and restlessness hit hard. The world feels flat without the game.' },
      { days: 3,     label: '3 days',     text: 'Irritability peaks. Your brain misses the constant dopamine hits.' },
      { days: 7,     label: '1 week',     text: 'Sleep may improve. You start noticing boredom for the first time.' },
      { days: 14,    label: '2 weeks',    text: 'Real-life activities begin to feel more engaging. Energy returns.' },
      { days: 30,    label: '1 month',    text: 'You have reclaimed dozens of hours. New hobbies feel possible.' },
      { days: 60,    label: '2 months',   text: 'Focus deepens. Social connections outside gaming strengthen.' },
      { days: 90,    label: '3 months',   text: 'Your brain\u2019s reward system rebalances. Achievement in real life feels rewarding.' },
      { days: 180,   label: '6 months',   text: 'Gaming is just one option among many. You choose it mindfully or not at all.' },
      { days: 365,   label: '1 year',     text: 'A full year of intentional leisure. You are present in your own life.' },
    ],
    tips: [
      'Uninstall or hide the game immediately — don\u2019t rely on willpower to resist a click away.',
      'Replace gaming time with a new hobby that also gives a sense of progress: fitness, music, or coding.',
      'Join a sport, club, or group activity — fill the social void gaming often covers.',
      'Use software to limit access to gaming platforms during your recovery period.',
      'Practice sitting with boredom. It is uncomfortable, but it is where new interests are born.',
    ],
  },
  sugar: {
    label: 'Sugar / Junk Food',
    unit: 'treats',
    timeline: [
      { days: 1,     label: '24 hours',   text: 'Headaches, fatigue, and strong cravings for sugar are common.' },
      { days: 2,     label: '48 hours',   text: 'Sugar cravings peak. Your gut bacteria are protesting the change.' },
      { days: 3,     label: '3 days',     text: 'The worst cravings subside. Taste buds start to reset.' },
      { days: 7,     label: '1 week',     text: 'Sugary foods taste overly sweet. You notice natural flavours more.' },
      { days: 14,    label: '2 weeks',    text: 'Energy stabilises. No more sugar crashes mid-afternoon.' },
      { days: 30,    label: '1 month',    text: 'Skin may clear up. Weight loss becomes noticeable. Inflammation decreases.' },
      { days: 60,    label: '2 months',   text: 'Your palate has shifted. Whole foods genuinely taste better.' },
      { days: 90,    label: '3 months',   text: 'Metabolic health improves. Cravings are rare and easy to dismiss.' },
      { days: 365,   label: '1 year',     text: 'You have rebuilt your relationship with food — nourished, not numbed.' },
    ],
    tips: [
      'Keep healthy alternatives visible and accessible: nuts, fruit, dark chocolate, yoghurt.',
      'Read labels — sugar hides in sauces, breads, and drinks under dozens of different names.',
      'Eat protein and fibre at every meal; they blunt sugar cravings by stabilising blood sugar.',
      'Get 7-8 hours of sleep — sleep deprivation dramatically increases sugar cravings.',
      'Cook at home more often. Restaurant and packaged food is engineered to override your satiety signals.',
    ],
  },
  general: {
    label: 'General Habit',
    unit: 'times',
    timeline: [
      { days: 1,     label: 'Day 1',      text: 'You made the decision real. That\u2019s the hardest step.' },
      { days: 3,     label: '3 days',     text: 'The first hump — cravings are loudest now, and already learning they don\u2019t win.' },
      { days: 7,     label: '1 week',     text: 'A full week of showing up. New patterns start to take root in your habit loop.' },
      { days: 14,    label: '2 weeks',    text: 'Dopamine receptors begin to recalibrate. The new way feels more familiar.' },
      { days: 30,    label: '1 month',    text: 'A month in — many compulsive habits lose a big chunk of their grip around now.' },
      { days: 66,    label: '~66 days',   text: 'Research suggests a new behaviour becomes automatic around this point.' },
      { days: 90,    label: '3 months',   text: 'Your brain chemistry is stabilising. Identity shifts solidify.' },
      { days: 180,   label: '6 months',   text: 'Half a year. The old habit feels distant. You are someone new now.' },
      { days: 365,   label: '1 year',     text: 'A full year. You rewired a life and rebuilt your relationship with yourself.' },
    ],
    tips: [
      'Identify your triggers — the people, places, and emotions that set off the habit loop.',
      'Replace the habit, don\u2019t just remove it. Your brain needs a new reward to fill the void.',
      'Track your streak daily. Visual proof of progress is one of the strongest motivators.',
      'Be kind to yourself after a slip-up. One bad day does not erase weeks of progress.',
      'Build a support circle — people who know your goal and will check in on you honestly.',
    ],
  },
};
