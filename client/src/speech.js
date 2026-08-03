let speaking = false;
let currentUtterance = null;

export function speak(text) {
  if (!text || typeof window === 'undefined') return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1;
  currentUtterance = u;
  speaking = true;
  u.onend = () => { speaking = false; currentUtterance = null; };
  u.onerror = () => { speaking = false; currentUtterance = null; };
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  window.speechSynthesis.cancel();
  speaking = false;
  currentUtterance = null;
}

export function isSpeaking() {
  return speaking;
}

export function SpeakerButton({ text, size = 14 }) {
  return null;
}
