import { describe, expect, test } from 'vitest';
import type { Employee } from '@/types';
import {
  defaultQuincenaLocal,
  employeeListoParaNomina,
  buildNominaBorradorFromSueldo,
} from '@/lib/nominaPosCheckout';

const emp: Employee = {
  id: 'e1',
  numeroEmpleado: '12',
  nombre: 'JUAN PEREZ',
  rfc: 'XAXX010101000',
  curp: 'PEXJ010101HJCRRNA1',
  tipoContrato: '01',
  tipoRegimen: '02',
  puesto: 'Cajero',
  periodicidadPago: '04',
  fechaInicioRelLaboral: '2024-01-15',
  claveEntFed: 'SON',
  codigoPostal: '83180',
  activo: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('defaultQuincenaLocal', () => {
  test('primera quincena', () => {
    const q = defaultQuincenaLocal(new Date(2026, 8, 7));
    expect(q.fechaIni).toBe('2026-09-01');
    expect(q.fechaFin).toBe('2026-09-15');
    expect(q.dias).toBe(15);
  });
  test('segunda quincena septiembre', () => {
    const q = defaultQuincenaLocal(new Date(2026, 8, 20));
    expect(q.fechaIni).toBe('2026-09-16');
    expect(q.fechaFin).toBe('2026-09-30');
    expect(q.dias).toBe(15);
  });
});

describe('employeeListoParaNomina', () => {
  test('acepta empleado completo', () => {
    expect(employeeListoParaNomina(emp).ok).toBe(true);
  });
  test('rechaza sin CURP', () => {
    expect(employeeListoParaNomina({ ...emp, curp: 'X' }).ok).toBe(false);
  });
});

describe('buildNominaBorradorFromSueldo', () => {
  test('arma percepciones e ISR', () => {
    const draft = buildNominaBorradorFromSueldo({
      employee: emp,
      fiscalConfig: { lugarExpedicion: '83180' } as Parameters<
        typeof buildNominaBorradorFromSueldo
      >[0]['fiscalConfig'],
      sueldo: 9000,
      fechaPago: '2026-09-15',
      fechaInicialPago: '2026-09-01',
      fechaFinalPago: '2026-09-15',
      numDiasPagados: 15,
    });
    expect(draft.neto).toBeLessThan(9000);
    expect(draft.percepciones).toHaveLength(1);
    expect(draft.deducciones.length).toBe(2);
  });
});
