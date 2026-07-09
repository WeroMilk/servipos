import type { Sale } from '@/types';

export function nombreClienteVenta(s: Sale): string {
  const n = s.cliente?.nombre?.trim();
  if (n) return n;
  if (s.clienteId && s.clienteId !== 'mostrador') return s.clienteId;
  return 'Mostrador';
}

export function nombreCajeroVenta(s: Sale): string {
  return s.usuarioNombre?.trim() || '';
}

export function saleMatchesTicketSearch(sale: Sale, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return false;
  const folio = (sale.folio ?? '').toLowerCase();
  const cliente = nombreClienteVenta(sale).toLowerCase();
  const cajero = nombreCajeroVenta(sale).toLowerCase();
  if (folio.includes(q) || cliente.includes(q) || cajero.includes(q)) return true;
  return (sale.productos ?? []).some((line) => {
    const name = (line.productoNombre?.trim() || line.producto?.nombre?.trim() || '').toLowerCase();
    return name.length > 0 && name.includes(q);
  });
}
