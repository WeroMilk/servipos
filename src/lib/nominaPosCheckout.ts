import type { Employee, FiscalConfig, NominaConceptoLinea, NominaRecibo } from '@/types';
import { isValidCpMx, isValidRfcSat } from '@/lib/facturama/validateCfdi';
import { estimarIsrImssDesdePercepciones } from '@/lib/nominaDeduccionesEstimadas';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Quincena calendario del día (1–15 o 16–fin de mes). */
export function defaultQuincenaLocal(now = new Date()): {
  fechaIni: string;
  fechaFin: string;
  fechaPago: string;
  dias: number;
} {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();
  if (day <= 15) {
    const ini = new Date(y, m, 1);
    const fin = new Date(y, m, 15);
    return {
      fechaIni: isoDateLocal(ini),
      fechaFin: isoDateLocal(fin),
      fechaPago: isoDateLocal(fin),
      dias: 15,
    };
  }
  const ini = new Date(y, m, 16);
  const last = new Date(y, m + 1, 0);
  const dias = last.getDate() - 15;
  return {
    fechaIni: isoDateLocal(ini),
    fechaFin: isoDateLocal(last),
    fechaPago: isoDateLocal(last),
    dias,
  };
}

export function employeeListoParaNomina(
  emp: Employee | null | undefined
): { ok: true } | { ok: false; reason: string } {
  if (!emp?.id || !emp.activo) {
    return { ok: false, reason: 'Seleccione un empleado activo (alta en Nómina).' };
  }
  if (!emp.nombre?.trim()) return { ok: false, reason: 'El empleado debe tener nombre.' };
  if (!isValidRfcSat(emp.rfc)) return { ok: false, reason: 'El empleado debe tener RFC válido.' };
  const curp = String(emp.curp ?? '').trim().toUpperCase();
  if (curp.length !== 18) return { ok: false, reason: 'El empleado debe tener CURP de 18 caracteres.' };
  if (!emp.numeroEmpleado?.trim()) return { ok: false, reason: 'Falta número de empleado.' };
  if (!emp.puesto?.trim()) return { ok: false, reason: 'Falta puesto del empleado.' };
  if (!emp.fechaInicioRelLaboral?.trim()) {
    return { ok: false, reason: 'Falta fecha de inicio de relación laboral.' };
  }
  if (!emp.claveEntFed?.trim()) return { ok: false, reason: 'Falta entidad federativa (c_Estado).' };
  if (!isValidCpMx(emp.codigoPostal)) {
    return { ok: false, reason: 'El empleado debe tener código postal de 5 dígitos.' };
  }
  return { ok: true };
}

export function buildNominaBorradorFromSueldo(opts: {
  employee: Employee;
  fiscalConfig: FiscalConfig;
  sueldo: number;
  fechaPago: string;
  fechaInicialPago: string;
  fechaFinalPago: string;
  numDiasPagados: number;
  tipoNomina?: 'O' | 'E';
}): Omit<
  NominaRecibo,
  'id' | 'createdAt' | 'updatedAt' | 'sucursalId' | 'serie' | 'folio' | 'estado' | 'esPrueba'
> {
  const sueldoN = Math.round((Number(opts.sueldo) || 0) * 100) / 100;
  if (sueldoN <= 0) throw new Error('Sueldo inválido');
  if (!opts.fechaPago || !opts.fechaInicialPago || !opts.fechaFinalPago) {
    throw new Error('Indique fechas de pago y del periodo');
  }
  const listo = employeeListoParaNomina(opts.employee);
  if (!listo.ok) throw new Error(listo.reason);

  const est = estimarIsrImssDesdePercepciones([
    { clave: '001', concepto: 'Sueldo', gravado: sueldoN, exento: 0 },
  ]);
  const percepciones: NominaConceptoLinea[] = [
    {
      tipo: '001',
      clave: '001',
      concepto: 'Sueldo',
      importeGravado: sueldoN,
      importeExento: 0,
    },
  ];
  const deducciones: NominaConceptoLinea[] = [
    { tipo: '002', clave: '002', concepto: 'ISR', importe: est.isr },
    { tipo: '001', clave: '003', concepto: 'Seguridad social', importe: est.imss },
  ];
  const totalPercepciones = sueldoN;
  const totalDeducciones = Math.round((est.isr + est.imss) * 100) / 100;
  const neto = Math.round((totalPercepciones - totalDeducciones) * 100) / 100;

  return {
    empleadoId: opts.employee.id,
    empleado: opts.employee,
    tipoNomina: opts.tipoNomina ?? 'O',
    fechaPago: opts.fechaPago,
    fechaInicialPago: opts.fechaInicialPago,
    fechaFinalPago: opts.fechaFinalPago,
    numDiasPagados: Math.max(1, Math.floor(opts.numDiasPagados) || 15),
    formaPago: '99',
    lugarExpedicion: opts.fiscalConfig.lugarExpedicion,
    percepciones,
    deducciones,
    otrosPagos: [],
    totalPercepciones,
    totalDeducciones,
    totalOtrosPagos: 0,
    neto,
  };
}
