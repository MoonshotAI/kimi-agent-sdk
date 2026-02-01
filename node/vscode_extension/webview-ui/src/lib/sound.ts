/**
 * Notification sound utility for Kimi requests.
 * Uses Web Audio API to generate a pleasant chime sound.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext; 
}

/**
 * Play a notification chime. (Neutral tone)
 */
export function playNeutralSound(): void {
  try {
    const ctx = getAudioContext();
    
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    playTone(ctx, 659.25, now, 0.08, 0.15);
    playTone(ctx, 987.77, now + 0.06, 0.05, 0.12);
  } catch {

  }
}

/**
 * Play a notification chime. (Positive tone)
 */
export function playPositiveSound(): void { 
  try {
    const ctx = getAudioContext();
    
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    playTone(ctx, 783.99, now, 0.06, 0.2);
    playTone(ctx, 1046.50, now + 0.08, 0.05, 0.15);
  } catch {

  }
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  attackTime: number,
  duration: number
): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
 
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);
 
  const peakGain = 0.06; 
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, startTime + attackTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}
