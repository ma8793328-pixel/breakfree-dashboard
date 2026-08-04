const TOPIC_KEYWORDS = {
  stress: ['stress', 'stressed', 'pressure', 'overwhelm', 'anxious', 'nervous', 'panic', 'worry', 'worried'],
  sleep: ['sleep', 'tired', 'exhausted', 'insomnia', 'woke up', 'nightmare', 'restless', 'awake'],
  work: ['work', 'job', 'boss', 'interview', 'shift', 'coworker', 'meeting', 'deadline', 'colleague'],
  cravings: ['craving', 'urge', 'want to', 'miss', 'smell', 'trigger', 'itch', 'want one', 'need one'],
  wins: ['proud', 'did it', 'made it', 'resisted', 'clean', 'streak', 'win', 'won', 'good day'],
  slips: ['slip', 'relapse', 'broke', 'caved', 'failed', 'gave in', 'messed up', 'reset'],
  social: ['friend', 'mate', 'partner', 'family', 'alone', 'lonely', 'date', 'party', 'dinner'],
  mood: ['sad', 'down', 'happy', 'good', 'rough', 'hard', 'okay', 'low', 'heavy', 'numb'],
  health: ['energy', 'sick', 'headache', 'pain', 'dizzy', 'cough', 'throat', 'breath'],
  money: ['money', 'save', 'spent', 'cost', 'pound', 'quid', 'expensive', 'afford'],
};

const FOLLOW_UP_MAP = {
  work: 'ask about work',
  sleep: 'check sleep',
  stress: 'ask what\'s stressing them',
  slips: 'check in gently, no shame',
  cravings: 'ask how the urge passed',
  social: 'ask about the situation',
  mood: 'ask how they\'re feeling now',
  health: 'ask about symptoms',
  money: 'ask about savings',
};

function extractTopics(message) {
  const lower = String(message || '').toLowerCase();
  const matched = new Set();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) matched.add(topic);
  }
  return [...matched];
}

function generateFollowUps(topics) {
  return topics
    .map((t) => FOLLOW_UP_MAP[t])
    .filter(Boolean)
    .slice(0, 3);
}

function deriveMoodTrend(topics) {
  const negative = new Set(['stress', 'slips', 'mood', 'sleep']);
  const positive = new Set(['wins', 'health', 'money']);
  const negCount = topics.filter((t) => negative.has(t)).length;
  const posCount = topics.filter((t) => positive.has(t)).length;
  if (negCount > posCount) return 'low';
  if (posCount > negCount) return 'improving';
  return 'stable';
}

function pruneFollowUps(followUps) {
  if (!Array.isArray(followUps)) return [];
  const now = Date.now();
  return followUps
    .filter((fu) => {
      if (typeof fu === 'string') return true;
      const ageHours = (now - new Date(fu.created_at || 0).getTime()) / (1000 * 60 * 60);
      return ageHours < 24;
    })
    .map((fu) => (typeof fu === 'string' ? fu : fu.topic));
}

function memoryRowToState(row) {
  if (!row) return null;
  return {
    topics: JSON.parse(row.topics || '[]'),
    follow_ups: pruneFollowUps(JSON.parse(row.follow_ups || '[]')),
    mood_trend: row.mood_trend || 'stable',
    last_topic: row.last_topic || '',
    updated_at: row.updated_at,
  };
}

export function extractTopicsFromMessage(message) {
  return extractTopics(message);
}

export function buildFollowUps(topics, message) {
  return generateFollowUps(topics);
}

export function pruneMemoryFollowUps(followUps) {
  return pruneFollowUps(followUps);
}

export async function loadMemory(db, userId, habitId) {
  const row = db
    .prepare('SELECT topics, follow_ups, mood_trend, last_topic, updated_at FROM coach_memories WHERE user_id = ? AND habit_id = ?')
    .get(userId, habitId);
  return memoryRowToState(row);
}

export async function saveMemory(db, userId, habitId, message) {
  try {
    const topics = extractTopics(message);
    const existing = await loadMemory(db, userId, habitId);
    const mergedTopics = [...new Set([...(existing?.topics || []), ...topics])].slice(-10);
    const newFollowUps = generateFollowUps(topics).map((topic) => ({
      topic,
      created_at: new Date().toISOString(),
    }));
    const combinedFollowUps = pruneFollowUps([...(existing?.follow_ups || []), ...newFollowUps]);
    const moodTrend = deriveMoodTrend(mergedTopics);
    const lastTopic = mergedTopics[mergedTopics.length - 1] || '';

    db.prepare(
      `INSERT INTO coach_memories (user_id, habit_id, topics, follow_ups, mood_trend, last_topic, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, habit_id) DO UPDATE SET
         topics = excluded.topics,
         follow_ups = excluded.follow_ups,
         mood_trend = excluded.mood_trend,
         last_topic = excluded.last_topic,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      habitId,
      JSON.stringify(mergedTopics),
      JSON.stringify(combinedFollowUps),
      moodTrend,
      lastTopic,
    );
  } catch (e) {
    console.error('saveMemory failed (memory is best-effort):', e.message);
  }
}

export function memoryToPrompt(memory) {
  if (!memory) return '';
  const parts = [];
  if (memory.topics.length > 0) parts.push(`Last talked about: ${memory.topics.join(', ')}`);
  if (memory.follow_ups.length > 0) parts.push(`Follow up on: ${memory.follow_ups.join(', ')}`);
  if (memory.mood_trend && memory.mood_trend !== 'stable') parts.push(`Mood trend: ${memory.mood_trend}`);
  if (memory.last_topic) parts.push(`Last topic: ${memory.last_topic}`);
  if (parts.length === 0) return '';
  return `CONVERSATION MEMORY:\n${parts.join('\n')}\nWeave this in naturally. Don't list it. Don't say "last time you mentioned." Just reference it like a friend would.\n`;
}
