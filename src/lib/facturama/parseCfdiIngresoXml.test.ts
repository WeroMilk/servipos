import { describe, expect, test } from 'vitest';
import { parseCfdiIngresoXml } from '@/lib/facturama/parseCfdiIngresoXml';

const sample = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="B" Folio="88"
  Fecha="2026-03-01T10:00:00" FormaPago="99" MetodoPago="PPD" SubTotal="1000.00" Total="1160.00"
  TipoDeComprobante="I" LugarExpedicion="83180" Sello="AAA">
  <cfdi:Emisor Rfc="ZADJ970326LK8" Nombre="SERVIPARTZ" RegimenFiscal="612"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO" DomicilioFiscalReceptor="44100"
    RegimenFiscalReceptor="616" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="52141500" Cantidad="1" ClaveUnidad="H87" Descripcion="FILTRO"
      ValorUnitario="1000.00" Importe="1000.00"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" FechaTimbrado="2026-03-01T10:01:00"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

describe('parseCfdiIngresoXml', () => {
  test('lee UUID, PPD, receptor y total', () => {
    const p = parseCfdiIngresoXml(sample);
    expect(p.uuid).toBe('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
    expect(p.serie).toBe('B');
    expect(p.folio).toBe('88');
    expect(p.metodoPago).toBe('PPD');
    expect(p.formaPago).toBe('99');
    expect(p.total).toBe(1160);
    expect(p.receptorRfc).toBe('XAXX010101000');
    expect(p.conceptos[0]?.descripcion).toBe('FILTRO');
  });

  test('rechaza complemento tipo P', () => {
    expect(() => parseCfdiIngresoXml(sample.replace('TipoDeComprobante="I"', 'TipoDeComprobante="P"'))).toThrow(
      /complemento/i
    );
  });

  test('rechaza PUE que no es forma 99', () => {
    expect(() =>
      parseCfdiIngresoXml(
        sample.replace('MetodoPago="PPD"', 'MetodoPago="PUE"').replace('FormaPago="99"', 'FormaPago="03"')
      )
    ).toThrow(/PUE/);
  });
});
