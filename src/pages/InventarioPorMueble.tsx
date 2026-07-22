import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MapPin, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BarcodeCameraScanner } from '@/components/scanner/BarcodeCameraScanner';
import { playBarcodeScannerFeedback } from '@/lib/barcodeScannerFeedback';
import {
  MUEBLE_LETRAS,
  productoPerteneceAMueble,
  resolveUbicacionesProducto,
} from '@/data/ubicacionesMuebleA';
import { useIsMobile } from '@/hooks/use-mobile';
import { useProductSearch, useProducts } from '@/hooks/useProducts';
import { useAppStore, useAuthStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

type CountedLine = { id: string; nombre: string; sku: string; cantidad: number };

export function InventarioPorMueble() {
  const isMobile = useIsMobile();
  const { addToast } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAdjust = hasPermission('inventario:editar') || hasPermission('inventario:mision_ajustar_stock');
  const { adjustStock } = useProducts();
  const { searchByBarcode } = useProductSearch();

  const [mueble, setMueble] = useState<string | null>(null);
  const [pending, setPending] = useState<Product | null>(null);
  const [qtyStr, setQtyStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [counted, setCounted] = useState<CountedLine[]>([]);
  const [gunBuffer, setGunBuffer] = useState('');
  const [awaitHint, setAwaitHint] = useState('Escanea un SKU o código de barras con la pistola');

  const gunInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const cooldownRef = useRef(0);
  const processingRef = useRef(false);

  const sessionActive = mueble != null;
  const popupOpen = pending != null;
  const scannerPaused = popupOpen || saving;

  const focusGun = useCallback(() => {
    if (isMobile || popupOpen) return;
    requestAnimationFrame(() => gunInputRef.current?.focus());
  }, [isMobile, popupOpen]);

  useEffect(() => {
    if (!sessionActive || isMobile || popupOpen) return;
    focusGun();
    const t = window.setInterval(focusGun, 1500);
    return () => window.clearInterval(t);
  }, [sessionActive, isMobile, popupOpen, focusGun, awaitHint]);

  useEffect(() => {
    if (!popupOpen) return;
    const t = window.setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 80);
    return () => window.clearTimeout(t);
  }, [popupOpen, pending?.id]);

  const openProductPopup = useCallback(
    (product: Product, muebleLetra: string) => {
      if (!productoPerteneceAMueble(product, muebleLetra)) {
        const slots = resolveUbicacionesProducto(product);
        addToast({
          type: 'warning',
          message: slots.length
            ? `Este artículo está en ${slots.join(', ')}, no en mueble ${muebleLetra}. Igual puedes contarlo.`
            : `Sin ubicación registrada; se contará en la sesión del mueble ${muebleLetra}.`,
        });
      }
      playBarcodeScannerFeedback('success');
      setPending(product);
      setQtyStr(String(Math.max(0, Math.trunc(Number(product.existencia) || 0))));
    },
    [addToast]
  );

  const handleScannedCode = useCallback(
    async (raw: string) => {
      if (!mueble || processingRef.current || popupOpen) return;
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      if (now < cooldownRef.current) return;
      cooldownRef.current = now + 800;
      processingRef.current = true;
      try {
        const product = await searchByBarcode(code);
        if (!product) {
          playBarcodeScannerFeedback('notFound');
          addToast({
            type: 'warning',
            message: `No hay producto con ese código/SKU: ${code}`,
          });
          setAwaitHint('No encontrado. Escanea otro SKU con la pistola');
          return;
        }
        openProductPopup(product, mueble);
      } finally {
        processingRef.current = false;
      }
    },
    [mueble, popupOpen, searchByBarcode, addToast, openProductPopup]
  );

  const startMueble = (letra: string) => {
    setMueble(letra);
    setCounted([]);
    setPending(null);
    setGunBuffer('');
    setAwaitHint('Escanea un SKU o código de barras con la pistola');
  };

  const endMueble = () => {
    setMueble(null);
    setPending(null);
    setGunBuffer('');
    setCounted([]);
  };

  const cancelPending = () => {
    setPending(null);
    setAwaitHint('Escanea el siguiente SKU con la pistola');
    focusGun();
  };

  const confirmPending = async () => {
    if (!pending || !mueble || !user?.id) return;
    const raw = qtyStr.trim().replace(',', '.');
    const nueva = Number(raw);
    if (!Number.isFinite(nueva) || !Number.isInteger(nueva) || nueva < 0) {
      addToast({ type: 'error', message: 'Indique una cantidad entera válida (≥ 0).' });
      return;
    }
    if (!canAdjust) {
      addToast({ type: 'error', message: 'No tiene permiso para ajustar existencias.' });
      return;
    }

    const actual = Math.trunc(Number(pending.existencia) || 0);
    setSaving(true);
    try {
      if (nueva !== actual) {
        await adjustStock(pending.id, nueva, 'ajuste', `Conteo mueble ${mueble}`, undefined, user.id);
        addToast({ type: 'success', message: 'Existencia actualizada.' });
      } else {
        addToast({ type: 'info', message: 'Cantidad sin cambios.' });
      }
      setCounted((prev) => [
        { id: pending.id, nombre: pending.nombre, sku: pending.sku, cantidad: nueva },
        ...prev.filter((x) => x.id !== pending.id),
      ].slice(0, 12));
      setPending(null);
      setAwaitHint('Listo. Escanea el siguiente SKU con la pistola');
      focusGun();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar el ajuste',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!sessionActive) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Inventario por mueble</h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            Elige el mueble a inventariar. En móvil usa la cámara; en PC, la pistola escaneadora.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-800 dark:bg-slate-950/40 sm:p-3">
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {MUEBLE_LETRAS.map((letra) => (
              <button
                key={letra}
                type="button"
                onClick={() => startMueble(letra)}
                className="rounded-lg border border-slate-200 bg-white px-1 py-2.5 text-center text-sm font-semibold tabular-nums text-slate-800 transition-colors hover:border-brand/50 hover:bg-brand/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-brand/15"
              >
                {letra}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={endMueble} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Cambiar mueble
        </Button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-1 text-sm font-semibold text-brand-to dark:text-brand">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Mueble {mueble}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{counted.length} contado(s) en esta sesión</span>
      </div>

      {isMobile ? (
        <BarcodeCameraScanner
          active={!popupOpen}
          paused={scannerPaused}
          onScan={(code) => void handleScannedCode(code)}
          className="min-h-[16rem] flex-1"
        />
      ) : (
        <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-brand/40 bg-slate-50 px-4 py-8 text-center dark:border-brand/30 dark:bg-slate-950/50">
          <ScanLine className="h-12 w-12 text-brand" aria-hidden />
          <p className="max-w-md text-base font-medium text-slate-800 dark:text-slate-100">{awaitHint}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            La pistola debe enviar el código y Enter. Mantén esta ventana enfocada.
          </p>
          <Input
            ref={gunInputRef}
            value={gunBuffer}
            onChange={(e) => setGunBuffer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const code = gunBuffer;
              setGunBuffer('');
              void handleScannedCode(code);
            }}
            autoComplete="off"
            aria-label="Entrada de pistola escaneadora"
            className="h-11 max-w-sm border-slate-300 bg-white font-mono text-center text-base dark:border-slate-700 dark:bg-slate-900"
            placeholder="Esperando escaneo…"
            disabled={popupOpen || saving}
          />
        </div>
      )}

      {counted.length > 0 ? (
        <div className="shrink-0 rounded-lg border border-slate-200 bg-white/80 p-2 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Últimos contados</p>
          <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-slate-700 dark:text-slate-300">
            {counted.map((c) => (
              <li key={`${c.id}-${c.cantidad}`} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {c.nombre} <span className="font-mono text-slate-500">({c.sku})</span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold">{c.cantidad}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog
        open={popupOpen}
        onOpenChange={(open) => {
          if (!open && !saving) cancelPending();
        }}
      >
        <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6 text-left text-base leading-snug">
              {pending?.nombre ?? 'Artículo'}
            </DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              SKU {pending?.sku}
              {pending ? (
                <>
                  {' '}
                  · Ubicación:{' '}
                  {resolveUbicacionesProducto(pending).join(', ') || 'sin registrar'}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="conteo-mueble-qty">Cantidad en existencia</Label>
            <Input
              id="conteo-mueble-qty"
              ref={qtyInputRef}
              inputMode="numeric"
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirmPending();
                }
              }}
              className="h-12 border-slate-300 bg-white text-center text-xl font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-800"
              disabled={saving}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sistema: {Math.trunc(Number(pending?.existencia) || 0)}. Modifica si el conteo físico es distinto.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" disabled={saving} onClick={cancelPending}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving || !canAdjust}
              onClick={() => void confirmPending()}
              className={cn('bg-brand-gradient text-white')}
            >
              {saving ? 'Guardando…' : 'Listo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
