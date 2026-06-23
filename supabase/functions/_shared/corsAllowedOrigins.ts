export const baseCorsHeaders: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

export function parseAllowedOrigins(envValue: string | undefined): string[] {
  return (envValue ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** localhost y previews/producción en *.vercel.app (mismo criterio que verify-pos-pin-login). */
export function isTrustedDefaultOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true;
    }
    if (u.protocol === 'https:' && u.hostname.endsWith('.vercel.app')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | null, configured: string[]): boolean {
  if (!origin) return false;
  if (configured.includes(origin)) return true;
  for (const entry of configured) {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      try {
        const host = new URL(origin).hostname;
        if (host === entry.slice(2) || host.endsWith(suffix)) return true;
      } catch {
        /* noop */
      }
    }
  }
  return isTrustedDefaultOrigin(origin);
}

export function corsHeadersForOrigin(origin: string | null, configured: string[]): Record<string, string> {
  const allowOrigin = isOriginAllowed(origin, configured) ? origin! : configured[0] ?? 'null';
  return {
    ...baseCorsHeaders,
    'Access-Control-Allow-Origin': allowOrigin,
  };
}

export function resolveAllowOrigin(origin: string | null, configured: string[]): string | null {
  if (!origin) return null;
  return isOriginAllowed(origin, configured) ? origin : null;
}
