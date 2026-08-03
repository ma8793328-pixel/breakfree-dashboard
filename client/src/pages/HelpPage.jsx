import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout.jsx';

const CYCLE_SECS = 19; // 4s in + 7s hold + 8s out
const ROUNDS = 4;

function BreatheCard() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const total = CYCLE_SECS * ROUNDS;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (elapsed >= total) setRunning(false);
  }, [elapsed, total]);

  const pos = elapsed % CYCLE_SECS;
  let phase;
  let secs;
  if (pos < 4) {
    phase = 'Breathe in';
    secs = 4 - pos;
  } else if (pos < 11) {
    phase = 'Hold';
    secs = 11 - pos;
  } else {
    phase = 'Breathe out';
    secs = CYCLE_SECS - pos;
  }

  const start = () => {
    setElapsed(0);
    setRunning(true);
  };

  return (
    <div className="card breathe">
      <p className="breathe-phase">{running || elapsed > 0 ? phase : 'Ready?'}</p>
      {running || elapsed > 0 ? (
        <>
          <div className="breathe-ring" style={{ transform: running ? 'scale(1.18)' : 'scale(1)' }}>
            <span className="breathe-secs">{running && elapsed < total ? secs : '✓'}</span>
          </div>
          <p className="muted small center">
            Round {Math.floor(elapsed / CYCLE_SECS) + 1} of {ROUNDS}
          </p>
        </>
      ) : (
        <p className="muted small center">
          4-7-8 breathing slows your heart rate and gives the urge time to pass.
        </p>
      )}
      <button
        className="btn"
        onClick={() => (running || elapsed > 0 ? setRunning(false) : start())}
      >
        {running ? 'Stop' : 'Start breathing'}
      </button>
    </div>
  );
}

const SUPPORT = [
  {
    title: 'NHS — drug addiction: getting help',
    url: 'https://www.nhs.uk/live-well/addiction-support/drug-addiction-getting-help/',
    desc: 'How to start with the NHS — treatment, talking therapies and local services.',
  },
  {
    title: 'FRANK — find support near you',
    url: 'https://talktofrank.com/get-help/find-support-near-you',
    desc: 'Free local drug & alcohol services in your area.',
  },
  {
    title: 'Narcotics Anonymous',
    url: 'https://www.na.org/',
    desc: 'Free peer support meetings for recovery from addiction — running in the UK and worldwide.',
  },
  {
    title: 'Alcoholics Anonymous',
    url: 'https://www.aa.org/',
    desc: 'Free support groups and a time-tested 12-step programme.',
  },
  {
    title: 'SMART Recovery',
    url: 'https://www.smartrecovery.org/',
    desc: 'Science-based, self-empowering recovery meetings — no labels, no higher power required.',
  },
];

const BLOCKING_TOOLS = [
  {
    title: 'Gamban — block gambling sites',
    url: 'https://gamban.com/',
    desc: 'Blocks gambling apps and websites on all your devices.',
  },
  {
    title: 'BetBlocker — free blocking tool',
    url: 'https://www.betblocker.org/',
    desc: 'Free tool to block access to gambling websites.',
  },
];

const CRISIS = [
  {
    title: 'Crisis Text Line — text GAMBLE',
    url: 'sms:85258&body=GAMBLE',
    desc: 'Text GAMBLE to 85258 (UK) for free, 24/7 crisis support.',
    phone: 'Text GAMBLE to 85258',
  },
];

const HABITS = [
  {
    title: 'Atomic Habits — James Clear',
    url: 'https://jamesclear.com/atomic-habits',
    desc: 'The book behind BreakFree\'s small-steps approach: tiny changes, huge results.',
  },
  {
    title: 'Your coach in BreakFree',
    url: '/app/coach',
    desc: 'Talk it through with the AI coach — it reads your journal and urges to ground every reply.',
  },
];

const NOT_UK = [
  { title: 'SAMHSA Helpline', url: 'https://www.samhsa.gov/find-help/helplines/national-helpline' },
  { title: '988 Lifeline', url: 'https://988lifeline.org/' },
  { title: 'FindTreatment.gov', url: 'https://findtreatment.gov/' },
];

function LinkCard({ item }) {
  return (
    <a className="card help-link" href={item.url} target="_blank" rel="noreferrer">
      <div>
        <p className="settings-title">{item.title}</p>
        <p className="muted small" style={{ marginTop: 2 }}>{item.desc}</p>
        {item.phone && <p className="badge-pill" style={{ marginTop: 8 }}>{item.phone}</p>}
      </div>
      <span className="help-arrow">→</span>
    </a>
  );
}

export default function HelpPage({ urgent = false }) {
  const location = useLocation();
  const isUrgent = urgent || location.state?.urgent || false;

  return (
    <Layout>
      <h1 className="page-title">🫂 Get help</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        You're not alone in this. Free, confidential help is a call or a tap away — day or night.
      </p>

      {isUrgent && (
        <div className="card" style={{ borderLeft: '4px solid #dc2626', background: 'rgba(220, 38, 38, 0.06)' }}>
          <p className="card-title" style={{ color: '#dc2626' }}>⚠️ Urge hitting hard right now</p>
          <p className="muted small">
            You don't have to act on this. Slow your breathing, call a support line, or open the urge tools.
            Most urges peak and fade within 10–20 minutes.
          </p>
          <div className="row mt">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/app/urges')}>
              Open Urge Tools
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/app/help')}>
              Breathe with me
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
        <p className="card-title">Breathe with me</p>
        <BreatheCard />
      </div>

      {isUrgent && (
        <div className="card" style={{ borderLeft: '4px solid #f59e0b', background: 'rgba(245, 158, 11, 0.06)' }}>
          <p className="card-title" style={{ color: '#f59e0b' }}>📞 Talk to someone now</p>
          <div className="settings-list">
            <a className="btn btn-block" href="tel:03001236600">📞 Call FRANK — 0300 123 6600</a>
            <a className="btn btn-block" href="tel:116123">📞 Call Samaritans — 116 123</a>
            {CRISIS.map((c) => (
              <a key={c.title} className="btn btn-block" href={c.url}>
                📱 {c.phone || c.title}
              </a>
            ))}
            <p className="muted small" style={{ marginTop: 10 }}>
              If you feel in immediate danger, call 999 now.
            </p>
          </div>
        </div>
      )}

      {isUrgent && (
        <div className="card">
          <p className="card-title">🛡️ Blocking tools</p>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Take the decision out of your hands — block access to gambling sites and apps.
          </p>
          <div className="settings-list">
            {BLOCKING_TOOLS.map((c) => (
              <LinkCard key={c.title} item={c} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p className="card-title">Drug & alcohol support</p>
        <div className="settings-list">
          {SUPPORT.map((c) => (
            <LinkCard key={c.title} item={c} />
          ))}
        </div>
      </div>

      <div className="card">
        <p className="card-title">Habits & change</p>
        <div className="settings-list">
          {HABITS.map((c) => (
            <LinkCard key={c.title} item={c} />
          ))}
        </div>
      </div>

      {!urgent && (
        <div className="card" style={{ borderLeft: '4px solid #f59e0b', background: 'rgba(245, 158, 11, 0.06)' }}>
          <p className="card-title" style={{ color: '#f59e0b' }}>📞 Talk to someone now</p>
          <div className="settings-list">
            <a className="btn btn-block" href="tel:03001236600">📞 Call FRANK — 0300 123 6600</a>
            <a className="btn btn-block" href="tel:116123">📞 Call Samaritans — 116 123</a>
            {CRISIS.map((c) => (
              <a key={c.title} className="btn btn-block" href={c.url}>
                📱 {c.phone || c.title}
              </a>
            ))}
            <p className="muted small" style={{ marginTop: 10 }}>
              If you feel in immediate danger, call 999 now.
            </p>
          </div>
        </div>
      )}

      <p className="center muted small" style={{ padding: '0 8px 8px' }}>
        Not in the UK?{' '}
        {NOT_UK.map((l, i) => (
          <span key={l.title}>
            <a href={l.url} target="_blank" rel="noreferrer" className="inlink">{l.title}</a>
            {i < NOT_UK.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </p>

      <p className="center muted small" style={{ padding: '0 8px 24px' }}>
        BreakFree is a companion, not a substitute for professional care. If you need medical help,
        call your doctor or an emergency number right away.
      </p>
    </Layout>
  );
}
