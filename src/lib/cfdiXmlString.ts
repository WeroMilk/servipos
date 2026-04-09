import type { Invoice } from '@/types';

/** Escapa texto para atributos / contenido en XML. */
export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * CFDI 4.0 simplificado (misma estructura que `useCFDIGenerator`), usando `invoice.emisor`.
 * Sirve para vista previa / representación impresa sin leer configuración de Dexie.
 */
export function buildCfdi40XmlString(invoice: Invoice): string {
  const emisor = invoice.emisor;
  const fechaEmision = new Date(invoice.fechaEmision).toISOString().slice(0, 19);
  const pruebaComment = invoice.esPrueba
    ? '\n<!-- Documento de prueba: sin timbrado ni validez ante el SAT -->\n'
    : '';

  const rfcE = escapeXmlText(emisor.rfc);
  const nomE = escapeXmlText(emisor.razonSocial);
  const regE = escapeXmlText(emisor.regimenFiscal);
  const rfcR = escapeXmlText(invoice.cliente?.rfc || 'XAXX010101000');
  const nomR = escapeXmlText(
    invoice.cliente?.razonSocial || invoice.cliente?.nombre || 'Público en General'
  );
  const cpR = escapeXmlText(
    invoice.cliente?.codigoPostal || invoice.cliente?.direccion?.codigoPostal || invoice.lugarExpedicion
  );
  const regR = escapeXmlText(invoice.cliente?.regimenFiscal || '616');
  const usoR = escapeXmlText(invoice.cliente?.usoCfdi || 'S01');
  const lugar = escapeXmlText(invoice.lugarExpedicion);

  const conceptosXml = (invoice.productos ?? [])
    .map((item) => {
      const desc = escapeXmlText((item.descripcion || '').trim() || '—');
      const cps = escapeXmlText((item.claveProdServ || '01010101').trim());
      const cu = escapeXmlText((item.claveUnidad || 'H87').trim());
      const ivaImp = item.impuestosTrasladados.reduce((sum, tax) => sum + tax.importe, 0);
      return `
    <cfdi:Concepto 
      ClaveProdServ="${cps}"
      Cantidad="${item.cantidad.toFixed(2)}"
      ClaveUnidad="${cu}"
      Descripcion="${desc}"
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
            Importe="${ivaImp.toFixed(2)}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>${pruebaComment}
<cfdi:Comprobante 
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"
  Version="4.0"
  Serie="${escapeXmlText(invoice.serie)}"
  Folio="${escapeXmlText(invoice.folio)}"
  Fecha="${fechaEmision}"
  FormaPago="${escapeXmlText(invoice.formaPago)}"
  MetodoPago="${escapeXmlText(invoice.metodoPago)}"
  SubTotal="${invoice.subtotal.toFixed(2)}"
  Descuento="${invoice.descuento.toFixed(2)}"
  Moneda="MXN"
  Total="${invoice.total.toFixed(2)}"
  TipoDeComprobante="I"
  Exportacion="01"
  LugarExpedicion="${lugar}">
  
  <cfdi:Emisor Rfc="${rfcE}" Nombre="${nomE}" RegimenFiscal="${regE}"/>
  
  <cfdi:Receptor 
    Rfc="${rfcR}" 
    Nombre="${nomR}" 
    DomicilioFiscalReceptor="${cpR}" 
    RegimenFiscalReceptor="${regR}" 
    UsoCFDI="${usoR}"/>
  
  <cfdi:Conceptos>${conceptosXml}
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
}
