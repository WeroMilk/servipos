import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { scheduleBarcodeScannerAutofocus } from '@/lib/scannerCameraFocus';
import { cn } from '@/lib/utils';

type BarcodeCameraScannerProps = {
  active: boolean;
  /** Mientras true no se emiten escaneos (p. ej. popup abierto). */
  paused?: boolean;
  onScan: (code: string) => void;
  className?: string;
  elementId?: string;
};

/**
 * Cámara continua para códigos de barras. Emite un código por lectura (con cooldown).
 * El padre debe pausar al abrir un diálogo de confirmación.
 */
export function BarcodeCameraScanner({
  active,
  paused = false,
  onScan,
  className,
  elementId = 'inventario-mueble-scanner',
}: BarcodeCameraScannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cooldownUntilRef = useRef(0);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) handledRef.current = false;
  }, [paused]);

  const stop = useCallback(async () => {
    const scanner = scannerRef.current;
    handledRef.current = false;
    cooldownUntilRef.current = 0;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      // ignore
    }
    try {
      await scanner.clear();
    } catch {
      // ignore
    }
    scannerRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) {
      void stop();
      setBusy(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let cancelAutofocus: (() => void) | null = null;
    setBusy(true);
    setError(null);
    handledRef.current = false;

    const start = async () => {
      try {
        const onScanSuccess = (decodedText: string) => {
          if (pausedRef.current) return;
          const now = Date.now();
          if (now < cooldownUntilRef.current) return;
          cooldownUntilRef.current = now + 1200;
          if (handledRef.current) return;
          const code = decodedText.trim();
          if (!code) return;
          handledRef.current = true;
          onScanRef.current(code);
        };

        let cameras: { id: string; label: string }[] = [];
        try {
          cameras = await Html5Qrcode.getCameras();
        } catch {
          cameras = [];
        }
        if (cancelled) return;
        if (!cameras.length) {
          setError('No se encontró cámara. Use la pistola o un dispositivo con cámara.');
          setBusy(false);
          return;
        }

        const back =
          cameras.find((c) => /back|rear|trasera|environment/i.test(c.label)) ?? cameras[cameras.length - 1];
        const scanner = new Html5Qrcode(elementId, { verbose: false });
        await scanner.start(
          back.id,
          { fps: 10, qrbox: { width: 260, height: 160 }, aspectRatio: 1.777 },
          onScanSuccess,
          () => undefined
        );
        if (cancelled) {
          try {
            await scanner.stop();
            await scanner.clear();
          } catch {
            // ignore
          }
          return;
        }
        scannerRef.current = scanner;
        cancelAutofocus = scheduleBarcodeScannerAutofocus(scanner);
        setBusy(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'No se pudo iniciar la cámara');
          setBusy(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      cancelAutofocus?.();
      void stop();
    };
  }, [active, elementId, stop]);

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-slate-300 bg-black dark:border-slate-700', className)}>
      <div id={elementId} className="min-h-[14rem] w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      {busy ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
          Iniciando cámara…
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-x-0 bottom-0 bg-red-950/90 px-3 py-2 text-center text-xs text-red-100">
          {error}
        </div>
      ) : null}
      {paused && !busy && !error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-white">
          Confirme la cantidad…
        </div>
      ) : null}
    </div>
  );
}
