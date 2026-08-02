// Dependency-free SVG trend chart for daily wellness check-ins.
// Renders one polyline per metric on a 1-5 scale, with dots and an average label.

export const METRICS = [
  { key: 'energy', label: 'Energy', color: '#4A90D9' },
  { key: 'sleep', label: 'Sleep', color: '#9B59B6' },
  { key: 'mood', label: 'Mood', color: '#F5A623' },
];

const W = 320;
const H = 120;
const PAD_X = 8;
const PAD_Y = 12;

function points(series, width) {
  if (!series || series.length === 0) return '';
  const step = (width - PAD_X * 2) / Math.max(series.length - 1, 1);
  return series
    .map((v, i) => {
      const x = PAD_X + i * step;
      const y = PAD_Y + (H - PAD_Y * 2) * (1 - v / 5);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function avg(series) {
  if (!series || series.length === 0) return null;
  return series.reduce((s, v) => s + v, 0) / series.length;
}

export default function TrendChart({ data, metrics = METRICS, height = H }) {
  const days = data || [];
  const nonEmpty = metrics.filter((m) => days.some((d) => d[m.key] != null));

  if (days.length === 0 || nonEmpty.length === 0) {
    return (
      <p className="muted small">
        No check-in history yet — log a few daily check-ins and your trends will appear here.
      </p>
    );
  }

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="7-day trends for energy, sleep and mood">
        {[1, 2, 3, 4, 5].map((v) => (
          <line
            key={v}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_Y + (height - PAD_Y * 2) * (1 - v / 5)}
            y2={PAD_Y + (height - PAD_Y * 2) * (1 - v / 5)}
            stroke="rgba(245,245,241,0.08)"
            strokeWidth="1"
          />
        ))}
        {nonEmpty.map((m) => (
          <g key={m.key}>
            <polyline
              points={points(days.map((d) => d[m.key]), W)}
              fill="none"
              stroke={m.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {days.map((d, i) =>
              d[m.key] == null ? null : (
                <circle
                  key={i}
                  cx={PAD_X + (i * (W - PAD_X * 2)) / Math.max(days.length - 1, 1)}
                  cy={PAD_Y + (height - PAD_Y * 2) * (1 - d[m.key] / 5)}
                  r="2.5"
                  fill="#0B0B0D"
                  stroke={m.color}
                  strokeWidth="1.5"
                />
              )
            )}
          </g>
        ))}
      </svg>
      <div className="trend-legend">
        {nonEmpty.map((m) => {
          const a = avg(days.map((d) => d[m.key]));
          return (
            <span key={m.key} className="trend-legend-item">
              <span className="trend-dot" style={{ background: m.color }} />
              {m.label} {a != null ? `${a.toFixed(1)}/5` : '—'}
            </span>
          );
        })}
      </div>
    </div>
  );
}
