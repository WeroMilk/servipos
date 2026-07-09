import type { Client, ClientCreditoHistorialEntry } from '@/types';

function normalizeEntry(e: ClientCreditoHistorialEntry): ClientCreditoHistorialEntry {
  const at = e.at instanceof Date ? e.at : new Date(e.at);
  const monto = Math.round(Math.max(0, Number(e.monto) || 0) * 100) / 100;
  const saldoAnterior = Math.round(Math.max(0, Number(e.saldoAnterior) || 0) * 100) / 100;
  const saldoNuevo = Math.round(Math.max(0, Number(e.saldoNuevo) || 0) * 100) / 100;
  const tipo = e.tipo === 'uso' || e.tipo === 'ajuste' ? e.tipo : 'emision';
  return {
    at,
    monto,
    saldoAnterior,
    saldoNuevo,
    tipo,
    motivo: e.motivo?.trim() || undefined,
    referencia: e.referencia?.trim() || undefined,
    usuarioNombre: e.usuarioNombre?.trim() || undefined,
    notas: e.notas?.trim() || undefined,
  };
}

/** Historial de crédito para pantallas de cliente. */
export function listaCreditoTiendaMostrable(cliente: Client): ClientCreditoHistorialEntry[] {
  const raw = cliente.creditoHistorial;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map(normalizeEntry).filter((e) => Number.isFinite(e.at.getTime()));
  }
  if (
    cliente.ultimoCreditoAt != null &&
    cliente.ultimoCreditoMonto != null &&
    cliente.ultimoCreditoTipo
  ) {
    const at =
      cliente.ultimoCreditoAt instanceof Date ?
        cliente.ultimoCreditoAt
      : new Date(cliente.ultimoCreditoAt);
    if (!Number.isFinite(at.getTime())) return [];
    return [
      normalizeEntry({
        at,
        monto: cliente.ultimoCreditoMonto,
        saldoAnterior: cliente.ultimoCreditoSaldoAnterior ?? 0,
        saldoNuevo: cliente.ultimoCreditoSaldoNuevo ?? 0,
        tipo: cliente.ultimoCreditoTipo,
        motivo: cliente.ultimoCreditoMotivo,
        usuarioNombre: cliente.ultimoCreditoUsuarioNombre,
      }),
    ];
  }
  return [];
}
