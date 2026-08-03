import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchShareTotal } from '../api.js';

const FEATURES = [
  { icon: '🧱', title: 'The Day 3–7 Wall', text: 'The hardest stretch of any quit gets its own survival mode, extra nudges and a daily recovery readout.' },
  { icon: '🌿', title: 'One-day check-ins', text: 'A tiny daily act — clean or slip, no judgement — that quietly builds a streak you don\u2019t want to break.' },
  { icon: '⚡', title: 'Urge logging', text: 'Catch urges as they rise. Logging one takes ten seconds and makes the next wave smaller.' },
  { icon: '📈', title: 'Health tracking', text: 'Steps, sleep and resting heart rate — see your body get better, not just your streak.' },
  { icon: '🧑‍🏫', title: 'A coach on your side', text: 'Reads your check-ins and urges, and tells you exactly what\u2019s working.' },
  { icon: '💌', title: 'Weekly digest', text: 'A Sunday summary of clean days, urges, savings and what to focus on next week.' },
];

const STEPS = [
  { n: '01', title: 'Name it', text: 'Pick the habit. You\u2019re not starting from zero — you\u2019re starting from insight.' },
  { n: '02', title: 'Check in daily', text: 'One honest check-in a day. Miss nothing, force nothing.' },
  { n: '03', title: 'Survive the wall', text: 'Days 3–7 get extra support on purpose. That\u2019s where streaks are made.' },
  { n: '04', title: 'Watch the body heal', text: 'Sleep, energy, heart rate — the receipts of recovery.' },
];

export default function LandingPage() {
  const [shareTotal, setShareTotal] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchShareTotal()
      .then((d) => {
        if (!cancelled) setShareTotal(d.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-logo">
          <span className="logo-badge">🔥</span>
          <span className="logo-text">BreakFree</span>
        </div>
        <nav className="landing-links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#wall">The Wall</a>
        </nav>
        <div className="landing-actions">
          <Link className="btn btn-ghost btn-sm" to="/login">Log in</Link>
          <Link className="btn btn-primary btn-sm" to="/signup">Start free</Link>
        </div>
      </header>

      <section className="landing-hero">
        <p className="hero-kicker">Break any habit · one day at a time</p>
        <h1 className="landing-title">
          The hardest days<br />deserve the most support.
        </h1>
        <p className="landing-sub">
          BreakFree gets you through the brutal Day 3–7 wall with survival-mode messaging, daily
          check-ins, urge logging and a health trend you can watch heal.
        </p>
        <div className="landing-hero-actions">
          <Link className="btn btn-primary btn-lg" to="/signup">Start your free journey</Link>
          <Link className="btn btn-ghost btn-lg" to="/login">I already have an account</Link>
        </div>
        <p className="landing-proof">
          {shareTotal != null
            ? `${shareTotal.toLocaleString()} milestone${shareTotal === 1 ? '' : 's'} reached by the community`
            : 'Free to start · no credit card needed'}
        </p>
      </section>

      <section className="landing-section" id="how">
        <h2 className="landing-h2">How it works</h2>
        <div className="landing-grid landing-grid-4">
          {STEPS.map((s) => (
            <div className="landing-step" key={s.n}>
              <div className="landing-step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="wall">
        <div className="landing-wall">
          <div>
            <p className="hero-kicker">The Day 3–7 Wall</p>
            <h2 className="landing-h2">Nicotine leaves your body on day 3. It fights back until day 7.</h2>
            <p className="landing-sub">
              That&rsquo;s when most people quit quitting. So BreakFree switches into survival mode:
              extra nudges, twice-daily reminders, a recovery checklist that shows what your body is
              repairing right now, and a coach that knows day 4 is statistically the hardest.
            </p>
          </div>
          <div className="landing-wall-days">
            {[3, 4, 5, 6, 7].map((d) => (
              <div className="landing-wall-day" key={d}>
                <span className="landing-wall-day-n">Day {d}</span>
                <div className="limit-bar"><div className="limit-fill" style={{ width: `${100 - d * 8}%` }} /></div>
                <span className="landing-wall-day-t">{d === 7 ? 'Turning the corner' : d === 4 ? 'Hardest day' : 'Hold the line'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" id="features">
        <h2 className="landing-h2">Everything on your side</h2>
        <div className="landing-grid landing-grid-3">
          {FEATURES.map((f) => (
            <div className="card landing-feature" key={f.title}>
              <span className="landing-feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2 className="landing-h2">Your streak starts with one check-in.</h2>
        <Link className="btn btn-primary btn-lg" to="/signup">Start today — free</Link>
      </section>

      <footer className="landing-footer">
        <span>BreakFree</span>
        <span className="muted small">Built to get you through the wall.</span>
      </footer>
    </div>
  );
}
