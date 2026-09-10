function decodeStdBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function unwrapFacturamaFileJson(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const o = JSON.parse(t) as { Content?: unknown; content?: unknown };
    const inner = o.Content ?? o.content;
    return typeof inner === 'string' && inner.trim() ? inner.trim() : null;
  } catch {
    return null;
  }
}

/** Decodifica PDF de Facturama: bytes crudos, base64, o FileViewModel JSON. */
export function pdfBase64ToUint8Array(raw: string): Uint8Array {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('PDF vacío');
  const payload = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;

  const fromInner = (inner: string): Uint8Array => {
    const bytes = decodeStdBase64(inner);
    if (!hasPdfMagic(bytes)) {
      throw new Error('El archivo descargado no es un PDF válido');
    }
    return bytes;
  };

  const asJson = unwrapFacturamaFileJson(payload);
  if (asJson) return fromInner(asJson);

  const first = decodeStdBase64(payload);
  if (hasPdfMagic(first)) return first;

  const nested = unwrapFacturamaFileJson(new TextDecoder().decode(first));
  if (nested) return fromInner(nested);

  throw new Error('El archivo descargado no es un PDF válido');
}

export function uint8ArrayToPdfBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}
