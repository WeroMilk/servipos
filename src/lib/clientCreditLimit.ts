import type { Client } from '@/types';

/** True si el cliente tiene límite configurado y su adeudo ya lo alcanzó o superó. */
export function clientReachedCreditLimit(
  client: Pick<Client, 'isMostrador' | 'saldoAdeudado' | 'limiteCredito'> | null | undefined
): boolean {
  if (!client || client.isMostrador) return false;
  // null/undefined = sin límite (Number(null) === 0, no usar Number directo).
  if (client.limiteCredito == null) return false;
  const limite = Number(client.limiteCredito);
  if (!Number.isFinite(limite) || limite < 0) return false;
  const adeudo = Math.max(0, Number(client.saldoAdeudado) || 0);
  return adeudo >= limite;
}
