import { useState, useEffect, useCallback } from 'react';
import type { Invoice } from '@/types';
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  cancelInvoice,
  allocateNextInvoiceFolio,
  getNextInvoiceFolio,
  getFiscalConfig,
  deleteInvoiceRecord,
  reservePruebaInvoiceFolio,
} from '@/db/database';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { reportHookFailure } from '@/lib/appEventLog';
import { buildCfdi40XmlString } from '@/lib/cfdiXmlString';
import {
  createInvoiceFirestore,
  deleteInvoiceFirestore,
  subscribeInvoicesCatalog,
  updateInvoiceFirestore,
} from '@/lib/firestore/invoicesFirestore';
import { patchSaleInvoiceFirestore } from '@/lib/firestore/salesFirestore';

// ============================================
// HOOK DE FACTURAS
// ============================================

export function useInvoices() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getInvoices(effectiveSucursalId);
      setInvoices(data);
      setError(null);
    } catch (err) {
      reportHookFailure('hook:useInvoices', 'Cargar facturas', err);
      setError('Error al cargar facturas');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (effectiveSucursalId) {
      setLoading(true);
      const unsub = subscribeInvoicesCatalog(effectiveSucursalId, (rows) => {
        setInvoices(rows);
        setError(null);
        setLoading(false);
      });
      return unsub;
    }
    void loadInvoices();
  }, [loadInvoices]);

  const addInvoice = async (
    invoice: Omit<Invoice, 'id' | 'folio' | 'serie' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'esPrueba'>
  ) => {
    try {
      const cfg = await getFiscalConfig();
      if (!cfg) throw new Error('No hay configuración fiscal');

      const sucursalId = getEffectiveSucursalId();

      if (cfg.modoPruebaFiscal) {
        const { serie, folio } = await reservePruebaInvoiceFolio();
        const payload = { ...invoice, serie, folio, esPrueba: true };
        const id = sucursalId
          ? await createInvoiceFirestore(sucursalId, payload)
          : await createInvoice(payload, { sucursalId });
        if (sucursalId && payload.ventaId) {
          await patchSaleInvoiceFirestore(sucursalId, payload.ventaId, {
            facturaId: id,
            estado: 'facturada',
          });
        }
        await loadInvoices();
        return id;
      }

      const { serie, folio } = await allocateNextInvoiceFolio();
      const payload = {
        ...invoice,
        serie,
        folio: folio.toString(),
        esPrueba: false,
      };
      const id = sucursalId
        ? await createInvoiceFirestore(sucursalId, payload)
        : await createInvoice(payload, { sucursalId });
      if (sucursalId && payload.ventaId) {
        await patchSaleInvoiceFirestore(sucursalId, payload.ventaId, {
          facturaId: id,
          estado: 'facturada',
        });
      }
      await loadInvoices();
      return id;
    } catch (err) {
      setError('Error al crear factura');
      throw err;
    }
  };

  const cancel = async (id: string, motivo: string) => {
    try {
      const sucursalId = getEffectiveSucursalId();
      if (sucursalId) {
        const inv = invoices.find((x) => x.id === id);
        if (!inv) throw new Error('Factura no encontrada');
        await updateInvoiceFirestore(sucursalId, id, {
          estado: 'cancelada',
          motivoCancelacion: motivo,
          fechaCancelacion: new Date(),
        });
        if (inv.ventaId) {
          await patchSaleInvoiceFirestore(sucursalId, inv.ventaId, {
            facturaId: null,
            estado: 'completada',
          });
        }
        return;
      }
      await cancelInvoice(id, motivo, { sucursalId });
      await loadInvoices();
    } catch (err) {
      reportHookFailure('hook:useInvoices', 'Cancelar factura', err);
      setError('Error al cancelar factura');
      throw err;
    }
  };

  const removeInvoice = async (id: string) => {
    try {
      if (effectiveSucursalId) {
        const inv = invoices.find((x) => x.id === id);
        if (!inv) return;
        if (inv.estado === 'timbrada') {
          throw new Error('No se puede eliminar una factura ya timbrada ante el SAT.');
        }
        await deleteInvoiceFirestore(effectiveSucursalId, id);
        return;
      }
      await deleteInvoiceRecord(id);
      await loadInvoices();
    } catch (err) {
      reportHookFailure('hook:useInvoices', 'Eliminar factura', err);
      setError('Error al eliminar factura');
      throw err;
    }
  };

  return {
    invoices,
    loading,
    error,
    refresh: loadInvoices,
    addInvoice,
    cancelInvoice: cancel,
    removeInvoice,
  };
}

export function useInvoiceDetails(invoiceId: string | null) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invoiceId) {
      setInvoice(null);
      return;
    }

    const loadInvoice = async () => {
      try {
        setLoading(true);
        const data = await getInvoiceById(invoiceId);
        setInvoice(data || null);
      } catch (err) {
        reportHookFailure('hook:useInvoiceDetails', 'Cargar factura', err);
        console.error('Error al cargar factura:', err);
      } finally {
        setLoading(false);
      }
    };

    loadInvoice();
  }, [invoiceId]);

  return { invoice, loading };
}

export function useNextFolio() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [nextFolio, setNextFolio] = useState<{ serie: string; folio: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadNextFolio = useCallback(async () => {
    try {
      setLoading(true);
      const folio = await getNextInvoiceFolio();
      setNextFolio(folio);
    } catch (err) {
      reportHookFailure('hook:useNextFolio', 'Obtener folio de factura', err);
      console.error('Error al obtener siguiente folio:', err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    loadNextFolio();
  }, [loadNextFolio]);

  return { nextFolio, loading, refresh: loadNextFolio };
}

// ============================================
// GENERACIÓN DE XML CFDI 4.0
// ============================================

export function useCFDIGenerator() {
  const generateXML = async (invoice: Invoice): Promise<string> => {
    const config = await getFiscalConfig();
    if (!config) {
      throw new Error('No hay configuración fiscal');
    }
    const emisor = invoice.emisor?.rfc ? invoice.emisor : config;
    return buildCfdi40XmlString({ ...invoice, emisor });
  };

  return { generateXML };
}
