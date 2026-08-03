import { useState, useEffect } from 'react';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useHabitDetail } from '../useHabitDetail.js';
import { api } from '../api.js';
import { reflectOnJournal } from '../aiCoach.js';
import { todayPrompt, randomPrompt } from '../data.js';

const JOURNAL_QUEUE_KEY = 'bf_journal_queue';

function readJournalQueue() {
  try {
    const raw = localStorage.getItem(JOURNAL_QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeJournalQueue(list) {
  try {
    localStorage.setItem(JOURNAL_QUEUE_KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked
  }
}

async function flushJournalQueue(token) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const queue = readJournalQueue();
  if (queue.length === 0) return false;
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    try {
      await api(`/habits/${entry.habitId}/journals`, {
        method: 'POST',
        token,
        body: { content: entry.content },
      });
      queue.splice(i, 1);
      i -= 1;
    } catch (err) {
      if (!err.status) {
        writeJournalQueue(queue);
        return false;
      }
      if (err.status >= 500) continue;
      queue.splice(i, 1);
      i -= 1;
    }
  }
  writeJournalQueue(queue);
  return true;
}

function formatDate(key) {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' });
}

export default function JournalPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const { detail, loading, reload } = useHabitDetail(active?.id, token);
  const [content, setContent] = useState('');
  const [prompt, setPrompt] = useState(() => todayPrompt());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastReflection, setLastReflection] = useState(null);
  const [reflections, setReflections] = useState({});
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      if (token) flushJournalQueue(token).then(() => reload());
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [token, reload]);

  if (!active) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">📓</div>
          <div className="title">No habits yet</div>
          <p>Create a habit to start journaling.</p>
        </div>
      </Layout>
    );
  }

  const entries = detail?.journals || [];
  const ctx = {
    habitName: active.name,
    streak: active.stats?.currentStreak ?? 0,
    totalClean: active.stats?.totalClean ?? 0,
    totalSlips: active.stats?.totalSlips ?? 0,
    badges: detail?.badges || [],
    urges: detail?.urges || [],
    journals: entries,
  };

  async function submit(e) {
    e.preventDefault();
    if (!content.trim() || busy) return;
    setBusy(true);
    setError(null);
    const text = content.trim();
    try {
      const res = await api(`/habits/${active.id}/journals`, {
        method: 'POST',
        token,
        body: { content: text },
      });
      setContent('');
      await reload();
      setLastReflection(reflectOnJournal(text, ctx));
      if (res.entry) {
        setReflections((prev) => ({ ...prev, [res.entry.id]: reflectOnJournal(text, ctx) }));
      }
    } catch (err) {
      if (!navigator.onLine) {
        const queue = readJournalQueue();
        queue.push({ habitId: active.id, content: text, date: new Date().toISOString() });
        writeJournalQueue(queue);
        setContent('');
        setLastReflection(reflectOnJournal(text, ctx));
        setError('Saved locally — will sync when you\'re back online.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleReflection(id, text) {
    setReflections((prev) => ({
      ...prev,
      [id]: prev[id] ? null : reflectOnJournal(text, ctx),
    }));
  }

  return (
    <Layout>
      <h1 className="page-title">Journal</h1>
      <p className="page-sub">For {active.name}</p>

      <form className="card" onSubmit={submit}>
        {!isOnline && (
          <p className="muted small" style={{ marginBottom: 8, color: 'var(--accent)' }}>
            📴 Offline — entries will sync when you're back online.
          </p>
        )}
        <p className="card-title">How are you feeling today?</p>
        <div className="prompt-card">
          <span className="prompt-label">✍️ Today's prompt</span>
          <button
            type="button"
            className="prompt-text"
            onClick={() => setContent((c) => (c ? c : prompt))}
            title="Tap to use this prompt"
          >
            {prompt}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setPrompt(randomPrompt(prompt))}
          >
            🔄 Another prompt
          </button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="A win, a struggle, a thought worth keeping..."
          maxLength={2000}
          style={{ width: '100%', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 14, fontFamily: 'var(--font-body)', fontSize: 15, minHeight: 130, resize: 'vertical' }}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-block mt" type="submit" disabled={busy || !content.trim()}>
          {busy ? 'Saving...' : 'Save entry'}
        </button>
      </form>

      {lastReflection && (
        <div className="reflection-card">
          <div className="head">✨ Coach reflection</div>
          <div className="text">{lastReflection}</div>
        </div>
      )}

      {loading ? (
        <div className="loading-screen" style={{ minHeight: '30vh' }}>
          <div className="spinner" />
        </div>
      ) : entries.length === 0 ? (
        <div className="card empty-state">
          <div className="icon">🌱</div>
          <div className="title">No entries yet</div>
          <p>Writing even one line a day gives you something to look back on.</p>
        </div>
      ) : (
        <div className="list">
          {entries.map((e) => (
            <div className="card" key={e.id} style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="meta">{formatDate(e.date)}</div>
                <button className="chip" onClick={() => toggleReflection(e.id, e.content)}>
                  {reflections[e.id] ? 'Hide reflection' : '✨ Reflect'}
                </button>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 15, marginTop: 8 }}>{e.content}</p>
              {reflections[e.id] && (
                <div className="reflection-card" style={{ marginTop: 10 }}>
                  <div className="head">✨ Coach reflection</div>
                  <div className="text">{reflections[e.id]}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
