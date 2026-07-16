/** Cliente HTTP Basic Auth para Facturama API Web (producción por defecto). */

export type FacturamaCancelType = 'issued' | 'payroll';
export type FacturamaDownloadFormat = 'xml' | 'pdf' | 'html';

export type FacturamaClientConfig = {
  baseUrl: string;
  user: string;
  password: string;
};

export class FacturamaApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'FacturamaApiError';
    this.status = status;
    this.body = body;
  }
}

function basicAuthHeader(user: string, password: string): string {
  const token = btoa(`${user}:${password}`);
  return `Basic ${token}`;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (typeof o.Message === 'string' && o.Message.trim()) return o.Message.trim();
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (Array.isArray(o.ModelState)) {
      return o.ModelState.map(String).join('; ');
    }
    if (o.ModelState && typeof o.ModelState === 'object') {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(o.ModelState as Record<string, unknown>)) {
        if (Array.isArray(v)) parts.push(`${k}: ${v.join(', ')}`);
        else if (v != null) parts.push(`${k}: ${String(v)}`);
      }
      if (parts.length) return parts.join('; ');
    }
  }
  return fallback;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function loadFacturamaConfigFromEnv(): FacturamaClientConfig {
  const user = Deno.env.get('FACTURAMA_USER')?.trim() ?? '';
  const password = Deno.env.get('FACTURAMA_PASSWORD') ?? '';
  const baseUrl = (Deno.env.get('FACTURAMA_API_BASE')?.trim() || 'https://api.facturama.mx').replace(
    /\/$/,
    ''
  );
  if (!user || !password) {
    throw new Error('Faltan FACTURAMA_USER o FACTURAMA_PASSWORD en secrets de Supabase');
  }
  return { baseUrl, user, password };
}

export async function facturamaRequest(
  cfg: FacturamaClientConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown; contentType: string | null }> {
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(cfg.user, cfg.password),
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  const contentType = res.headers.get('content-type');
  const data = await parseBody(res);

  if (!res.ok) {
    throw new FacturamaApiError(
      extractErrorMessage(data, `Error Facturama HTTP ${res.status}`),
      res.status,
      data
    );
  }

  return { status: res.status, data, contentType };
}

/** Descarga binaria/base64 (PDF) o texto (XML). */
export async function facturamaDownload(
  cfg: FacturamaClientConfig,
  format: FacturamaDownloadFormat,
  type: FacturamaCancelType,
  id: string
): Promise<{ contentType: string; body: Uint8Array; text?: string }> {
  const url = `${cfg.baseUrl}/cfdi/${format}/${type}/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: basicAuthHeader(cfg.user, cfg.password),
      Accept: format === 'xml' ? 'application/xml,text/xml,*/*' : 'application/pdf,*/*',
    },
  });

  if (!res.ok) {
    const data = await parseBody(res);
    throw new FacturamaApiError(
      extractErrorMessage(data, `No se pudo descargar ${format} (${res.status})`),
      res.status,
      data
    );
  }

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const buf = new Uint8Array(await res.arrayBuffer());
  if (format === 'xml' || format === 'html') {
    return { contentType, body: buf, text: new TextDecoder('utf-8').decode(buf) };
  }
  return { contentType, body: buf };
}

export async function facturamaCreateCfdi(
  cfg: FacturamaClientConfig,
  payload: unknown
): Promise<unknown> {
  const { data } = await facturamaRequest(cfg, 'POST', '/3/cfdis', payload);
  return data;
}

export async function facturamaCancelCfdi(
  cfg: FacturamaClientConfig,
  id: string,
  opts: { type: FacturamaCancelType; motive: string; uuidReplacement?: string }
): Promise<unknown> {
  const q = new URLSearchParams({
    type: opts.type,
    motive: opts.motive,
  });
  if (opts.uuidReplacement?.trim()) {
    q.set('uuidReplacement', opts.uuidReplacement.trim());
  }
  const { data } = await facturamaRequest(
    cfg,
    'DELETE',
    `/cfdi/${encodeURIComponent(id)}?${q.toString()}`
  );
  return data;
}

export async function facturamaGetCfdiDetail(
  cfg: FacturamaClientConfig,
  type: FacturamaCancelType,
  id: string
): Promise<unknown> {
  const { data } = await facturamaRequest(cfg, 'GET', `/cfdi/${type}/${encodeURIComponent(id)}`);
  return data;
}

/** Ping de cuenta: GET account / fiscal information. */
export async function facturamaAccountStatus(cfg: FacturamaClientConfig): Promise<unknown> {
  const { data } = await facturamaRequest(cfg, 'GET', '/account');
  return data;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
