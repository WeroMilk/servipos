import { getSupabase } from '@/lib/supabaseClient';

export type FacturamaCancelType = 'issued' | 'payroll';
export type FacturamaDownloadFormat = 'xml' | 'pdf' | 'html';

export type FacturamaCreateResult = {
  ok: true;
  cfdi: Record<string, unknown>;
};

export type FacturamaCancelResult = {
  ok: true;
  cancel: Record<string, unknown>;
};

export type FacturamaDownloadResult = {
  ok: true;
  format: FacturamaDownloadFormat;
  contentType: string;
  text?: string;
  base64?: string;
};

export type FacturamaStatusResult = {
  ok: true;
  account: unknown;
};

type FacturamaErrorBody = {
  error?: string;
  facturamaStatus?: number;
  detail?: unknown;
};

function formatFacturamaClientError(json: FacturamaErrorBody, status: number): string {
  const parts: string[] = [];
  if (typeof json.error === 'string' && json.error.trim()) parts.push(json.error.trim());
  const detail = json.detail;
  if (typeof detail === 'string' && detail.trim() && detail.trim() !== json.error) {
    parts.push(detail.trim());
  } else if (detail && typeof detail === 'object') {
    const o = detail as Record<string, unknown>;
    if (typeof o.Message === 'string' && o.Message.trim() && o.Message.trim() !== json.error) {
      parts.push(o.Message.trim());
    }
    if (o.ModelState && typeof o.ModelState === 'object') {
      for (const [k, v] of Object.entries(o.ModelState as Record<string, unknown>)) {
        if (Array.isArray(v)) parts.push(`${k}: ${v.join(', ')}`);
        else if (v != null) parts.push(`${k}: ${String(v)}`);
      }
    }
  }
  if (!parts.length) return `Error Facturama (${status})`;
  return parts.join(' — ');
}

async function invokeFacturama<T>(body: Record<string, unknown>): Promise<T> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error('Falta VITE_SUPABASE_URL');

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesión requerida para timbrar con Facturama');

  const url = `${base.replace(/\/$/, '')}/functions/v1/facturama-cfdi`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'No se pudo contactar facturama-cfdi. Despliegue la Edge Function y revise FACTURAMA_CFDI_ALLOWED_ORIGINS / ADMIN_CREATE_USER_ALLOWED_ORIGINS.'
    );
  }

  let json: FacturamaErrorBody & T;
  try {
    json = (await res.json()) as FacturamaErrorBody & T;
  } catch {
    throw new Error(
      res.ok
        ? 'Respuesta inválida de Facturama'
        : `Error del servidor Facturama (${res.status})`
    );
  }

  if (!res.ok) {
    if (res.status === 403 && json.error?.toLowerCase().includes('origin')) {
      throw new Error(
        'Origen no permitido: agregue la URL de la app a FACTURAMA_CFDI_ALLOWED_ORIGINS o ADMIN_CREATE_USER_ALLOWED_ORIGINS.'
      );
    }
    throw new Error(formatFacturamaClientError(json, res.status));
  }

  return json as T;
}

export function facturamaStatus() {
  return invokeFacturama<FacturamaStatusResult>({ action: 'status' });
}

export function facturamaCreate(payload: unknown) {
  return invokeFacturama<FacturamaCreateResult>({ action: 'create', payload });
}

export function facturamaCancel(opts: {
  id: string;
  type?: FacturamaCancelType;
  motive: string;
  uuidReplacement?: string;
}) {
  return invokeFacturama<FacturamaCancelResult>({
    action: 'cancel',
    id: opts.id,
    type: opts.type ?? 'issued',
    motive: opts.motive,
    uuidReplacement: opts.uuidReplacement,
  });
}

export function facturamaDownload(opts: {
  id: string;
  type?: FacturamaCancelType;
  format?: FacturamaDownloadFormat;
}) {
  return invokeFacturama<FacturamaDownloadResult>({
    action: 'download',
    id: opts.id,
    type: opts.type ?? 'issued',
    format: opts.format ?? 'xml',
  });
}

export function facturamaDetail(opts: { id: string; type?: FacturamaCancelType }) {
  return invokeFacturama<{ ok: true; detail: Record<string, unknown> }>({
    action: 'detail',
    id: opts.id,
    type: opts.type ?? 'issued',
  });
}

export function facturamaEmail(opts: {
  id: string;
  type?: FacturamaCancelType;
  email: string;
  subject?: string;
  comments?: string;
  issuerEmail?: string;
}) {
  return invokeFacturama<{ ok: true; sent: unknown }>({
    action: 'email',
    id: opts.id,
    type: opts.type ?? 'issued',
    email: opts.email,
    subject: opts.subject,
    comments: opts.comments,
    issuerEmail: opts.issuerEmail,
  });
}

function pickNestedStampUuid(cfdi: Record<string, unknown>): string | undefined {
  const complement = (cfdi.Complement ?? cfdi.complement) as Record<string, unknown> | undefined;
  const stamp = (complement?.TaxStamp ?? complement?.taxStamp) as Record<string, unknown> | undefined;
  const u = String(stamp?.Uuid ?? stamp?.uuid ?? '').trim();
  return u || undefined;
}

/** Extrae Id, UUID y folio/serie que asigna Facturama al timbrar. */
export function pickFacturamaStampMeta(cfdi: Record<string, unknown>): {
  facturamaId: string;
  uuid?: string;
  folio?: string;
  serie?: string;
} {
  const facturamaId = String(cfdi.Id ?? cfdi.id ?? '').trim();
  const uuid =
    String(cfdi.Uuid ?? cfdi.uuid ?? '').trim() || pickNestedStampUuid(cfdi) || undefined;
  const folioRaw = cfdi.Folio ?? cfdi.folio;
  const serieRaw = cfdi.Serie ?? cfdi.serie;
  const folio =
    folioRaw != null && String(folioRaw).trim() !== '' ? String(folioRaw).trim() : undefined;
  const serie =
    serieRaw != null && String(serieRaw).trim() !== '' ? String(serieRaw).trim() : undefined;
  if (!facturamaId) throw new Error('Facturama no devolvió Id del CFDI');
  return { facturamaId, uuid, folio, serie };
}

/** Extrae Id / Uuid del objeto de respuesta de create. */
export function pickFacturamaIds(cfdi: Record<string, unknown>): {
  facturamaId: string;
  uuid?: string;
} {
  const { facturamaId, uuid } = pickFacturamaStampMeta(cfdi);
  return { facturamaId, uuid };
}

/** Extrae Sello del emisor desde XML CFDI. */
export function extractSelloFromCfdiXml(xml: string): string | undefined {
  const m =
    xml.match(/\bSello="([^"]+)"/) ||
    xml.match(/\bSello\s*=\s*'([^']+)'/);
  return m?.[1]?.trim() || undefined;
}

export function extractUuidFromCfdiXml(xml: string): string | undefined {
  const m =
    xml.match(/\bUUID="([^"]+)"/i) ||
    xml.match(/\bUUID\s*=\s*'([^']+)'/i);
  return m?.[1]?.trim().toUpperCase() || undefined;
}
