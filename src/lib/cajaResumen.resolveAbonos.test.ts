import { describe, expect, it } from 'vitest';
import { resolveAbonosCobrosSesion } from './cajaResumen';
import type { CajaAbonoCobro, Sale } from '@/types';

describe('resolveAbonosCobrosSesion', () => {
  it('no duplica total de sesión con parciales esAbonoCxC del mismo cliente', () => {
    const day = new Date('2026-07-21T16:12:00.000Z');
    const sesionAbono: CajaAbonoCobro = {
      id: 'abono-561',
      monto: 561,
      formaPago: '01',
      clienteId: 'cli-leo',
      clienteNombre: 'LEONARDO ROMERO',
      createdAt: day,
      usuarioId: 'u1',
      usuarioNombre: 'Gabriel',
    };
    const ventasPool: Sale[] = [
      {
        id: 's1',
        folio: 'V-1',
        estado: 'completada',
        clienteId: 'cli-leo',
        cliente: { id: 'cli-leo', nombre: 'LEONARDO ROMERO' } as Sale['cliente'],
        total: 546,
        subtotal: 546,
        descuento: 0,
        impuestos: 0,
        formaPago: 'PPC',
        metodoPago: 'PPD',
        pagos: [
          {
            id: 'p1',
            formaPago: '01',
            monto: 546,
            cajaSesionId: 'ses-1',
            esAbonoCxC: true,
          },
        ],
        productos: [],
        cambio: 0,
        createdAt: day,
        updatedAt: day,
        completedAt: day,
        usuarioId: 'u1',
        usuarioNombre: 'Gabriel',
        syncStatus: 'synced',
      } as Sale,
      {
        id: 's2',
        folio: 'V-2',
        estado: 'completada',
        clienteId: 'cli-leo',
        cliente: { id: 'cli-leo', nombre: 'LEONARDO ROMERO' } as Sale['cliente'],
        total: 15,
        subtotal: 15,
        descuento: 0,
        impuestos: 0,
        formaPago: 'PPC',
        metodoPago: 'PPD',
        pagos: [
          {
            id: 'p2',
            formaPago: '01',
            monto: 15,
            cajaSesionId: 'ses-1',
            esAbonoCxC: true,
          },
        ],
        productos: [],
        cambio: 0,
        createdAt: day,
        updatedAt: day,
        completedAt: day,
        usuarioId: 'u1',
        usuarioNombre: 'Gabriel',
        syncStatus: 'synced',
      } as Sale,
    ];

    const resolved = resolveAbonosCobrosSesion(
      { id: 'ses-1', abonosCobros: [sesionAbono] },
      ventasPool,
      []
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].monto).toBe(561);
    expect(resolved.reduce((s, a) => s + a.monto, 0)).toBe(561);
  });

  it('usa parciales de tickets solo si no hay abono canónico del cliente', () => {
    const day = new Date('2026-07-21T16:12:00.000Z');
    const ventasPool: Sale[] = [
      {
        id: 's1',
        folio: 'V-1',
        estado: 'completada',
        clienteId: 'cli-x',
        total: 100,
        subtotal: 100,
        descuento: 0,
        impuestos: 0,
        formaPago: 'PPC',
        metodoPago: 'PPD',
        pagos: [
          {
            id: 'p1',
            formaPago: '01',
            monto: 100,
            cajaSesionId: 'ses-2',
            esAbonoCxC: true,
          },
        ],
        productos: [],
        cambio: 0,
        createdAt: day,
        updatedAt: day,
        usuarioId: 'u1',
        syncStatus: 'synced',
      } as Sale,
    ];

    const resolved = resolveAbonosCobrosSesion({ id: 'ses-2', abonosCobros: [] }, ventasPool, []);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].monto).toBe(100);
    expect(resolved[0].id).toBe('pago:s1:p1');
  });
});
