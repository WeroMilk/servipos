import confetti from 'canvas-confetti';

function playUrl(url: string, volume = 1): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, volume));
      void audio
        .play()
        .then(() => resolve(true))
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

function getAudioContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

/** Trompetas fuertes al ganar. */
export function playBuscaminasWinSound(): void {
  void (async () => {
    const ok =
      (await playUrl('/sounds/buscaminas-win.wav', 1)) ||
      (await playUrl('/sounds/buscaminas-win.mp3', 1));
    if (ok) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02 + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35 + i * 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + 0.5 + i * 0.12);
      });
      window.setTimeout(() => void ctx.close(), 2000);
    } catch {
      /* ignore */
    }
  })();
}

/** Risa malévola al perder. */
export function playBuscaminasLoseSound(): void {
  void (async () => {
    const ok =
      (await playUrl('/sounds/buscaminas-lose.wav', 1)) ||
      (await playUrl('/sounds/buscaminas-lose.mp3', 1));
    if (ok) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      for (let i = 0; i < 5; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const t0 = now + i * 0.22;
        osc.frequency.setValueAtTime(380 - i * 35, t0);
        osc.frequency.exponentialRampToValueAtTime(180 - i * 10, t0 + 0.2);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.25);
      }
      window.setTimeout(() => void ctx.close(), 2500);
    } catch {
      /* ignore */
    }
  })();
}

/** Mucho confeti en pantalla (varios bursts). */
export function fireBuscaminasWinConfetti(): void {
  const end = Date.now() + 2800;
  const colors = ['#22d3ee', '#f59e0b', '#ef4444', '#a3e635', '#c084fc', '#f472b6'];

  const frame = () => {
    confetti({
      particleCount: 7,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.7 },
      colors,
      zIndex: 9999,
    });
    confetti({
      particleCount: 7,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.7 },
      colors,
      zIndex: 9999,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();

  confetti({
    particleCount: 180,
    spread: 100,
    startVelocity: 55,
    origin: { y: 0.55 },
    colors,
    zIndex: 9999,
  });
  window.setTimeout(() => {
    confetti({
      particleCount: 120,
      spread: 160,
      startVelocity: 45,
      origin: { y: 0.4 },
      colors,
      zIndex: 9999,
    });
  }, 400);
}
