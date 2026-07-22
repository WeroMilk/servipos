/** Feedback háptico/sonoro al escanear códigos (POS / inventario por mueble). */
export function playBarcodeScannerFeedback(kind: 'success' | 'notFound'): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(kind === 'success' ? 70 : [40, 55, 40]);
  }

  const AudioCtx =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'success' ? 1040 : 520;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (kind === 'success' ? 0.08 : 0.12));
    setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 140);
  } catch {
    // Vibración ya cubre feedback si falla audio.
  }
}
