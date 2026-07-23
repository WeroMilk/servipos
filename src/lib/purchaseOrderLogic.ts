import type { Product, PurchaseOrder, PurchaseOrderEstado, PurchaseOrderItem } from '@/types';

export function purchaseOrderPendienteLinea(item: PurchaseOrderItem): number {
  const fac = Math.max(0, Number(item.cantidadFacturada) || 0);
  const rec = Math.max(0, Number(item.cantidadRecibida) || 0);
  return Math.max(0, fac - rec);
}

export function purchaseOrderTotalFacturado(productos: PurchaseOrderItem[]): number {
  return productos.reduce((s, it) => s + Math.max(0, Number(it.cantidadFacturada) || 0), 0);
}

export function purchaseOrderTotalRecibido(productos: PurchaseOrderItem[]): number {
  return productos.reduce((s, it) => s + Math.max(0, Number(it.cantidadRecibida) || 0), 0);
}

export function derivePurchaseOrderEstado(productos: PurchaseOrderItem[]): PurchaseOrderEstado {
  const fac = purchaseOrderTotalFacturado(productos);
  const rec = purchaseOrderTotalRecibido(productos);
  if (fac <= 0) return 'esperando_mercancia';
  if (rec <= 0) return 'esperando_mercancia';
  if (rec >= fac - 1e-9) return 'completado';
  return 'parcial';
}

export const PURCHASE_ORDER_ESTADO_LABELS: Record<PurchaseOrderEstado, string> = {
  esperando_mercancia: 'Esperando mercancía',
  parcial: 'Recepción parcial',
  completado: 'Recibido completo',
  cancelada: 'Cancelada',
};

export type PurchaseOrderReceiveLineInput = {
  lineId: string;
  cantidadRecibir: number;
  actualizarPrecioCompra?: boolean;
  precioUnitarioCompra?: number;
};

export type ApplyPurchaseOrderReceiveDeps = {
  adjustStock: (
    productId: string,
    cantidad: number,
    tipo: 'entrada',
    motivo: string,
    referencia: string,
    usuarioId: string,
    entradaMeta?: {
      proveedor?: string;
      proveedorCodigo?: string;
      precioUnitarioCompra?: number;
    }
  ) => Promise<void>;
  editProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  getProduct: (id: string) => Product | undefined;
};

/** Aplica entradas de stock y opcionalmente actualiza precio de compra en catálogo. */
export async function applyPurchaseOrderReceive(
  order: PurchaseOrder,
  lines: PurchaseOrderReceiveLineInput[],
  deps: ApplyPurchaseOrderReceiveDeps
): Promise<PurchaseOrderItem[]> {
  const byLine = new Map(lines.map((l) => [l.lineId, l]));
  const ref = order.numeroFactura?.trim()
    ? `Pedido ${order.folio} · Fact. ${order.numeroFactura.trim()}`
    : `Pedido ${order.folio}`;
  const motivoBase = `RECEPCIÓN ${order.folio}`;

  const nextItems: PurchaseOrderItem[] = [];

  for (const item of order.productos) {
    const input = byLine.get(item.lineId);
    const qtyIn = Math.max(0, Math.floor(Number(input?.cantidadRecibir) || 0));
    const pendiente = purchaseOrderPendienteLinea(item);
    if (qtyIn > pendiente) {
      throw new Error(
        `La cantidad a recibir de «${item.nombre ?? item.productId}» (${qtyIn}) supera lo pendiente (${pendiente}).`
      );
    }

    if (qtyIn > 0) {
      const pu =
        input?.precioUnitarioCompra != null && Number.isFinite(input.precioUnitarioCompra)
          ? input.precioUnitarioCompra
          : item.precioUnitarioCompra;
      await deps.adjustStock(
        item.productId,
        qtyIn,
        'entrada',
        motivoBase,
        ref,
        order.usuarioId ?? 'system',
        {
          proveedor: order.proveedor?.trim() || undefined,
          proveedorCodigo: order.proveedorCodigo,
          precioUnitarioCompra: pu != null && pu > 0 ? pu : undefined,
        }
      );

      const actualizar =
        input?.actualizarPrecioCompra !== false &&
        (item.actualizarPrecioCompra !== false);
      if (actualizar && pu != null && pu > 0) {
        const prod = deps.getProduct(item.productId);
        if (prod && Math.abs((prod.precioCompra ?? 0) - pu) > 0.0001) {
          try {
            await deps.editProduct(item.productId, { precioCompra: pu });
          } catch (err) {
            // El stock ya entró: no abortar toda la recepción por fallo de precio.
            console.warn(
              `[recepción ${order.folio}] No se pudo actualizar precio de compra de ${item.productId}:`,
              err
            );
          }
        }
      }
    }

    nextItems.push({
      ...item,
      cantidadRecibida: Math.max(0, Number(item.cantidadRecibida) || 0) + qtyIn,
      precioUnitarioCompra:
        input?.precioUnitarioCompra != null && input.precioUnitarioCompra > 0
          ? input.precioUnitarioCompra
          : item.precioUnitarioCompra,
      actualizarPrecioCompra:
        input?.actualizarPrecioCompra ?? item.actualizarPrecioCompra ?? true,
    });
  }

  return nextItems;
}

/**
 * Cancela lo pendiente de una línea (mercancía que no llegó): no mueve stock.
 * - Si no se había recibido nada → elimina la línea.
 * - Si ya hubo recepción parcial → `cantidadFacturada = cantidadRecibida` (pendiente 0).
 */
export function cancelPurchaseOrderPendingLine(
  order: PurchaseOrder,
  lineId: string
): { productos: PurchaseOrderItem[]; estado: PurchaseOrderEstado } {
  const id = lineId.trim();
  if (!id) throw new Error('Línea no válida');
  const item = order.productos.find((p) => p.lineId === id);
  if (!item) throw new Error('Línea no encontrada en el pedido');
  const pend = purchaseOrderPendienteLinea(item);
  if (pend <= 0) throw new Error('Esta línea ya no tiene pendiente por recibir');

  const rec = Math.max(0, Number(item.cantidadRecibida) || 0);
  let productos: PurchaseOrderItem[];
  if (rec <= 0) {
    productos = order.productos.filter((p) => p.lineId !== id);
  } else {
    productos = order.productos.map((p) =>
      p.lineId === id ? { ...p, cantidadFacturada: rec } : p
    );
  }

  if (productos.length === 0) {
    return { productos, estado: 'cancelada' };
  }
  return { productos, estado: derivePurchaseOrderEstado(productos) };
}

export function mapLegacyPurchaseOrderEstado(raw: unknown): PurchaseOrderEstado {
  const s = String(raw ?? '');
  if (s === 'esperando_mercancia' || s === 'parcial' || s === 'completado' || s === 'cancelada') {
    return s;
  }
  if (s === 'recibida' || s === 'recibido') return 'completado';
  if (s === 'pendiente' || s === 'enviada') return 'esperando_mercancia';
  if (s === 'cancelada') return 'cancelada';
  return 'esperando_mercancia';
}
