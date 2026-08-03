import { useCallback } from 'react';
import { speak, stopSpeaking, isSpeaking } from '../speech.js';

export default function SpeakButton({ text, size = 14 }) {
  const speaking = isSpeaking();
  const handleClick = useCallback(() => {
    if (speaking) {
      stopSpeaking();
    } else {
      speak(text);
    }
  }, [text, speaking]);
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
      title={speaking ? 'Stop' : 'Read aloud'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: size,
        padding: '2px 4px',
        opacity: 0.7,
        lineHeight: 1,
        marginLeft: 6,
      }}
    >
      {speaking ? '🔇' : '🔊'}
    </button>
  );
}
