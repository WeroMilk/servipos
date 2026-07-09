import type { GoodsExit, GoodsExitEstado, GoodsExitItem, GoodsExitMotivo, Product } from '@/types';
import { productEsServicio } from '@/lib/productServicio';

export const GOODS_EXIT_MOTIVO_LABELS: Record<GoodsExitMotivo, string> = {
  merma: 'Merma / daño',
  devolucion_proveedor: 'Devolución a proveedor',
  consumo_interno: 'Consumo interno',
  donacion: 'Donación',
  muestra: 'Muestra / promoción',
  otro: 'Otro',
};

export const GOODS_EXIT_ESTADO_LABELS: Record<GoodsExitEstado, string> = {
  completada: 'Completada',
  cancelada: 'Cancelada',
};

export function goodsExitTotalPiezas(productos: GoodsExitItem[]): number {
  return productos.reduce((s, it) => s + Math.max(0, Math.floor(Number(it.cantidad) || 0)), 0);
}

export function parseGoodsExitMotivo(raw: unknown): GoodsExitMotivo {
  const s = String(raw ?? 'otro');
  if (
    s === 'merma' ||
    s === 'devolucion_proveedor' ||
    s === 'consumo_interno' ||
    s === 'donacion' ||
    s === 'muestra' ||
    s === 'otro'
  ) {
    return s;
  }
  return 'otro';
}

export function parseGoodsExitEstado(raw: unknown): GoodsExitEstado {
  const s = String(raw ?? 'completada');
  return s === 'cancelada' ? 'cancelada' : 'completada';
}

export type ApplyGoodsExitDeps = {
  adjustStock: (
    productId: string,
    cantidad: number,
    tipo: 'salida',
    motivo: string,
    referencia: string,
    usuarioId: string
  ) => Promise<void>;
  getProduct: (id: string) => Product | undefined;
};

/** Descuenta existencias y deja trazabilidad en `inventory_movements`. */
export async function applyGoodsExit(
  exit: Pick<
    GoodsExit,
    'folio' | 'motivo' | 'motivoDetalle' | 'destino' | 'productos' | 'usuarioId'
  >,
  deps: ApplyGoodsExitDeps
): Promise<void> {
  const motivoLabel = GOODS_EXIT_MOTIVO_LABELS[exit.motivo];
  const detalle = exit.motivoDetalle?.trim();
  const destino = exit.destino?.trim();
  const partes = [`SALIDA MERCANCÍA ${exit.folio}`, motivoLabel];
  if (detalle) partes.push(detalle);
  if (destino) partes.push(`→ ${destino}`);
  const motivoBase = partes.join(' · ');
  const ref = `Salida ${exit.folio}`;

  const lines = exit.productos.filter((it) => Math.floor(Number(it.cantidad) || 0) > 0);
  if (lines.length === 0) {
    throw new Error('Agregue al menos un producto con cantidad mayor a cero.');
  }

  for (const item of lines) {
    const qty = Math.max(0, Math.floor(Number(item.cantidad) || 0));
    if (qty <= 0) continue;
    const prod = deps.getProduct(item.productId);
    if (!prod) {
      throw new Error(`Producto no encontrado: ${item.nombre ?? item.productId}`);
    }
    if (productEsServicio(prod)) {
      throw new Error(`«${prod.nombre}» es un servicio y no tiene inventario físico.`);
    }
    const existencia = Math.max(0, Number(prod.existencia) || 0);
    if (existencia < qty) {
      throw new Error(
        `Stock insuficiente de «${prod.nombre}»: hay ${existencia}, se solicitó ${qty}.`
      );
    }
    await deps.adjustStock(item.productId, qty, 'salida', motivoBase, ref, exit.usuarioId ?? 'system');
  }
}
