import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

const INSTANT_ACTIVITIES = [
  { icon: '🚶', title: 'Walk around the block', desc: '5 minutes outside changes the loop.', route: null },
  { icon: '🧊', title: 'Splash cold water on your face', desc: 'A physical reset that snaps you out of autopilot.', route: null },
  { icon: '📞', title: 'Call a friend or buddy', desc: 'Voice contact interrupts the craving loop.', route: null },
  { icon: '🧩', title: 'Do a puzzle or game', desc: 'Occupy your hands and mind for 5 minutes.', route: null },
  { icon: '🏃', title: '10 push-ups or stretches', desc: 'Burn the nervous energy physically.', route: null },
  { icon: '🧘', title: '2-minute breathing exercise', desc: 'Breathe in 4, hold 4, out 4, hold 4.', route: '/app/urges' },
  { icon: '📝', title: 'Write it out in your journal', desc: 'Name the trigger — naming it weakens it.', route: '/app/journal' },
  { icon: '🌊', title: 'Hold an ice cube', desc: 'Intense cold focus shifts your attention instantly.', route: null },
];

const ENVIRONMENT_OPTIONS = [
  { value: 'home', label: 'At home' },
  { value: 'work', label: 'At work or school' },
  { value: 'trigger', label: 'Near a betting shop / casino' },
  { value: 'social', label: 'With people who gamble' },
  { value: 'other', label: 'Somewhere else' },
];

export default function DaysOutPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [area, setArea] = useState('');
  const [radius, setRadius] = useState(10);
  const [ideas, setIdeas] = useState(null);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);
  const [envCheck, setEnvCheck] = useState(null);
  const [showEnvCheck, setShowEnvCheck] = useState(true);

  useEffect(() => {
    loadFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFallback() {
    setError(null);
    setLoading(true);
    try {
      const data = await api('/days-out/ideas', { token });
      setIdeas(data.ideas);
      setSource('fallback');
    } catch (e) {
      setError(e.message);
      setIdeas(null);
    } finally {
      setLoading(false);
    }
  }

  async function fetchIdeas(params) {
    setError(null);
    setLoading(true);
    try {
      const data = await api(`/days-out${params}`, { token });
      setIdeas(data.ideas);
      setSource(data.source || 'overpass');
      if (data.area) setArea(data.area.split(',')[0]);
    } catch (e) {
      if (e.data?.ideas) {
        setIdeas(e.data.ideas);
        setSource('fallback');
        setError(null);
      } else {
        setError(e.message);
        setIdeas(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('Your browser doesn\'t support location. Try an area search instead.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        fetchIdeas(`?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&radius=${radius * 1000}`);
      },
      () => {
        setLocating(false);
        setError('Couldn\'t get your location. Allow location access or search by area instead.');
      },
      { timeout: 10000 }
    );
  }

  function searchArea(e) {
    e.preventDefault();
    if (!area.trim() || loading) return;
    fetchIdeas(`?area=${encodeURIComponent(area.trim())}&radius=${radius * 1000}`);
  }

  function handleEnvSelect(value) {
    setEnvCheck(value);
    setShowEnvCheck(false);
    if (value === 'trigger' || value === 'social') {
      setIdeas(INSTANT_ACTIVITIES);
      setSource('instant');
    }
  }

  function handleActivityClick(act) {
    if (act.route) {
      navigate(act.route);
    }
  }

  if (error && ideas === null) {
    return (
      <Layout>
        <h1 className="page-title">Change of scene</h1>
        <p className="page-sub">An urge is a wave — moving usually rides it out. Find somewhere nearby to go.</p>
        {error && (
          <div className="card empty-state">
            <div className="icon">⚠️</div>
            <div className="title">Couldn't load suggestions</div>
            <p>{error}</p>
            <button className="btn btn-primary mt" onClick={loadFallback}>
              Try again
            </button>
          </div>
        )}
      </Layout>
    );
  }

  return (
    <Layout>
      <h1 className="page-title">Change of scene</h1>
      <p className="page-sub">When an urge hits, change the scene. Here's where to go nearby.</p>

      {showEnvCheck && (
        <div className="card" style={{ borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <p className="card-title">📍 Where are you right now?</p>
          <p className="muted small" style={{ marginBottom: 12 }}>
            This helps us give you the right kind of support right now.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ENVIRONMENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => handleEnvSelect(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {envCheck === 'trigger' && (
        <div className="card" style={{ borderColor: 'rgba(229, 9, 20, 0.4)', background: 'rgba(229, 9, 20, 0.06)' }}>
          <p className="card-title" style={{ color: 'var(--slip)' }}>⚠️ High-risk zone</p>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Being near a betting shop or casino is one of the hardest situations. Don't rely on willpower — use a tool right now.
          </p>
          <div className="row">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/app/urges')}>
              Open Urge Tools
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/app/help')}>
              Get Help
            </button>
          </div>
        </div>
      )}

      {envCheck === 'social' && (
        <div className="card" style={{ borderColor: 'rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.06)' }}>
          <p className="card-title" style={{ color: '#f59e0b' }}>👥 Social risk</p>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Being with people who gamble can feel like pressure. You don't have to join in to belong.
          </p>
          <div className="row">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/app/urges')}>
              Try a coping tool
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/app/coach')}>
              Talk to your coach
            </button>
          </div>
        </div>
      )}

      {source === 'instant' && envCheck && (
        <div className="card">
          <p className="card-title">⚡ 5-minute distractions</p>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Pick one right now. You don't need to commit to anything longer.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {INSTANT_ACTIVITIES.map((act, i) => (
              <button
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 4,
                  padding: 14,
                  textAlign: 'left',
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  cursor: 'pointer',
                }}
                onClick={() => handleActivityClick(act)}
              >
                <span style={{ fontSize: 22 }}>{act.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--cream)' }}>{act.title}</span>
                <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{act.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p className="card-title">📍 Find somewhere nearby</p>
        <div className="row">
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchArea(e)}
            placeholder="Town, city, or neighborhood"
            style={{ flex: 1, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: '13px 14px', fontSize: 15, outline: 'none' }}
            maxLength={80}
          />
        </div>
        <div className="toggle-row">
          <div>
            <div className="toggle-label">Search radius</div>
            <div className="meta">{radius} km</div>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            style={{ flex: 1, maxWidth: 200, accentColor: 'var(--accent)' }}
          />
        </div>
        <div className="row mt">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={searchArea} disabled={loading || !area.trim()}>
            Search
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={useMyLocation} disabled={loading || locating}>
            {locating ? 'Locating...' : 'Use my location'}
          </button>
        </div>
        {error && ideas !== null && <p className="error-text">{error}</p>}
      </div>

      {loading ? (
        <div className="loading-screen" style={{ minHeight: '30vh' }}>
          <div className="breathe-loader" />
          <p className="muted small">Finding spots nearby...</p>
        </div>
      ) : ideas && source !== 'instant' ? (
        <>
          <p className="page-sub">
            {source === 'overpass'
              ? `${ideas.length} spots nearby — change the scene, ride out the urge`
              : 'When you\'re offline, try one of these classics'}
          </p>
          <div className="place-grid">
            {ideas.map((idea, i) => (
              <a
                key={`${idea.name}-${i}`}
                className="place-card"
                href={idea.url}
                target="_blank"
                rel="noreferrer"
                style={idea.photo ? { backgroundImage: `url(${idea.photo})` } : undefined}
              >
                <div className="place-shade" />
                {!idea.photo && <div className="place-icon">{idea.icon || '📍'}</div>}
                <div className="place-info">
                  <div className="place-name">{idea.name}</div>
                  {idea.description && <div className="place-desc">{idea.description}</div>}
                  <div className="place-link">
                    {idea.lat ? 'Open on map' : 'See it'} <span>↗</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </Layout>
  );
}
