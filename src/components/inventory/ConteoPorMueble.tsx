import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  entriesExistenciaPorUbicacion,
  labelUbicacionInventario,
  mergeExistenciaEnUbicacion,
  normalizeUbicacionKey,
  qtyEnUbicacion,
  sumExistenciaPorUbicacion,
} from '@/lib/existenciaPorUbicacion';
import { useIsMobile } from '@/hooks/use-mobile';
import { useProductSearch, useProducts } from '@/hooks/useProducts';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useAppStore, useAuthStore } from '@/stores';
import {
  createMissionStockAdjustRequest,
  userNeedsMissionStockAdjustApproval,
} from '@/lib/missionStockAdjustRequests';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

type CountedLine = {
  id: string;
  nombre: string;
  sku: string;
  mueble: string;
  cantidadUbicacion: number;
  total: number;
};

export function ConteoPorMueble({
  onPendingAdjustCreated,
}: {
  onPendingAdjustCreated?: () => void;
} = {}) {
  const isMobile = useIsMobile();
  const { addToast } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAdjust = hasPermission('inventario:editar') || hasPermission('inventario:mision_ajustar_stock');
  const needsApproval = userNeedsMissionStockAdjustApproval(user);
  const { adjustStock, editProduct } = useProducts();
  const { searchByBarcode } = useProductSearch();
  const { effectiveSucursalId } = useEffectiveSucursalId();

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

  const previewMap = useMemo(() => {
    if (!pending || !mueble) return {};
    const raw = qtyStr.trim().replace(',', '.');
    const n = Number(raw);
    const qtyHere = Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : qtyEnUbicacion(pending.existenciaPorUbicacion, mueble);
    return mergeExistenciaEnUbicacion(pending.existenciaPorUbicacion, mueble, qtyHere);
  }, [pending, mueble, qtyStr]);

  const previewEntries = useMemo(() => entriesExistenciaPorUbicacion(previewMap), [previewMap]);
  const previewTotal = useMemo(() => sumExistenciaPorUbicacion(previewMap), [previewMap]);

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
    async (product: Product, muebleLetra: string) => {
      const muebleKey = normalizeUbicacionKey(muebleLetra);
      const slots = resolveUbicacionesProducto(product);
      let productForPopup = product;

      if (slots.length === 0 && muebleKey) {
        try {
          await editProduct(product.id, { ubicacionFisica: muebleKey });
          productForPopup = { ...product, ubicacionFisica: muebleKey };
          addToast({
            type: 'success',
            message: `Sin ubicación previa: se asignó a ${labelUbicacionInventario(muebleKey)}.`,
          });
        } catch (e) {
          addToast({
            type: 'warning',
            message:
              e instanceof Error
                ? e.message
                : `No se pudo guardar la ubicación en ${labelUbicacionInventario(muebleKey)}.`,
          });
        }
      } else if (!productoPerteneceAMueble(product, muebleLetra)) {
        addToast({
          type: 'warning',
          message: slots.length
            ? `Este artículo está en ${slots.join(', ')}, no en ${labelUbicacionInventario(muebleKey)}. Igual puedes contarlo.`
            : `Sin ubicación registrada; se contará en ${labelUbicacionInventario(muebleKey)}.`,
        });
      }

      playBarcodeScannerFeedback('success');
      setPending(productForPopup);
      setQtyStr(String(qtyEnUbicacion(productForPopup.existenciaPorUbicacion, muebleKey)));
    },
    [addToast, editProduct]
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
        await openProductPopup(product, mueble);
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
    const nuevaEnUbicacion = Number(raw);
    if (
      !Number.isFinite(nuevaEnUbicacion) ||
      !Number.isInteger(nuevaEnUbicacion) ||
      nuevaEnUbicacion < 0
    ) {
      addToast({ type: 'error', message: 'Indique una cantidad entera válida (≥ 0).' });
      return;
    }
    if (!canAdjust) {
      addToast({ type: 'error', message: 'No tiene permiso para ajustar existencias.' });
      return;
    }

    const muebleKey = normalizeUbicacionKey(mueble);
    const prevEnUbicacion = qtyEnUbicacion(pending.existenciaPorUbicacion, muebleKey);
    const nextMap = mergeExistenciaEnUbicacion(
      pending.existenciaPorUbicacion,
      muebleKey,
      nuevaEnUbicacion
    );
    const totalAnterior = Math.trunc(Number(pending.existencia) || 0);
    const totalNuevo = sumExistenciaPorUbicacion(nextMap);
    const ubicacionCambio = prevEnUbicacion !== nuevaEnUbicacion;
    const totalCambio = totalNuevo !== totalAnterior;

    if (!ubicacionCambio && !totalCambio) {
      addToast({ type: 'info', message: 'Cantidad sin cambios.' });
      setCounted((prev) =>
        [
          {
            id: pending.id,
            nombre: pending.nombre,
            sku: pending.sku,
            mueble: muebleKey,
            cantidadUbicacion: nuevaEnUbicacion,
            total: totalNuevo,
          },
          ...prev.filter((x) => !(x.id === pending.id && x.mueble === muebleKey)),
        ].slice(0, 12)
      );
      setPending(null);
      setAwaitHint('Listo. Escanea el siguiente SKU con la pistola');
      focusGun();
      return;
    }

    const label = labelUbicacionInventario(muebleKey);
    const comentario = `Conteo ${label}: ${nuevaEnUbicacion} (total ${totalNuevo})`;

    setSaving(true);
    try {
      if (needsApproval) {
        if (!effectiveSucursalId) {
          addToast({ type: 'error', message: 'No hay sucursal activa para registrar la solicitud.' });
          return;
        }
        await createMissionStockAdjustRequest({
          sucursalId: effectiveSucursalId,
          productId: pending.id,
          productNombre: pending.nombre,
          productSku: pending.sku,
          cantidadAnterior: totalAnterior,
          cantidadNueva: totalNuevo,
          comentario,
          origen: 'conteo_mueble',
          mueble: muebleKey,
          cantidadEnUbicacion: nuevaEnUbicacion,
          existenciaPorUbicacion: nextMap,
          solicitadoPorId: user.id,
          solicitadoPorNombre: user.name?.trim() || user.username?.trim() || user.email || 'Cajero',
        });
        addToast({
          type: 'success',
          message: 'Solicitud enviada. Pendiente de aprobación de Gabriel o Zavala.',
        });
        onPendingAdjustCreated?.();
      } else {
        await editProduct(pending.id, { existenciaPorUbicacion: nextMap });
        if (totalCambio) {
          await adjustStock(pending.id, totalNuevo, 'ajuste', comentario, undefined, user.id);
        }
        addToast({
          type: 'success',
          message: totalCambio
            ? `Guardado: ${label} ${nuevaEnUbicacion} · total ${totalNuevo}`
            : `Desglose actualizado: ${label} ${nuevaEnUbicacion}`,
        });
      }
      setCounted((prev) =>
        [
          {
            id: pending.id,
            nombre: pending.nombre,
            sku: pending.sku,
            mueble: muebleKey,
            cantidadUbicacion: nuevaEnUbicacion,
            total: totalNuevo,
          },
          ...prev.filter((x) => !(x.id === pending.id && x.mueble === muebleKey)),
        ].slice(0, 12)
      );
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
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Conteo por mueble</h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            Elige el mueble a inventariar. Al contar el mismo SKU en otro lugar, las cantidades se suman al
            total. En móvil usa la cámara; en PC, la pistola escaneadora.
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
          {labelUbicacionInventario(mueble)}
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
              <li key={`${c.id}-${c.mueble}-${c.cantidadUbicacion}`} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {c.nombre} <span className="font-mono text-slate-500">({c.sku})</span>
                  <span className="text-slate-500"> · {labelUbicacionInventario(c.mueble)}</span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold">
                  {c.cantidadUbicacion}
                  <span className="font-normal text-slate-500"> / tot {c.total}</span>
                </span>
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
                  · Ubicación ficha:{' '}
                  {resolveUbicacionesProducto(pending).join(', ') || 'sin registrar'}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="conteo-mueble-qty">
              Cantidad en {mueble ? labelUbicacionInventario(mueble) : 'esta ubicación'}
            </Label>
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
            {previewEntries.length > 0 ? (
              <div className="rounded-md border border-slate-200 bg-white/70 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950/40">
                <p className="mb-1 font-medium text-slate-600 dark:text-slate-400">Desglose por ubicación</p>
                <ul className="space-y-0.5 text-slate-800 dark:text-slate-200">
                  {previewEntries.map((e) => (
                    <li key={e.ubicacion} className="flex justify-between gap-2 tabular-nums">
                      <span>{e.label}</span>
                      <span className="font-semibold">{e.cantidad}</span>
                    </li>
                  ))}
                  <li className="mt-1 flex justify-between gap-2 border-t border-slate-200 pt-1 font-semibold tabular-nums dark:border-slate-700">
                    <span>total</span>
                    <span>{previewTotal}</span>
                  </li>
                </ul>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sistema (total): {Math.trunc(Number(pending?.existencia) || 0)}. La cantidad que captures
                aquí es solo de esta ubicación; al contar en otros muebles se suman.
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {needsApproval
                ? ' Si cambia la cantidad, se enviará a aprobación de Gabriel o Zavala.'
                : ' Modifica si el conteo físico es distinto.'}
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
              {saving ? 'Guardando…' : needsApproval ? 'Enviar' : 'Listo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
