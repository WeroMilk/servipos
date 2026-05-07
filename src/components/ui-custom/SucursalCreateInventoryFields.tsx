import { useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Sucursal } from '@/types';
import { cn } from '@/lib/utils';

export type InventarioInicialMode = 'empty' | 'copy';

function labelForSucursal(s: Sucursal): string {
  return s.codigo ? `${s.nombre} (${s.codigo})` : s.nombre;
}

type SucursalCreateInventoryFieldsProps = {
  sucursalesOrigen: Sucursal[];
  mode: InventarioInicialMode;
  onModeChange: (mode: InventarioInicialMode) => void;
  copySourceId: string;
  onCopySourceIdChange: (id: string) => void;
  labelClassName?: string;
  hintClassName?: string;
};

/**
 * Opciones al crear una sucursal: inventario vacío o copia del catálogo (y existencias) de otra tienda.
 */
export function SucursalCreateInventoryFields({
  sucursalesOrigen,
  mode,
  onModeChange,
  copySourceId,
  onCopySourceIdChange,
  labelClassName,
  hintClassName,
}: SucursalCreateInventoryFieldsProps) {
  const canCopy = sucursalesOrigen.length > 0;
  const selectValue = mode === 'copy' && !canCopy ? 'empty' : mode;

  useEffect(() => {
    if (mode !== 'copy' || !canCopy || copySourceId || !sucursalesOrigen[0]) return;
    onCopySourceIdChange(sucursalesOrigen[0].id);
  }, [mode, canCopy, copySourceId, sucursalesOrigen, onCopySourceIdChange]);

  return (
    <div className="grid gap-2">
      <Label className={cn('text-slate-700 dark:text-slate-300', labelClassName)}>
        Inventario inicial
      </Label>
      <Select
        value={selectValue}
        onValueChange={(v) => {
          const m = v as InventarioInicialMode;
          onModeChange(m);
          if (m === 'copy' && sucursalesOrigen.length > 0 && !copySourceId) {
            onCopySourceIdChange(sucursalesOrigen[0]!.id);
          }
        }}
      >
        <SelectTrigger
          className={cn(
            'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800/80',
            'text-slate-900 dark:text-slate-100'
          )}
        >
          <SelectValue placeholder="Elija cómo iniciar el inventario" />
        </SelectTrigger>
        <SelectContent className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <SelectItem value="empty" className="text-slate-900 dark:text-slate-100">
            Abrir sucursal desde cero (sin productos)
          </SelectItem>
          <SelectItem
            value="copy"
            disabled={!canCopy}
            className="text-slate-900 dark:text-slate-100"
          >
            Copiar catálogo y existencias de otra sucursal
          </SelectItem>
        </SelectContent>
      </Select>
      {canCopy ? null : (
        <p className={cn('text-[11px] text-slate-600 dark:text-slate-500', hintClassName)}>
          Cuando exista al menos una sucursal en el catálogo, podrá copiar su inventario al crear una
          nueva.
        </p>
      )}
      {mode === 'copy' && canCopy ? (
        <div className="grid gap-2 pt-1">
          <Label className={cn('text-slate-700 dark:text-slate-300', labelClassName)}>
            Sucursal de la que copiar
          </Label>
          <Select value={(copySourceId || sucursalesOrigen[0]?.id) ?? ''} onValueChange={onCopySourceIdChange}>
            <SelectTrigger
              className={cn(
                'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800/80',
                'text-slate-900 dark:text-slate-100'
              )}
            >
              <SelectValue placeholder="Seleccione sucursal" />
            </SelectTrigger>
            <SelectContent className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {sucursalesOrigen.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-slate-900 dark:text-slate-100">
                  {labelForSucursal(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={cn('text-[11px] text-slate-600 dark:text-slate-500', hintClassName)}>
            Se copian productos, precios y cantidades en existencia. No se copian movimientos de inventario
            ni ventas.
          </p>
        </div>
      ) : null}
    </div>
  );
}
