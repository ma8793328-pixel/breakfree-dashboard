import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useHabitDetail } from '../useHabitDetail.js';
import { useSubscription } from '../subscription.jsx';
import { coachReply, checkinNote } from '../aiCoach.js';

const OPENERS = [
  "I'm having an urge right now",
  'I had a win today',
  'Motivate me',
  'How am I doing?',
];

const STRATEGY_PICKS = [
  { label: 'Urge surfing', msg: 'Show me urge surfing' },
  { label: '10-min delay', msg: 'Show me the 10-minute delay' },
  { label: '5-4-3-2-1 grounding', msg: 'Show me 5-4-3-2-1 grounding' },
  { label: 'State change', msg: 'Help me change my state' },
  { label: 'Write it out', msg: 'Help me write it out' },
];

function buildCtx(active, detail) {
  return {
    habitName: active?.name,
    streak: active?.stats?.currentStreak ?? 0,
    longestStreak: active?.stats?.longestStreak ?? 0,
    totalClean: active?.stats?.totalClean ?? 0,
    totalSlips: active?.stats?.totalSlips ?? 0,
    todayStatus: active?.stats?.todayStatus ?? null,
    badges: detail?.badges || [],
    urges: detail?.urges || [],
    journals: detail?.journals || [],
    dailyCheckin: detail?.dailyCheckin || null,
  };
}

export default function CoachPage() {
  const { token } = useAuth();
  const { active, loading } = useHabits();
  const { detail } = useHabitDetail(active?.id, token);
  const { premium } = useSubscription();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [streamText, setStreamText] = useState(null);
  const [quick, setQuick] = useState(OPENERS);
  const [showStrategies, setShowStrategies] = useState(false);
  const [mode, setMode] = useState(null);
  const scrollRef = useRef(null);
  const msgCount = useRef(0);

  const ctx = useMemo(() => buildCtx(active, detail), [active, detail]);

  useEffect(() => {
    if (premium) setMode('premium');
    else if (!loading) setMode('locked');
  }, [premium, loading]);

  useEffect(() => {
    if (messages.length === 0 && active && mode === 'premium') {
      const firstName = 'friend';
      const streakLine =
        ctx.streak > 0
          ? `You're on a ${ctx.streak}-day streak for ${active.name}.`
          : ctx.totalClean > 0
            ? `Today is a fresh start for ${active.name} — and I love a good comeback.`
            : `Today is the start of your journey with ${active.name}.`;
      const checkinLine = checkinNote(ctx);
      setMessages([
        {
          id: 1,
          role: 'coach',
          text: `Hi ${firstName} 👋 I'm your coach, and I know your journey — your streaks, your urges, your journal. ${streakLine}${checkinLine ? ` ${checkinLine}` : ''} Whatever comes up — a craving, a win, a rough day — talk to me.`,
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  async function streamReply(habitId, message) {
    const res = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ habitId, message, seed: msgCount.current * 7 }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || 'The coach failed to respond.');
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    let quickReplies = null;
    setStreamText('');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data: ')) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (typeof payload.delta === 'string') {
          acc += payload.delta;
          setStreamText(acc);
        }
        if (payload.done && Array.isArray(payload.quickReplies)) {
          quickReplies = payload.quickReplies;
        }
      }
    }
    if (!acc) throw new Error('The coach went quiet.');
    setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'coach', text: acc }]);
    setStreamText(null);
    return quickReplies;
  }

  async function send(text) {
    const msg = (text || input).trim();
    if (!msg || typing) return;
    msgCount.current += 1;
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: msg }]);
    setInput('');
    setTyping(true);
    try {
      const quickReplies = await streamReply(active.id, msg);
      setQuick(quickReplies || OPENERS);
    } catch {
      const local = coachReply(msg, { ...ctx, seed: msgCount.current * 7 });
      await new Promise((r) => setTimeout(r, 600));
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'coach', text: local.text }]);
      setQuick(local.quickReplies || OPENERS);
    } finally {
      setTyping(false);
      setStreamText(null);
    }
  }

  function pickStrategy(p) {
    setShowStrategies(false);
    send(p.msg);
  }

  if (loading) {
    return (
      <Layout>
        <div className="loading-screen" style={{ minHeight: '50vh' }}>
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  if (mode === 'locked') {
    return (
      <Layout>
        <h1 className="page-title">Coach</h1>
        <p className="page-sub">A warm, wise companion for the hard moments.</p>
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div className="icon" style={{ fontSize: 48 }}>🧠</div>
          <div className="title" style={{ fontSize: 19, fontWeight: 800, color: 'var(--cream)', margin: '10px 0 4px' }}>
            The AI coach is a Premium feature
          </div>
          <p className="muted small">
            Your coach reads your streaks, urges and journal — and talks you through cravings with real context.
            Upgrade to unlock the full conversation.
          </p>
          <button className="btn btn-primary btn-block mt" onClick={() => navigate('/app/premium')}>
            👑 Go Premium
          </button>
          <button className="btn btn-ghost btn-block mt" onClick={() => navigate('/app')}>
            Maybe later
          </button>
        </div>
      </Layout>
    );
  }

  if (!active) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">✨</div>
          <div className="title">No habits yet</div>
          <p>Create a habit first, then I can coach you on it.</p>
          <button className="btn btn-primary mt" onClick={() => navigate('/onboarding')}>
            Create a habit
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div>
        <h1 className="page-title">Coach</h1>
        <p className="page-sub">
          Premium · remembers your journey · {active.name}
        </p>
      </div>

      <div className="chat-wrap" ref={scrollRef}>
        <div className="chat">
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.text}
            </div>
          ))}
          {streamText != null ? (
            <div className="bubble coach">
              {streamText}
              <span className="stream-cursor" aria-hidden="true" />
            </div>
          ) : typing ? (
            <div className="bubble coach">
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="strategy-bar">
        <button
          className={`chip ${showStrategies ? 'active' : ''}`}
          onClick={() => setShowStrategies((v) => !v)}
          disabled={typing}
          aria-expanded={showStrategies}
        >
          🛟 Coping strategies
        </button>
        {showStrategies && (
          <div className="strategy-row">
            {STRATEGY_PICKS.map((p) => (
              <button key={p.msg} className="chip" onClick={() => pickStrategy(p)} disabled={typing}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="quick-replies">
        {quick.map((q) => (
          <button key={q} className="chip" onClick={() => send(q)} disabled={typing}>
            {q}
          </button>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="Talk to me..."
          maxLength={500}
        />
        <button className="btn btn-primary" onClick={() => send()} disabled={!input.trim() || typing}>
          Send
        </button>
      </div>
    </Layout>
  );
}
