import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { UbicacionFisicaContent } from '@/components/products/UbicacionFisicaNombre';
import { updateProduct } from '@/db/database';
import { updateProductFirestore } from '@/lib/firestore/productsFirestore';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import type { Product } from '@/types';

async function fileToProductImageDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const max = 960;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar la imagen');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.72);
  } finally {
    bitmap.close();
  }
}

export function ProductDetailsDialog({
  product,
  onOpenChange,
  canEdit,
  sucursalId,
  onProductUpdated,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  sucursalId?: string | null;
  onProductUpdated?: (product: Product) => void;
}) {
  const addToast = useAppStore((s) => s.addToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<Product | null>(product);
  const [description, setDescription] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [savingImage, setSavingImage] = useState(false);

  useEffect(() => {
    setCurrent(product);
    setDescription(typeof product?.descripcion === 'string' ? product.descripcion : '');
  }, [product]);

  const persist = async (patch: { descripcion?: string | null; imagen?: string | null }) => {
    if (!current) return;
    const sid = sucursalId?.trim();
    if (sid) {
      await updateProductFirestore(sid, current.id, patch as Partial<Product>);
    } else {
      const local: Partial<Product> = {};
      if ('descripcion' in patch) local.descripcion = patch.descripcion ?? undefined;
      if ('imagen' in patch) local.imagen = patch.imagen ?? '';
      await updateProduct(current.id, local);
    }
    const next: Product = {
      ...current,
      ...(patch.descripcion !== undefined ? { descripcion: patch.descripcion ?? undefined } : {}),
      ...(patch.imagen !== undefined ? { imagen: patch.imagen ?? undefined } : {}),
      updatedAt: new Date(),
    };
    setCurrent(next);
    onProductUpdated?.(next);
  };

  const saveDescription = async () => {
    if (!canEdit || !current) return;
    setSavingText(true);
    try {
      const trimmed = description.trim();
      await persist({ descripcion: trimmed.length > 0 ? trimmed : null });
      addToast({ type: 'success', message: 'Descripción guardada en el catálogo.' });
      onOpenChange(false);
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar la descripción.',
      });
    } finally {
      setSavingText(false);
    }
  };

  const saveImage = async (imagen: string | null) => {
    if (!canEdit || !current) return;
    setSavingImage(true);
    try {
      await persist({ imagen });
      addToast({
        type: 'success',
        message: imagen ? 'Foto guardada en el catálogo.' : 'Foto eliminada del catálogo.',
      });
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar la foto.',
      });
    } finally {
      setSavingImage(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast({ type: 'warning', message: 'Elija un archivo de imagen.' });
      return;
    }
    try {
      const dataUrl = await fileToProductImageDataUrl(file);
      await saveImage(dataUrl);
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo leer la imagen.',
      });
    }
  };

  const imagen = current?.imagen?.trim() || '';
  const busy = savingText || savingImage;

  return (
    <Dialog
      open={product != null}
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false);
      }}
    >
      <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {current?.nombre ?? 'Producto'}
          </DialogTitle>
          <DialogDescription className="text-left text-xs text-slate-600 dark:text-slate-400">
            {canEdit
              ? 'Edite la descripción o la foto del artículo. Los cambios se guardan en el catálogo de esta sucursal.'
              : 'Solo lectura. Se requiere permiso de edición de inventario para guardar cambios en el catálogo.'}
          </DialogDescription>
        </DialogHeader>
        {current ? (
          <div className="rounded-lg border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-950/50">
            <UbicacionFisicaContent product={current} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">Foto</Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void onPickFile(file);
            }}
          />
          {imagen ? (
            <div className="space-y-2">
              <img
                src={imagen}
                alt={current?.nombre ?? 'Foto del artículo'}
                className="mx-auto max-h-40 w-full rounded-md border border-slate-200 bg-white object-contain dark:border-slate-700 dark:bg-slate-950"
              />
              {canEdit ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {savingImage ? 'Guardando…' : 'Cambiar'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-red-600 hover:text-red-700"
                    disabled={busy}
                    onClick={() => void saveImage(null)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Quitar
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              disabled={!canEdit || busy}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'flex h-24 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm',
                'border-slate-300 bg-white/80 text-slate-600 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-400',
                canEdit && 'hover:border-brand hover:text-brand',
                (!canEdit || busy) && 'cursor-not-allowed opacity-70'
              )}
            >
              <ImagePlus className="h-5 w-5" />
              {canEdit ? (savingImage ? 'Guardando…' : 'Agregar foto') : 'Sin foto'}
            </button>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-detalle-descripcion" className="text-slate-700 dark:text-slate-300">
            Descripción
          </Label>
          <textarea
            id="product-detalle-descripcion"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={!canEdit}
            rows={3}
            placeholder="Sin descripción. Escriba detalles del artículo para el equipo y el ticket."
            className={cn(
              'w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed outline-none',
              'border-slate-200/80 bg-white/90 text-slate-800 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200',
              'min-h-[4.5rem] max-h-32',
              'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25',
              !canEdit && 'cursor-not-allowed opacity-80'
            )}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          {canEdit ? (
            <Button type="button" disabled={busy} onClick={() => void saveDescription()}>
              {savingText ? 'Guardando…' : 'Guardar'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
