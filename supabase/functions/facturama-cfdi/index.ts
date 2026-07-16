import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  corsHeadersForOrigin,
  parseAllowedOrigins,
  isOriginAllowed,
} from '../_shared/corsAllowedOrigins.ts';
import {
  FacturamaApiError,
  bytesToBase64,
  facturamaAccountStatus,
  facturamaCancelCfdi,
  facturamaCreateCfdi,
  facturamaDownload,
  facturamaGetCfdiDetail,
  loadFacturamaConfigFromEnv,
  type FacturamaCancelType,
  type FacturamaDownloadFormat,
} from '../_shared/facturamaClient.ts';

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function normalizeRole(r: unknown): string {
  return String(r ?? '')
    .trim()
    .toLowerCase();
}

/** Admin, gerente o cajero con permisos fiscales personalizados de facturas/nóminas. */
function canUseFacturama(
  role: string | null | undefined,
  customPermissions: unknown,
  useCustom: unknown
): boolean {
  const r = normalizeRole(role);
  if (r === 'admin' || r === 'administrador' || r === 'gerente') return true;

  const fiscalPerms = new Set([
    'facturas:crear',
    'facturas:timbrar',
    'facturas:cancelar',
    'nominas:crear',
    'nominas:timbrar',
  ]);

  if (useCustom === true && Array.isArray(customPermissions)) {
    return customPermissions.some((p) => typeof p === 'string' && fiscalPerms.has(p));
  }

  // Cajero con permisos por defecto del rol no incluye facturas; solo si tiene custom.
  return false;
}

type ActionBody = {
  action?: string;
  payload?: unknown;
  id?: string;
  type?: FacturamaCancelType;
  motive?: string;
  uuidReplacement?: string;
  format?: FacturamaDownloadFormat;
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get('FACTURAMA_CFDI_ALLOWED_ORIGINS') ??
      Deno.env.get('ADMIN_CREATE_USER_ALLOWED_ORIGINS')
  );
  const corsHeaders = corsHeadersForOrigin(origin, allowedOrigins);
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Missing Supabase env' }, 500, corsHeaders);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: 'Invalid session' }, 401, corsHeaders);
  }

  const { data: profile, error: profErr } = await userClient
    .from('profiles')
    .select('role, custom_permissions, use_custom_permissions')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return json({ error: 'Perfil no encontrado' }, 403, corsHeaders);
  }

  if (
    !canUseFacturama(
      profile.role as string | undefined,
      (profile as { custom_permissions?: unknown }).custom_permissions,
      (profile as { use_custom_permissions?: unknown }).use_custom_permissions
    )
  ) {
    return json({ error: 'Sin permiso para operar Facturama' }, 403, corsHeaders);
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return json({ error: 'JSON inválido' }, 400, corsHeaders);
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) {
    return json({ error: 'Falta action' }, 400, corsHeaders);
  }

  let cfg;
  try {
    cfg = loadFacturamaConfigFromEnv();
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Configuración Facturama incompleta' },
      500,
      corsHeaders
    );
  }

  try {
    switch (action) {
      case 'status': {
        const account = await facturamaAccountStatus(cfg);
        return json({ ok: true, account }, 200, corsHeaders);
      }

      case 'create': {
        if (body.payload == null || typeof body.payload !== 'object') {
          return json({ error: 'Falta payload del CFDI' }, 400, corsHeaders);
        }
        const created = await facturamaCreateCfdi(cfg, body.payload);
        return json({ ok: true, cfdi: created }, 200, corsHeaders);
      }

      case 'cancel': {
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const motive = typeof body.motive === 'string' ? body.motive.trim() : '';
        const type: FacturamaCancelType = body.type === 'payroll' ? 'payroll' : 'issued';
        if (!id) return json({ error: 'Falta id del CFDI' }, 400, corsHeaders);
        if (!['01', '02', '03', '04'].includes(motive)) {
          return json({ error: 'Motivo de cancelación inválido (01–04)' }, 400, corsHeaders);
        }
        if (motive === '01' && !body.uuidReplacement?.trim()) {
          return json(
            { error: 'Motivo 01 requiere uuidReplacement del CFDI sustituto' },
            400,
            corsHeaders
          );
        }
        const result = await facturamaCancelCfdi(cfg, id, {
          type,
          motive,
          uuidReplacement: motive === '01' ? body.uuidReplacement : undefined,
        });
        return json({ ok: true, cancel: result }, 200, corsHeaders);
      }

      case 'download': {
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const type: FacturamaCancelType = body.type === 'payroll' ? 'payroll' : 'issued';
        const format: FacturamaDownloadFormat =
          body.format === 'pdf' || body.format === 'html' ? body.format : 'xml';
        if (!id) return json({ error: 'Falta id del CFDI' }, 400, corsHeaders);
        const file = await facturamaDownload(cfg, format, type, id);
        return json(
          {
            ok: true,
            format,
            contentType: file.contentType,
            text: file.text,
            base64: format === 'pdf' ? bytesToBase64(file.body) : undefined,
          },
          200,
          corsHeaders
        );
      }

      case 'detail': {
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const type: FacturamaCancelType = body.type === 'payroll' ? 'payroll' : 'issued';
        if (!id) return json({ error: 'Falta id del CFDI' }, 400, corsHeaders);
        const detail = await facturamaGetCfdiDetail(cfg, type, id);
        return json({ ok: true, detail }, 200, corsHeaders);
      }

      default:
        return json({ error: `Acción desconocida: ${action}` }, 400, corsHeaders);
    }
  } catch (e) {
    if (e instanceof FacturamaApiError) {
      return json(
        {
          error: e.message,
          facturamaStatus: e.status,
          detail: e.body,
        },
        e.status >= 400 && e.status < 600 ? e.status : 502,
        corsHeaders
      );
    }
    console.error('facturama-cfdi', e);
    return json(
      { error: e instanceof Error ? e.message : 'Error interno Facturama' },
      500,
      corsHeaders
    );
  }
});
