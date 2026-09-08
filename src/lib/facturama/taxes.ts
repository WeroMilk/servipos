import type { InvoiceItem, InvoiceTax } from '@/types';

export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function money2(n: number): string {
  return roundMoney2(n).toFixed(2);
}

/**
 * Concepto SAT/Facturama: Subtotal = cantidad × precio, Descuento en pesos.
 * En venta POS `descuento` de línea suele ser %; si el subtotal ya viene neto, se detecta.
 */
export function conceptoImportesCfdi(p: {
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  subtotal: number;
}): { subtotal: number; descuento: number; base: number } {
  const qty = Number(p.cantidad) || 0;
  const unit = Number(p.precioUnitario) || 0;
  const bruto = roundMoney2(qty * unit);
  const descRaw = Number(p.descuento) || 0;
  const subStored = Number(p.subtotal) || 0;
  const netFromPct = roundMoney2(bruto * (1 - descRaw / 100));
  const looksPercent =
    descRaw > 0 && descRaw <= 100 && Math.abs(subStored - netFromPct) <= 0.03;
  const descuento = looksPercent
    ? roundMoney2(bruto * (descRaw / 100))
    : roundMoney2(Math.min(Math.max(0, descRaw), bruto));
  const subtotal = bruto > 0 ? bruto : roundMoney2(subStored + descuento);
  const base = roundMoney2(Math.max(0, subtotal - descuento));
  return { subtotal, descuento, base };
}

/** `Product.impuesto` / línea de venta suele ser 16 (porcentaje). También acepta 0.16. */
export function ivaTasaFromPercentOrRate(raw: number | undefined | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0.16;
  if (n === 0) return 0;
  if (n > 1) return Math.round((n / 100) * 10000) / 10000;
  return n;
}

export function facturamaTaxName(impuesto: string, isRetention: boolean): string {
  if (impuesto === '001') return 'ISR';
  if (impuesto === '003') return 'IEPS';
  return isRetention ? 'IVA RET' : 'IVA';
}

export function mapInvoiceTaxesToFacturama(item: InvoiceItem): Array<Record<string, unknown>> {
  const taxes: Array<Record<string, unknown>> = [];
  const push = (t: InvoiceTax, isRetention: boolean) => {
    if (t.tipoFactor === 'Exento') return;
    taxes.push({
      Name: facturamaTaxName(String(t.impuesto), isRetention),
      Rate: String(t.tasaOCuota ?? 0),
      Total: money2(t.importe),
      Base: money2(t.base),
      IsRetention: isRetention,
      IsFederalTax: true,
      ...(t.tipoFactor === 'Cuota' ? { IsQuota: true } : {}),
    });
  };
  for (const t of item.impuestosTrasladados ?? []) push(t, false);
  for (const t of item.impuestosRetenidos ?? []) push(t, true);
  return taxes;
}

export function money2facturama(n: number): string {
  return money2(n);
}
