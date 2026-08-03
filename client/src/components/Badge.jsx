import { MILESTONES, SKILL_BADGES } from '../data.js';

export default function Badge({ threshold, earned, skill }) {
  let meta;
  if (skill) {
    meta = SKILL_BADGES.find((s) => s.id === skill) || {
      label: skill,
      icon: '⭐',
      tier: '#888888',
    };
  } else {
    meta = MILESTONES.find((m) => m.days === threshold) || {
      label: `${threshold} Days`,
      icon: '⭐',
      tier: '#888888',
    };
  }
  return (
    <div className={`badge${earned ? ' earned' : ''}`} style={{ '--tier': meta.tier }} title={meta.desc || `${threshold} days`}>
      <div className="medal">{meta.icon}</div>
      <span className="days">{earned ? meta.label : (meta.desc || `${threshold}d`)}</span>
    </div>
  );
}
