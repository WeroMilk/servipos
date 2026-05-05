import type { Client, ClientAbonoHistorialEntry } from '@/types';

function normalizeEntry(e: ClientAbonoHistorialEntry): ClientAbonoHistorialEntry {
  const at = e.at instanceof Date ? e.at : new Date(e.at);
  const monto = Math.round(Math.max(0, Number(e.monto) || 0) * 100) / 100;
  const saldoAnterior = Math.round(Math.max(0, Number(e.saldoAnterior) || 0) * 100) / 100;
  const saldoNuevo = Math.round(Math.max(0, Number(e.saldoNuevo) || 0) * 100) / 100;
  return {
    at,
    monto,
    saldoAnterior,
    saldoNuevo,
    usuarioNombre: e.usuarioNombre?.trim() || undefined,
  };
}

/** Lista para pantalla Cuentas por cobrar: nuevos primero; incluye legado solo con `ultimoAbono*`. */
export function listaAbonosCxCMostrable(cliente: Client): ClientAbonoHistorialEntry[] {
  const raw = cliente.abonosHistorial;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map(normalizeEntry).filter((e) => Number.isFinite(e.at.getTime()));
  }
  if (cliente.ultimoAbonoAt != null && cliente.ultimoAbonoMonto != null) {
    const at =
      cliente.ultimoAbonoAt instanceof Date ?
        cliente.ultimoAbonoAt
      : new Date(cliente.ultimoAbonoAt);
    if (!Number.isFinite(at.getTime())) return [];
    return [
      normalizeEntry({
        at,
        monto: cliente.ultimoAbonoMonto,
        saldoAnterior: cliente.ultimoAbonoSaldoAnterior ?? 0,
        saldoNuevo: cliente.ultimoAbonoSaldoNuevo ?? 0,
        usuarioNombre: cliente.ultimoAbonoUsuarioNombre,
      }),
    ];
  }
  return [];
}
