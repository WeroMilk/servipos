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
    throw new Error(json.error ?? `Error Facturama (${res.status})`);
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

/** Extrae Id / Uuid del objeto de respuesta de create. */
export function pickFacturamaIds(cfdi: Record<string, unknown>): {
  facturamaId: string;
  uuid?: string;
} {
  const facturamaId = String(cfdi.Id ?? cfdi.id ?? '').trim();
  const uuid = String(cfdi.Uuid ?? cfdi.uuid ?? '').trim() || undefined;
  if (!facturamaId) throw new Error('Facturama no devolvió Id del CFDI');
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
