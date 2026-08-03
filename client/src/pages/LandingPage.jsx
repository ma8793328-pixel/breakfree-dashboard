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

const HABITS = ['Nicotine', 'Caffeine', 'Sugar', 'Drinking', 'Scrolling', 'Vaping', 'Gaming', 'Gambling'];

const WALL_DAYS = [
  { d: 3, t: 'Nicotine leaves the body' },
  { d: 4, t: 'The hardest day' },
  { d: 5, t: 'Hold the line' },
  { d: 6, t: 'Almost through' },
  { d: 7, t: 'Turning the corner' },
];

const STEPS = [
  { n: '01', title: 'Name it', text: 'Pick the habit. You\u2019re not starting from zero — you\u2019re starting from insight.' },
  { n: '02', title: 'Check in daily', text: 'One honest check-in a day. Miss nothing, force nothing.' },
  { n: '03', title: 'Survive the wall', text: 'Days 3–7 get extra support on purpose. That\u2019s where streaks are made.', wall: true },
  { n: '04', title: 'Watch the body heal', text: 'Sleep, energy, heart rate — the receipts of recovery.' },
];

function HealingChart() {
  return (
    <figure className="landing-chart" role="img" aria-label="Chart showing improvement in sleep quality and a decrease in resting heart rate from day 1 to day 7">
      <svg viewBox="0 0 480 220" className="landing-chart-svg" aria-hidden="true">
        <g className="landing-chart-grid">
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1="40" x2="460" y1={20 + i * 45} y2={20 + i * 45} />
          ))}
        </g>

        <g className="landing-chart-sleep">
          <polyline
            points="40,180 110,160 180,142 250,120 320,96 390,74 460,52"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="460" cy="52" r="6" />
        </g>

        <g className="landing-chart-hr">
          <polyline
            points="40,60 110,74 180,86 250,100 320,118 390,134 460,148"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="460" cy="148" r="6" />
        </g>

        {[1, 2, 3, 4, 5, 6, 7].map((d, i) => (
          <text key={d} x={40 + i * 70} y="210" textAnchor="middle" className="landing-chart-day">
            Day {d}
          </text>
        ))}
      </svg>
      <figcaption className="landing-chart-legend">
        <span><i className="dot dot-sleep" /> Sleep quality</span>
        <span><i className="dot dot-hr" /> Resting heart rate</span>
      </figcaption>
    </figure>
  );
}

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
          <img src="/logo.png" alt="BreakFree" className="logo-badge" />
          <span className="logo-text">BreakFree</span>
        </div>
        <nav className="landing-links" aria-label="Main">
          <a href="#habits">Habits</a>
          <a href="#how">How it works</a>
          <a href="#science">The science</a>
          <a href="#features">Features</a>
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
          BreakFree gets you through the brutal Day 3–7 wall — for nicotine, caffeine, scrolling,
          drinking or any habit you choose — with survival-mode coaching, daily check-ins and a
          health trend you can watch heal.
        </p>
        <div className="landing-hero-actions">
          <Link className="btn btn-primary btn-lg" to="/signup">Start your free journey</Link>
          <a className="btn btn-ghost btn-lg" href="#science">Read the science</a>
        </div>
        <p className="landing-account-link">
          <Link to="/login">I already have an account</Link>
        </p>

        <div className="landing-proof">
          <span className="landing-proof-badge">Join a growing community of people breaking habits</span>
          <span className="landing-proof-count">
            {shareTotal != null && shareTotal > 0
              ? `${shareTotal.toLocaleString()} milestone${shareTotal === 1 ? '' : 's'} reached by the community`
              : 'Free to start · no credit card needed'}
          </span>
        </div>
      </section>

      <section className="landing-section" id="habits">
        <h2 className="landing-h2">Works for any habit</h2>
        <p className="landing-sub landing-sub-narrow">
          Nicotine is the classic case — on day 3 it leaves the body and fights back for a week.
          The same withdrawal curve shows up for caffeine, sugar, drinking, scrolling and more.
        </p>
        <div className="landing-habits" role="list" aria-label="Supported habits">
          {HABITS.map((h) => (
            <span className="landing-habit" role="listitem" key={h}>{h}</span>
          ))}
        </div>
      </section>

      <section className="landing-section" id="how">
        <h2 className="landing-h2">How it works</h2>
        <div className="landing-grid landing-grid-4">
          {STEPS.map((s) => (
            <div className={`landing-step${s.wall ? ' landing-step-wall' : ''}`} key={s.n}>
              <div className="landing-step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              {s.wall && (
                <div className="landing-wall-mini" aria-label="Day 3 to 7 timeline">
                  {WALL_DAYS.map((d) => (
                    <span className="landing-wall-mini-day" key={d.d}>
                      <b>{d.d}</b>
                      {d.t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta-strip">
        <span>Ready when you are.</span>
        <Link className="btn btn-primary" to="/signup">Start free</Link>
      </section>

      <section className="landing-section" id="science">
        <div className="landing-science">
          <div className="landing-science-copy">
            <p className="hero-kicker">Receipts of recovery</p>
            <h2 className="landing-h2">The body heals on a schedule.</h2>
            <p className="landing-sub">
              Day 3 is when nicotine leaves the body — and when the craving fights back hardest.
              BreakFree switches into survival mode right there: extra nudges, twice-daily
              reminders, and a recovery readout that shows what your body is repairing right now.
              The same curve applies to any habit you choose.
            </p>
            <div className="landing-coach" aria-label="Example coach message">
              <span className="landing-coach-avatar">🧑‍🏫</span>
              <p className="landing-coach-bubble">
                Coach: “Day 4 is tough — but your resting heart rate is already coming down.
                Try the 2-minute breathing exercise.”
              </p>
            </div>
            <div className="landing-science-actions">
              <Link className="btn btn-primary" to="/signup">Start free</Link>
              <a className="btn btn-ghost" href="#how">See how it works</a>
            </div>
          </div>
          <HealingChart />
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

      <section className="landing-section" id="testimonials">
        <h2 className="landing-h2">Real stories are on the way</h2>
        <div className="landing-testimonials-soon">
          <p className="landing-sub landing-sub-narrow">
            We're collecting honest stories from our community — the wins, the slips, the day-4
            walls crossed. Be one of the first to share yours.
          </p>
          <Link className="btn btn-primary" to="/signup">Start your story</Link>
        </div>
      </section>

      <section className="landing-cta">
        <h2 className="landing-h2">Your streak starts with one check-in.</h2>
        <div className="landing-hero-actions">
          <Link className="btn btn-primary btn-lg" to="/signup">Start today — free</Link>
          <a className="btn btn-ghost btn-lg" href="#science">Read the science</a>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="landing-footer-brand">
          <img src="/logo.png" alt="BreakFree" style={{ width: 20, height: 20, verticalAlign: 'middle', marginRight: 6 }} />
          BreakFree
        </span>
        <span className="muted small">Built to get you through the wall.</span>
        <br />
        <a href="mailto:support@breakfree.app" className="legal-link">support@breakfree.app</a>
      </footer>
    </div>
  );
}
