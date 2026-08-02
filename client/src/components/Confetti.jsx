import { useEffect, useState } from 'react';

const COLORS = ['#E50914', '#FF3B44', '#A8C09A', '#C97B63', '#F5F5F1', '#FFB84D'];

export default function Confetti({ count = 40 }) {
  const [pieces, setPieces] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 7 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 0.6,
      duration: 2 + Math.random() * 1.4,
      drift: (Math.random() - 0.5) * 160,
      round: Math.random() > 0.7,
    }))
  );

  useEffect(() => {
    const t = setTimeout(() => setPieces([]), 3600);
    return () => clearTimeout(t);
  }, []);

  if (pieces.length === 0) return null;

  return (
    <div className="confetti-layer">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.round ? '50%' : '2px',
            '--drift': `${p.drift}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
