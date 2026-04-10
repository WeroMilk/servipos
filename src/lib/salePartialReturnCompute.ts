import type { Payment, Sale, SaleItem } from '@/types';

export type DevolucionLineInput = { lineId: string; cantidad: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Suma de subtotales de línea (base antes del descuento global de la venta). */
function sumLineSubtotales(productos: SaleItem[]): number {
  return productos.reduce((s, p) => s + (Number(p.subtotal) || 0), 0);
}

function reducePagosPorReembolso(pagos: Payment[], reembolso: number): Payment[] {
  let left = round2(reembolso);
  if (left <= 0) return pagos.map((p) => ({ ...p }));
  const out: Payment[] = [];
  for (const p of pagos) {
    const m = Number(p.monto) || 0;
    if (left <= 0) {
      out.push({ ...p });
      continue;
    }
    const sub = Math.min(m, left);
    const nuevo = round2(m - sub);
    left = round2(left - sub);
    if (nuevo > 0.005) {
      out.push({ ...p, monto: nuevo });
    }
  }
  return out;
}

export type PartialReturnComputeOk = {
  kind: 'partial';
  /** Parche para fusionar en el documento de venta */
  patch: {
    productos: SaleItem[];
    subtotal: number;
    descuento: number;
    impuestos: number;
    total: number;
    pagos: Payment[];
    estado: 'completada';
    notas: string;
  };
  reembolso: number;
  stockEntradas: { productId: string; cantidad: number }[];
};

export type PartialReturnComputeFullCancel = {
  kind: 'full_cancel';
  reembolso: number;
};

export type PartialReturnComputeResult = PartialReturnComputeOk | PartialReturnComputeFullCancel;

/** Vista previa del reembolso según cantidades por línea (0 = no devolver). */
/** Líneas para el comprobante térmico (solo lo devuelto). */
export function buildDevolucionTicketLineas(
  sale: Sale,
  returns: DevolucionLineInput[]
): { descripcion: string; cantidad: number; precioUnit: number; total: number }[] {
  const byId = new Map(sale.productos.map((p) => [p.id, p]));
  const out: { descripcion: string; cantidad: number; precioUnit: number; total: number }[] = [];
  for (const r of returns) {
    const it = byId.get(r.lineId);
    if (!it) continue;
    const desc =
      it.producto?.nombre?.trim() ||
      it.productoNombre?.trim() ||
      `Artículo (${String(it.productId).slice(0, 8)}…)`;
    const disc = Number(it.descuento) || 0;
    const pu = Number(it.precioUnitario) || 0;
    const imp = Number(it.impuesto) || 16;
    const unitSin = pu * (1 - disc / 100);
    const unitConIva = unitSin * (1 + imp / 100);
    const fq = Number(it.cantidad) || 1;
    const frac = r.cantidad / fq;
    const lineTot = round2((Number(it.total) || 0) * frac);
    out.push({
      descripcion: desc,
      cantidad: r.cantidad,
      precioUnit: unitConIva,
      total: lineTot,
    });
  }
  return out;
}

export function previewReembolsoDevolucion(
  sale: Sale | null | undefined,
  qtyByLineId: Record<string, number>
): { reembolso: number; kind: 'partial' | 'full' } | null {
  if (!sale || sale.estado !== 'completada' || !Array.isArray(sale.productos) || sale.productos.length === 0) {
    return null;
  }
  const returns: DevolucionLineInput[] = [];
  for (const p of sale.productos) {
    const q = Number(qtyByLineId[p.id]) || 0;
    if (q > 0) returns.push({ lineId: p.id, cantidad: q });
  }
  if (returns.length === 0) return null;
  try {
    const r = computeDevolucionParcial(sale, returns);
    if (r.kind === 'full_cancel') return { reembolso: r.reembolso, kind: 'full' };
    return { reembolso: r.reembolso, kind: 'partial' };
  } catch {
    return null;
  }
}

/**
 * Calcula documento actualizado tras devolver mercancía de un ticket completado.
 * Si todas las líneas se devuelven por completo, devuelve `full_cancel` (usar cancelSale).
 */
export function computeDevolucionParcial(
  sale: Sale,
  returns: DevolucionLineInput[],
  motivoEtiqueta?: string
): PartialReturnComputeResult {
  if (sale.estado !== 'completada') {
    throw new Error('Solo se pueden devolver ventas completadas');
  }
  if (!Array.isArray(sale.productos) || sale.productos.length === 0) {
    throw new Error('La venta no tiene líneas');
  }

  const byLine = new Map<string, number>();
  for (const r of returns) {
    const id = String(r.lineId ?? '').trim();
    const q = Number(r.cantidad) || 0;
    if (!id || q <= 0) continue;
    byLine.set(id, (byLine.get(id) ?? 0) + q);
  }
  if (byLine.size === 0) {
    throw new Error('Seleccione al menos un artículo a devolver');
  }

  const oldSubSum = sumLineSubtotales(sale.productos);
  if (oldSubSum <= 0) {
    throw new Error('No se pudo calcular el subtotal de la venta');
  }

  const stockEntradas: { productId: string; cantidad: number }[] = [];
  const newProductos: SaleItem[] = [];

  for (const line of sale.productos) {
    const lid = String(line.id ?? '');
    const dev = byLine.get(lid) ?? 0;
    const oldQty = Number(line.cantidad) || 0;
    if (dev > oldQty) {
      throw new Error(`Cantidad a devolver mayor que la vendida en una línea`);
    }
    if (dev > 0) {
      stockEntradas.push({ productId: line.productId, cantidad: dev });
    }
    const rem = oldQty - dev;
    if (rem <= 0) continue;
    const factor = oldQty > 0 ? rem / oldQty : 0;
    const newSub = round2((Number(line.subtotal) || 0) * factor);
    const newTot = round2((Number(line.total) || 0) * factor);
    newProductos.push({
      ...line,
      cantidad: rem,
      subtotal: newSub,
      total: newTot,
    });
  }

  if (newProductos.length === 0) {
    return {
      kind: 'full_cancel',
      reembolso: round2(Number(sale.total) || 0),
    };
  }

  const ratio = sumLineSubtotales(newProductos) / oldSubSum;
  const newSubtotal = round2((Number(sale.subtotal) || 0) * ratio);
  const newDescuento = round2((Number(sale.descuento) || 0) * ratio);
  const newImpuestos = round2((Number(sale.impuestos) || 0) * ratio);
  const newTotal = round2((Number(sale.total) || 0) * ratio);
  const reembolso = round2((Number(sale.total) || 0) - newTotal);

  const oldPaid = (sale.pagos ?? []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  if (reembolso > oldPaid + 0.02) {
    throw new Error('El reembolso supera lo cobrado en el ticket');
  }

  const newPagos = reducePagosPorReembolso(sale.pagos ?? [], reembolso);
  const tag = (motivoEtiqueta ?? 'Devolución parcial (POS)').trim();
  const notasExtra = sale.notas
    ? `${sale.notas} | ${tag}: reembolso ${reembolso.toFixed(2)}`
    : `${tag}: reembolso ${reembolso.toFixed(2)}`;

  return {
    kind: 'partial',
    patch: {
      productos: newProductos,
      subtotal: newSubtotal,
      descuento: newDescuento,
      impuestos: newImpuestos,
      total: newTotal,
      pagos: newPagos,
      estado: 'completada',
      notas: notasExtra,
    },
    reembolso,
    stockEntradas,
  };
}
