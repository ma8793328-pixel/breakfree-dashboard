export const MILESTONES = [
  { days: 7, label: 'Rookie', icon: '🌱', tier: '#CD7F32' },
  { days: 14, label: 'Steadfast', icon: '✨', tier: '#C0C0C0' },
  { days: 30, label: 'Champion', icon: '🌙', tier: '#F5A623' },
  { days: 60, label: 'Dedicated', icon: '🌤️', tier: '#00B894' },
  { days: 90, label: 'Elite', icon: '🌟', tier: '#4A90D9' },
  { days: 180, label: 'Veteran', icon: '🌞', tier: '#9B59B6' },
  { days: 365, label: 'Legend', icon: '👑', tier: '#E50914' },
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
