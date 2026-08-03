import { useEffect } from 'react';
import Confetti from './Confetti.jsx';
import SpeakButton from './SpeakButton.jsx';

export default function Celebration({ kind, quote, badge, onClose, onShare }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const isClean = kind === 'clean';
  const meta = badge
    ? { icon: '🏆', title: 'Milestone reached!', line: `${badge.threshold} days of showing up for yourself.` }
    : null;

  return (
    <>
      {isClean && <Confetti />}
      <div className="celebration" onClick={onClose}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="big-icon">{meta ? meta.icon : isClean ? '🌤️' : '🌅'}</div>
          <SpeakButton text={meta ? meta.line : isClean ? 'You checked in. One more day...' : 'A slip is a data point...'} />
          <h2>{meta ? meta.title : isClean ? 'Another day, yours.' : 'That\'s okay.'}</h2>
          <p className="desc">
            {meta
              ? meta.line
              : isClean
                ? 'You checked in. One more day of building the person you want to be.'
                : 'A slip is a data point, not a verdict. Your streak resets, but your journey doesn\'t. Take a breath, keep going tomorrow.'}
          </p>
          {quote && (
            <div className="quote" style={{ marginBottom: 20 }}>
              “{quote.text}”
              <span className="source">{quote.source}</span>
            </div>
          )}
          {meta && onShare && (
            <button className="btn btn-block" onClick={onShare} style={{ marginBottom: 10 }}>
              📣 Share with the community
            </button>
          )}
          <button className="btn btn-primary btn-block" onClick={onClose}>
            {isClean ? 'Keep going' : 'Tomorrow is a new day'}
          </button>
        </div>
      </div>
    </>
  );
}
