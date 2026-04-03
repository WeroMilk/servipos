import type { InventoryMovement } from '@/types';

const LABELS: Record<InventoryMovement['tipo'], string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  venta: 'Venta',
  compra: 'Compra',
  producto_alta: 'Catálogo · Alta',
  producto_baja: 'Catálogo · Baja',
  producto_edicion: 'Catálogo · Edición',
};

export function tipoMovimientoLabel(t: InventoryMovement['tipo']): string {
  return LABELS[t];
}
