// Tiny WebAudio synth - no audio assets needed.
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem('mm_muted') === '1';
} catch {
  /* ignore */
}

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try {
    localStorage.setItem('mm_muted', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function tone(freq, start, dur, type = 'sine', vol = 0.15) {
  const c = ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function play(name) {
  if (muted) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    switch (name) {
      case 'flip': tone(520, 0, 0.08, 'triangle'); break;
      case 'match': tone(660, 0, 0.12); tone(880, 0.1, 0.18); break;
      case 'wrong': tone(220, 0, 0.18, 'sawtooth', 0.08); tone(160, 0.12, 0.22, 'sawtooth', 0.08); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.25, 'triangle')); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.3, 'sawtooth', 0.07)); break;
      default:
    }
  } catch {
    /* audio unavailable */
  }
}
