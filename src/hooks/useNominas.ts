import { useCallback, useEffect, useState } from 'react';
import type { Employee, NominaRecibo } from '@/types';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import {
  createEmployeeFirestore,
  deleteEmployeeFirestore,
  getEmployeesCatalogSnapshot,
  subscribeEmployeesCatalog,
  updateEmployeeFirestore,
} from '@/lib/firestore/employeesFirestore';
import {
  allocateNominaFolioFirestore,
  createNominaReciboFirestore,
  getNominaReciboFirestore,
  subscribeNominaRecibosCatalog,
  updateNominaReciboFirestore,
} from '@/lib/firestore/nominaRecibosFirestore';
import {
  cancelNominaWithFacturama,
  stampNominaWithFacturama,
} from '@/hooks/useFacturama';
import { getFiscalConfig } from '@/db/database';
import type { NominaPayloadInput } from '@/lib/facturama/mapNominaToFacturama';

export function useEmployees() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [employees, setEmployees] = useState<Employee[]>(() => getEmployeesCatalogSnapshot());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!effectiveSucursalId) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeEmployeesCatalog(effectiveSucursalId, (rows) => {
      setEmployees(rows);
      setLoading(false);
    });
  }, [effectiveSucursalId]);

  const addEmployee = useCallback(
    async (data: Omit<Employee, 'id' | 'createdAt' | 'updatedAt' | 'sucursalId'>) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      return createEmployeeFirestore(effectiveSucursalId, data);
    },
    [effectiveSucursalId]
  );

  const patchEmployee = useCallback(
    async (id: string, updates: Partial<Employee>) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      await updateEmployeeFirestore(effectiveSucursalId, id, updates);
    },
    [effectiveSucursalId]
  );

  const removeEmployee = useCallback(
    async (id: string) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      await deleteEmployeeFirestore(effectiveSucursalId, id);
    },
    [effectiveSucursalId]
  );

  return { employees, loading, addEmployee, patchEmployee, removeEmployee };
}

export function useNominaRecibos() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [recibos, setRecibos] = useState<NominaRecibo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!effectiveSucursalId) {
      setRecibos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeNominaRecibosCatalog(effectiveSucursalId, (rows) => {
      setRecibos(rows);
      setLoading(false);
    });
  }, [effectiveSucursalId]);

  const createBorrador = useCallback(
    async (
      payload: Omit<
        NominaRecibo,
        'id' | 'createdAt' | 'updatedAt' | 'sucursalId' | 'serie' | 'folio' | 'estado' | 'esPrueba'
      >
    ) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      const cfg = await getFiscalConfig();
      if (cfg?.modoPruebaFiscal) {
        throw new Error('Desactive el modo prueba fiscal para emitir nómina con validez SAT');
      }
      const { serie, folio } = await allocateNominaFolioFirestore(effectiveSucursalId);
      return createNominaReciboFirestore(effectiveSucursalId, {
        ...payload,
        serie,
        folio: String(folio),
        estado: 'borrador',
        esPrueba: false,
      });
    },
    [effectiveSucursalId]
  );

  const timbrar = useCallback(
    async (reciboId: string) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      const recibo = await getNominaReciboFirestore(effectiveSucursalId, reciboId);
      if (!recibo) throw new Error('Recibo no encontrado');
      if (recibo.estado === 'timbrada') throw new Error('Ya está timbrado');
      const emp = recibo.empleado;
      if (!emp) throw new Error('Falta snapshot del empleado en el recibo');

      const input: NominaPayloadInput = {
        expeditionPlace: recibo.lugarExpedicion,
        serie: recibo.serie,
        folio: recibo.folio,
        paymentForm: recibo.formaPago,
        tipoNomina: recibo.tipoNomina,
        fechaPago: recibo.fechaPago,
        fechaInicialPago: recibo.fechaInicialPago,
        fechaFinalPago: recibo.fechaFinalPago,
        numDiasPagados: recibo.numDiasPagados,
        employee: {
          rfc: emp.rfc,
          nombre: emp.nombre,
          curp: emp.curp,
          nss: emp.nss,
          numeroEmpleado: emp.numeroEmpleado,
          tipoContrato: emp.tipoContrato,
          tipoJornada: emp.tipoJornada,
          tipoRegimen: emp.tipoRegimen,
          puesto: emp.puesto,
          riesgoPuesto: emp.riesgoPuesto,
          periodicidadPago: emp.periodicidadPago,
          banco: emp.banco,
          cuentaBancaria: emp.cuentaBancaria,
          fechaInicioRelLaboral: emp.fechaInicioRelLaboral,
          departamento: emp.departamento,
          claveEntFed: emp.claveEntFed,
          codigoPostal: emp.codigoPostal,
          regimenFiscalReceptor: emp.regimenFiscalReceptor,
          salarioBaseCotApor: emp.salarioBaseCotApor,
          salarioDiarioIntegrado: emp.salarioDiarioIntegrado,
        },
        perceptions: recibo.percepciones.map((p) => ({
          tipoPercepcion: p.tipo,
          clave: p.clave,
          concepto: p.concepto,
          importeGravado: p.importeGravado ?? 0,
          importeExento: p.importeExento ?? 0,
        })),
        deductions: recibo.deducciones.map((d) => ({
          tipoDeduccion: d.tipo,
          clave: d.clave,
          concepto: d.concepto,
          importe: d.importe ?? 0,
        })),
        otherPayments: recibo.otrosPagos.map((o) => ({
          tipoOtroPago: o.tipo,
          clave: o.clave,
          concepto: o.concepto,
          importe: o.importe ?? 0,
          subsidioCausado: o.subsidioCausado,
        })),
      };

      const stamped = await stampNominaWithFacturama(input);
      await updateNominaReciboFirestore(effectiveSucursalId, reciboId, {
        facturamaId: stamped.facturamaId,
        uuid: stamped.uuid,
        xml: stamped.xml,
        selloDigital: stamped.selloDigital,
        fechaTimbrado: stamped.fechaTimbrado,
        estado: 'timbrada',
      });
      return stamped;
    },
    [effectiveSucursalId]
  );

  const cancelar = useCallback(
    async (reciboId: string, motive: string) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      const recibo = await getNominaReciboFirestore(effectiveSucursalId, reciboId);
      if (!recibo?.facturamaId) throw new Error('El recibo no está timbrado en Facturama');
      const { cancel } = await cancelNominaWithFacturama({
        facturamaId: recibo.facturamaId,
        motive,
      });
      const acuse =
        typeof (cancel as { AcuseXmlBase64?: string }).AcuseXmlBase64 === 'string'
          ? (cancel as { AcuseXmlBase64: string }).AcuseXmlBase64
          : JSON.stringify(cancel);
      await updateNominaReciboFirestore(effectiveSucursalId, reciboId, {
        estado: 'cancelada',
        motivoCancelacion: motive,
        fechaCancelacion: new Date(),
        acuseCancelacion: acuse,
      });
    },
    [effectiveSucursalId]
  );

  return { recibos, loading, createBorrador, timbrar, cancelar };
}

export function reportNominaHookError(scope: string, err: unknown) {
  console.error(`[nominas] ${scope}`, err);
}
