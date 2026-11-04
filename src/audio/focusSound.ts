/** A short camera-style double beep, generated locally after a user gesture. */
let context: AudioContext | null = null;
let lastPlayed = -Infinity;
export function playFocusSound() {
  if (typeof window === 'undefined') return;
  const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return;
  try {
    context ??= new Audio();
    if (context.state === 'closed') context = new Audio();
    const audio = context;
    const play = () => {
      if (audio.state !== 'running' || audio.currentTime - lastPlayed < 0.18) return;
      lastPlayed = audio.currentTime;
      for (const offset of [0, 0.085]) {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        const start = audio.currentTime + offset;
        oscillator.type = 'sine'; oscillator.frequency.value = 1760;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.055, start + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + 0.065);
      }
    };
    if (audio.state === 'suspended') void audio.resume().then(play).catch(() => {});
    else play();
  } catch { /* Audio support must never interfere with focusing. */ }
}
