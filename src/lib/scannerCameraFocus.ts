import type { Html5Qrcode } from 'html5-qrcode';

type FocusCapableCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  zoom?: { min: number; max: number; step?: number };
};

/**
 * Activa enfoque continuo (y zoom leve si el dispositivo lo permite)
 * para que códigos de barras se lean más rápido en móvil.
 * Debe llamarse con la cámara ya en marcha.
 */
export async function enableBarcodeScannerAutofocus(scanner: Html5Qrcode): Promise<void> {
  if (!scanner.isScanning) return;

  let caps: FocusCapableCapabilities | null = null;
  try {
    caps = scanner.getRunningTrackCapabilities() as FocusCapableCapabilities;
  } catch {
    caps = null;
  }

  const focusModes = caps?.focusMode;
  const canContinuous = !focusModes || focusModes.length === 0 || focusModes.includes('continuous');
  if (!canContinuous) return;

  const advanced: Array<Record<string, string | number>> = [{ focusMode: 'continuous' }];

  const zoomCap = caps?.zoom;
  if (zoomCap && typeof zoomCap.max === 'number' && zoomCap.max > 1.05) {
    const min = typeof zoomCap.min === 'number' ? zoomCap.min : 1;
    // Zoom moderado: acerca el código sin perder enfoque de cerca.
    const target = Math.min(1.4, zoomCap.max);
    advanced.push({ zoom: Math.max(min, target) });
  }

  // focusMode no está en el DOM tipado estándar; los móviles lo soportan en runtime.
  const constraints = {
    focusMode: 'continuous',
    advanced,
  } as unknown as MediaTrackConstraints;

  try {
    await scanner.applyVideoConstraints(constraints);
  } catch {
    // Algunos navegadores solo aceptan focusMode en advanced.
    try {
      await scanner.applyVideoConstraints({
        advanced: [{ focusMode: 'continuous' }],
      } as unknown as MediaTrackConstraints);
    } catch {
      // Dispositivo sin soporte de focusMode — se ignora.
    }
  }
}

/** Reintenta autofocus: al iniciar a veces el track aún no acepta constraints. */
export function scheduleBarcodeScannerAutofocus(
  scanner: Html5Qrcode,
  delaysMs: number[] = [0, 400, 1200]
): () => void {
  const timers: number[] = [];
  for (const delay of delaysMs) {
    const id = window.setTimeout(() => {
      void enableBarcodeScannerAutofocus(scanner);
    }, delay);
    timers.push(id);
  }
  return () => {
    for (const id of timers) window.clearTimeout(id);
  };
}
