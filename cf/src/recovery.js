// Medically-validated recovery milestones, mirrored 1:1 from client/src/data.js
// recoveryTimeline(). Curves are keyed by the classified habit category and every
// entry is { days, label, text }. Milestones are computed from total clean days
// only, matching BADGE_THRESHOLDS and the day-based streak model.

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

const TIMELINES = {
  nicotine: [
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
  alcohol: [
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
  caffeine: [
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
  cannabis: [
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
  gambling: [
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
  porn: [
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
  social_media: [
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
  shopping: [
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
  gaming: [
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
  sugar: [
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
  general: [
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
};

export function recoveryTimeline(name) {
  const cat = classifyHabit(name);
  return TIMELINES[cat] || TIMELINES.general;
}

// Return the active and next medically-validated milestone for a habit based on
// total clean days. Returns { current, next } where each is { label, text, days }
// (or null). "next" includes daysRemaining when set.
export function milestoneFor(name, cleanDays) {
  const timeline = recoveryTimeline(name);
  const days = Number(cleanDays) || 0;
  let current = null;
  let next = null;
  for (const m of timeline) {
    if (days >= m.days) current = { label: m.label, text: m.text, days: m.days };
    else {
      next = { label: m.label, text: m.text, days: m.days, daysRemaining: Math.max(0, Math.ceil(m.days - days)) };
      break;
    }
  }
  return { current, next };
}
