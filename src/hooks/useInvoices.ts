import { useState, useEffect, useCallback } from 'react';
import type { Invoice } from '@/types';
import { 
  getInvoices, 
  getInvoiceById, 
  createInvoice,
  cancelInvoice,
  getNextInvoiceFolio,
  incrementInvoiceFolio,
  getFiscalConfig
} from '@/db/database';
import { useAuthStore } from '@/stores';

// ============================================
// HOOK DE FACTURAS
// ============================================

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getInvoices();
      setInvoices(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar facturas');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const addInvoice = async (invoice: Omit<Invoice, 'id' | 'folio' | 'serie' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    try {
      // Obtener siguiente folio
      const { serie, folio } = await getNextInvoiceFolio();
      
      const sucursalId = useAuthStore.getState().user?.sucursalId;
      const id = await createInvoice(
        {
          ...invoice,
          serie,
          folio: folio.toString(),
        },
        { sucursalId }
      );
      
      // Incrementar folio para la siguiente factura
      await incrementInvoiceFolio();
      
      await loadInvoices();
      return id;
    } catch (err) {
      setError('Error al crear factura');
      throw err;
    }
  };

  const cancel = async (id: string, motivo: string) => {
    try {
      const sucursalId = useAuthStore.getState().user?.sucursalId;
      await cancelInvoice(id, motivo, { sucursalId });
      await loadInvoices();
    } catch (err) {
      setError('Error al cancelar factura');
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
  const [nextFolio, setNextFolio] = useState<{ serie: string; folio: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadNextFolio = useCallback(async () => {
    try {
      setLoading(true);
      const folio = await getNextInvoiceFolio();
      setNextFolio(folio);
    } catch (err) {
      console.error('Error al obtener siguiente folio:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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

    const fechaEmision = new Date(invoice.fechaEmision).toISOString().slice(0, 19);
    
    // Construir XML CFDI 4.0 (simplificado)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante 
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"
  Version="4.0"
  Serie="${invoice.serie}"
  Folio="${invoice.folio}"
  Fecha="${fechaEmision}"
  FormaPago="${invoice.formaPago}"
  MetodoPago="${invoice.metodoPago}"
  SubTotal="${invoice.subtotal.toFixed(2)}"
  Descuento="${invoice.descuento.toFixed(2)}"
  Moneda="MXN"
  Total="${invoice.total.toFixed(2)}"
  TipoDeComprobante="I"
  Exportacion="01"
  LugarExpedicion="${invoice.lugarExpedicion}">
  
  <cfdi:Emisor 
    Rfc="${config.rfc}" 
    Nombre="${config.razonSocial}" 
    RegimenFiscal="${config.regimenFiscal}"/>
  
  <cfdi:Receptor 
    Rfc="${invoice.cliente?.rfc || 'XAXX010101000'}" 
    Nombre="${invoice.cliente?.razonSocial || invoice.cliente?.nombre || 'Público en General'}" 
    DomicilioFiscalReceptor="${invoice.cliente?.codigoPostal || invoice.lugarExpedicion}" 
    RegimenFiscalReceptor="${invoice.cliente?.regimenFiscal || '616'}" 
    UsoCFDI="${invoice.cliente?.usoCfdi || 'S01'}"/>
  
  <cfdi:Conceptos>
    ${invoice.productos.map(item => `
    <cfdi:Concepto 
      ClaveProdServ="${item.claveProdServ || '01010101'}"
      Cantidad="${item.cantidad.toFixed(2)}"
      ClaveUnidad="${item.claveUnidad || 'H87'}"
      Descripcion="${item.descripcion}"
      ValorUnitario="${item.precioUnitario.toFixed(2)}"
      Importe="${item.subtotal.toFixed(2)}"
      Descuento="${item.descuento.toFixed(2)}"
      ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado 
            Base="${(item.subtotal - item.descuento).toFixed(2)}"
            Impuesto="002"
            TipoFactor="Tasa"
            TasaOCuota="0.160000"
            Importe="${item.impuestosTrasladados.reduce((sum, tax) => sum + tax.importe, 0).toFixed(2)}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
    `).join('')}
  </cfdi:Conceptos>
  
  <cfdi:Impuestos TotalImpuestosTrasladados="${invoice.impuestosTrasladados.toFixed(2)}">
    <cfdi:Traslados>
      <cfdi:Traslado 
        Base="${(invoice.subtotal - invoice.descuento).toFixed(2)}"
        Impuesto="002"
        TipoFactor="Tasa"
        TasaOCuota="0.160000"
        Importe="${invoice.impuestosTrasladados.toFixed(2)}"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  
</cfdi:Comprobante>`;

    return xml;
  };

  return { generateXML };
}
