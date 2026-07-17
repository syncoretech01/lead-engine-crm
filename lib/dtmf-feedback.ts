const DTMF_FREQUENCIES = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477]
} as const;

export type DtmfKey = keyof typeof DTMF_FREQUENCIES;

let sharedAudioContext: AudioContext | null = null;

export function isDtmfKey(value: string): value is DtmfKey {
  return Object.hasOwn(DTMF_FREQUENCIES, value);
}

export function dtmfToneFrequencies(key: string): readonly [number, number] | undefined {
  return isDtmfKey(key) ? DTMF_FREQUENCIES[key] : undefined;
}

export function appendDtmfDigit(current: string, key: string, maxLength = 32) {
  if (!isDtmfKey(key)) return current;
  return `${current}${key}`.slice(-Math.max(1, maxLength));
}

/**
 * Play the standard two-frequency telephone tone locally. RingCentral still
 * receives the real DTMF separately; this is immediate browser-side feedback.
 */
export function playDtmfTone(key: string, durationMs = 140) {
  const frequencies = dtmfToneFrequencies(key);
  if (!frequencies || typeof window === "undefined") return false;

  type AudioContextConstructor = new () => AudioContext;
  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  const AudioContextClass = window.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextClass) return false;

  try {
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      sharedAudioContext = new AudioContextClass();
    }
    const context = sharedAudioContext;

    const play = () => {
      const now = context.currentTime;
      const end = now + Math.max(60, durationMs) / 1000;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(context.destination);

      let ended = 0;
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.connect(gain);
        oscillator.addEventListener("ended", () => {
          ended += 1;
          if (ended === frequencies.length) gain.disconnect();
        }, { once: true });
        oscillator.start(now);
        oscillator.stop(end + 0.01);
      }
    };

    if (context.state === "suspended") {
      void context.resume().then(play).catch(() => {});
    } else {
      play();
    }
    return true;
  } catch {
    // Audio feedback is best-effort and must never interfere with real DTMF.
    return false;
  }
}
