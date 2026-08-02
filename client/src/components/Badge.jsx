import { MILESTONES } from '../data.js';

export default function Badge({ threshold, earned }) {
  const meta = MILESTONES.find((m) => m.days === threshold) || {
    label: `${threshold} Days`,
    icon: '⭐',
    tier: '#888888',
  };
  return (
    <div className={`badge${earned ? ' earned' : ''}`} style={{ '--tier': meta.tier }}>
      <div className="medal">{meta.icon}</div>
      <span className="days">{earned ? meta.label : `${threshold}d`}</span>
    </div>
  );
}
