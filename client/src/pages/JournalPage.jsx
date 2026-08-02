import { useState } from 'react';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useHabitDetail } from '../useHabitDetail.js';
import { api } from '../api.js';
import { reflectOnJournal } from '../aiCoach.js';

function formatDate(key) {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' });
}

export default function JournalPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const { detail, loading, reload } = useHabitDetail(active?.id, token);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastReflection, setLastReflection] = useState(null);
  const [reflections, setReflections] = useState({});

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
      setError(err.message);
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
        <p className="card-title">How are you feeling today?</p>
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
