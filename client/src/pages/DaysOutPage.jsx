import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

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
            <button className="btn btn-primary mt" onClick={searchNearby}>
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
          <div className="spinner" />
        </div>
      ) : ideas ? (
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
