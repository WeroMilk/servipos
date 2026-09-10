import { describe, expect, test } from 'vitest';
import { pdfBase64ToUint8Array } from '@/lib/pdfBase64';

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n%fake\n');
}

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe('pdfBase64ToUint8Array', () => {
  test('decodifica PDF en base64 directo', () => {
    const src = pdfBytes();
    const out = pdfBase64ToUint8Array(toB64(src));
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  test('extrae Content del JSON FileViewModel de Facturama', () => {
    const src = pdfBytes();
    const json = JSON.stringify({
      ContentEncoding: 'base64',
      ContentType: 'pdf',
      Content: toB64(src),
    });
    const out = pdfBase64ToUint8Array(btoa(json));
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  test('acepta el JSON crudo si llegó sin recodificar', () => {
    const src = pdfBytes();
    const json = JSON.stringify({ Content: toB64(src) });
    const out = pdfBase64ToUint8Array(json);
    expect(Array.from(out)).toEqual(Array.from(src));
  });
});
