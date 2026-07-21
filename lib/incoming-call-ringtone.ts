type AudioContextConstructor = new () => AudioContext;

let sharedAudioContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  const AudioContextClass = window.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextClass();
  }
  return sharedAudioContext;
}

/**
 * Browsers may block audio started by an incoming network event until the user
 * has interacted with the page once. The global call engine invokes this on the
 * SDR's first pointer/key interaction so a later inbound call can ring audibly.
 */
export function primeIncomingCallAudio() {
  const context = audioContext();
  if (!context) return false;

  try {
    if (context.state === "suspended") void context.resume().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Play one short, two-frequency telephone ring pulse. Repetition is owned by
 * the call engine so it can stop immediately when the call is answered/ended. */
export function playIncomingCallRingPulse() {
  const context = audioContext();
  if (!context) return false;

  const play = () => {
    const now = context.currentTime;
    const end = now + 0.72;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.015);
    gain.gain.setValueAtTime(0.055, end - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(context.destination);

    let ended = 0;
    for (const frequency of [440, 480]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.connect(gain);
      oscillator.addEventListener(
        "ended",
        () => {
          ended += 1;
          if (ended === 2) gain.disconnect();
        },
        { once: true }
      );
      oscillator.start(now);
      oscillator.stop(end + 0.01);
    }
  };

  try {
    if (context.state === "suspended") {
      void context.resume().then(play).catch(() => {});
    } else {
      play();
    }
    return true;
  } catch {
    return false;
  }
}
