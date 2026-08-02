import { NavLink } from 'react-router-dom';

function Icon({ name }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    viewBox: '0 0 24 24',
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      );
    case 'urge':
      return (
        <svg {...common}>
          <path d="M12 3c2.5 4 5 5.5 5 10a5 5 0 1 1-10 0c0-4.5 2.5-6 5-10z" />
          <path d="M9.5 18a2.5 2.5 0 0 0 2.5 2.5" />
        </svg>
      );
    case 'journal':
      return (
        <svg {...common}>
          <path d="M6 3h12v18H6z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'stats':
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
        </svg>
      );
    case 'habits':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" />
          <circle cx="15" cy="15" r="3" />
          <path d="M10.5 10.5l3 3M8.8 11.8 5 16M15.2 12.2 19 8" />
        </svg>
      );
    case 'coach':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 5.5L19 10l-5.2 1.5L12 17l-1.8-5.5L5 10l5.2-1.5z" />
          <path d="M19 16l.7 2.1L22 19l-2.3.9L19 22l-.7-2.1L16 19l2.3-.9z" />
        </svg>
      );
    default:
      return null;
  }
}

const TABS = [
  { to: '/app', label: 'Today', icon: 'home', end: true },
  { to: '/app/coach', label: 'Coach', icon: 'coach', end: false },
  { to: '/app/urges', label: 'Urges', icon: 'urge', end: false },
  { to: '/app/journal', label: 'Journal', icon: 'journal', end: false },
  { to: '/app/stats', label: 'Stats', icon: 'stats', end: false },
  { to: '/app/habits', label: 'Habits', icon: 'habits', end: false },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
