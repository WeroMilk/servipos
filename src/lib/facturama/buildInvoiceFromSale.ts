import type { Client, FiscalConfig, FormaPago, Invoice, MetodoPago, Sale } from '@/types';
import { normalizeClaveUnidadSat, resolveClaveProdServ } from '@/lib/satCatalog';
import { ivaTasaFromPercentOrRate, roundMoney2 } from '@/lib/facturama/taxes';
import { isValidCpMx, isValidRfcSat } from '@/lib/facturama/validateCfdi';

export function checkoutFormaPagoPermiteCfdi(formaPago: string): boolean {
  return !['TTS', 'DEV', 'COT', 'STC'].includes(formaPago);
}

/** PPC o SAT 99: no entra dinero a caja; saldo en cuentas por cobrar. */
export function esFormaPagoACuenta(formaPago: string): boolean {
  return formaPago === 'PPC' || formaPago === '99';
}

export function satFormaPagoParaCfdi(formaPago: string, metodoPago: string): FormaPago {
  if (metodoPago === 'PPD' || esFormaPagoACuenta(formaPago)) return '99';
  return formaPago as FormaPago;
}

export function metodoPagoParaCfdi(formaPago: string, metodoPago: MetodoPago): MetodoPago {
  if (esFormaPagoACuenta(formaPago) || formaPago === '99') return 'PPD';
  return metodoPago;
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

  const productos = (sale.productos ?? []).map((item) => {
    const tasa = ivaTasaFromPercentOrRate(item.impuesto ?? item.producto?.impuesto ?? 16);
    const qty = Number(item.cantidad) || 0;
    const unit = Number(item.precioUnitario) || 0;
    const pct = Number(item.descuento) || 0;
    const bruto = roundMoney2(qty * unit);
    const descMoney = pct > 0 ? roundMoney2(bruto * (pct / 100)) : 0;
    const base = roundMoney2(Math.max(0, bruto - descMoney));
    const iva = roundMoney2(base * tasa);
    return {
      id: crypto.randomUUID(),
      productId: item.productId,
      claveProdServ: resolveClaveProdServ(item.producto?.claveProdServ),
      claveUnidad: normalizeClaveUnidadSat(item.producto?.unidadMedida),
      cantidad: qty,
      descripcion: item.producto?.nombre?.trim() || item.productoNombre?.trim() || '',
      precioUnitario: unit,
      descuento: descMoney,
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
                importe: iva,
              },
            ],
      impuestosRetenidos: [],
      subtotal: bruto,
      total: roundMoney2(base + iva),
    };
  });

  const subtotal = roundMoney2(productos.reduce((s, p) => s + p.subtotal, 0));
  const descuento = roundMoney2(productos.reduce((s, p) => s + p.descuento, 0));
  const impuestosTrasladados = roundMoney2(
    productos.reduce((s, p) => s + (p.impuestosTrasladados[0]?.importe ?? 0), 0)
  );
  const total = roundMoney2(productos.reduce((s, p) => s + p.total, 0));

  return {
    clienteId: client?.id || 'mostrador',
    cliente: client ?? undefined,
    emisor: fiscalConfig,
    ventaId: sale.id,
    productos,
    subtotal,
    descuento,
    impuestosTrasladados,
    impuestosRetenidos: 0,
    total,
    formaPago: satFormaPagoParaCfdi(opts.formaPago, opts.metodoPago),
    metodoPago: metodoPagoParaCfdi(opts.formaPago, opts.metodoPago),
    lugarExpedicion: fiscalConfig.lugarExpedicion,
    fechaEmision: new Date(),
    estado: 'pendiente',
  };
}
