import type { InvoiceItem, InvoiceTax } from '@/types';

function money2(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
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
