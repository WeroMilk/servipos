import type { Client, FiscalConfig, FormaPago, Invoice, MetodoPago, Sale } from '@/types';
import { normalizeClaveUnidadSat, resolveClaveProdServ } from '@/lib/satCatalog';
import { ivaTasaFromPercentOrRate } from '@/lib/facturama/taxes';
import { isValidCpMx, isValidRfcSat } from '@/lib/facturama/validateCfdi';

export function checkoutFormaPagoPermiteCfdi(formaPago: string): boolean {
  return !['TTS', 'DEV', 'COT', 'STC'].includes(formaPago);
}

export function satFormaPagoParaCfdi(formaPago: string, metodoPago: string): FormaPago {
  if (metodoPago === 'PPD' || formaPago === 'PPC') return '99';
  return formaPago as FormaPago;
}

export function clientListoParaCfdi(client: Client | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!client?.id || client.id === 'mostrador' || client.isMostrador) {
    return { ok: false, reason: 'Seleccione un cliente registrado (no público general).' };
  }
  const rfc = String(client.rfc ?? '').trim();
  if (!isValidRfcSat(rfc)) {
    return { ok: false, reason: 'El cliente debe tener RFC válido (Datos en Clientes).' };
  }
  const name = (client.razonSocial || client.nombre || '').trim();
  if (!name) {
    return { ok: false, reason: 'El cliente debe tener nombre o razón social.' };
  }
  if (!String(client.regimenFiscal ?? '').trim()) {
    return { ok: false, reason: 'El cliente debe tener régimen fiscal.' };
  }
  const zip = String(client.codigoPostal ?? client.direccion?.codigoPostal ?? '').trim();
  if (!isValidCpMx(zip)) {
    return { ok: false, reason: 'El cliente debe tener código postal de 5 dígitos.' };
  }
  return { ok: true };
}

export function buildInvoiceFromSale(opts: {
  sale: Sale;
  client: Client | null;
  fiscalConfig: FiscalConfig;
  formaPago: FormaPago;
  metodoPago: MetodoPago;
  usoCfdi?: string;
}): Omit<Invoice, 'id' | 'folio' | 'serie' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'esPrueba'> {
  const { sale, fiscalConfig } = opts;
  const client = opts.client
    ? { ...opts.client, usoCfdi: opts.usoCfdi || opts.client.usoCfdi || 'G03' }
    : null;

  return {
    clienteId: client?.id || 'mostrador',
    cliente: client ?? undefined,
    emisor: fiscalConfig,
    ventaId: sale.id,
    productos: (sale.productos ?? []).map((item) => {
      const tasa = ivaTasaFromPercentOrRate(item.impuesto ?? item.producto?.impuesto ?? 16);
      const base = Math.max(0, (Number(item.subtotal) || 0) - (Number(item.descuento) || 0));
      return {
        id: crypto.randomUUID(),
        productId: item.productId,
        claveProdServ: resolveClaveProdServ(item.producto?.claveProdServ),
        claveUnidad: normalizeClaveUnidadSat(item.producto?.unidadMedida),
        cantidad: item.cantidad,
        descripcion: item.producto?.nombre?.trim() || item.productoNombre?.trim() || '',
        precioUnitario: item.precioUnitario,
        descuento: item.descuento,
        impuestosTrasladados:
          tasa <= 0
            ? []
            : [
                {
                  tipo: 'Traslado' as const,
                  impuesto: '002' as const,
                  tipoFactor: 'Tasa' as const,
                  tasaOCuota: tasa,
                  base,
                  importe: Math.round(base * tasa * 100) / 100,
                },
              ],
        impuestosRetenidos: [],
        subtotal: item.subtotal,
        total: item.total,
      };
    }),
    subtotal: sale.subtotal,
    descuento: sale.descuento,
    impuestosTrasladados: sale.impuestos,
    impuestosRetenidos: 0,
    total: sale.total,
    formaPago: opts.formaPago,
    metodoPago: opts.metodoPago,
    lugarExpedicion: fiscalConfig.lugarExpedicion,
    fechaEmision: new Date(),
    estado: 'pendiente',
  };
}
