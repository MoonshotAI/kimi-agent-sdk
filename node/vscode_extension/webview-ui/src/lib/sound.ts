type Mood = "neutral" | "positive" | "negative";

const AUDIO_CONFIG = {
  peakGain: 0.06,
  oscillatorType: "sine" as const,
} as const;

const FREQ: Record<Mood, readonly [number, number]> = {
  neutral: [659.25, 987.77],
  positive: [783.99, 1046.5],
  negative: [200, 150],
} as const;

const TIMING: Record<
  Mood,
  {
    first: { attack: number; duration: number };
    second: { delay: number; attack: number; duration: number };
  }
> = {
  neutral: { first: { attack: 0.08, duration: 0.15 }, second: { delay: 0.06, attack: 0.05, duration: 0.12 } },
  positive: { first: { attack: 0.06, duration: 0.2 }, second: { delay: 0.08, attack: 0.05, duration: 0.15 } },
  negative: { first: { attack: 0.1, duration: 0.3 }, second: { delay: 0.15, attack: 0.1, duration: 0.25 } },
} as const;

let audioCtxPromise: Promise<AudioContext> | null = null;

async function getAudioContext(): Promise<AudioContext> {
  if (audioCtxPromise) return audioCtxPromise;
  audioCtxPromise = new Promise<AudioContext>((resolve, reject) => {
    try {
      if (typeof window === "undefined") throw new Error("No window");
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctor) throw new Error("Web Audio not supported");
      resolve(new Ctor());
    } catch (err) {
      reject(err);
    }
  });
  return audioCtxPromise;
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

  oscillator.type = AUDIO_CONFIG.oscillatorType;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(AUDIO_CONFIG.peakGain, startTime + attackTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);

  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    gainNode.disconnect();
  });
}

async function playMood(mood: Mood): Promise<void> {
  try {
    const ctx = await getAudioContext();
    if (ctx.state !== "running") {
      await ctx.resume();
    }
    const now = ctx.currentTime;
    const timing = TIMING[mood];
    const freqs = FREQ[mood];
    playTone(ctx, freqs[0], now, timing.first.attack, timing.first.duration);
    playTone(ctx, freqs[1], now + timing.second.delay, timing.second.attack, timing.second.duration);
  } catch {
    // optionally log once; audio is non-critical
  }
}

export const playNeutralSound = () => void playMood("neutral");
export const playPositiveSound = () => void playMood("positive");
export const playNegativeSound = () => void playMood("negative");