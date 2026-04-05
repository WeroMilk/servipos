/**
 * Detects permission denied from Supabase (RLS, PostgREST) or legacy-style error codes.
 */
export function isRemotePermissionDenied(err: unknown): boolean {
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (
      /permission|denied|rls|row-level security|policy|42501|pgrst301|jwt expired|not authorized/i.test(m)
    ) {
      return true;
    }
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const c = String((err as { code?: string }).code ?? '');
    if (c === 'permission-denied' || c === '42501') return true;
  }
  return false;
}

export const SUPABASE_PERMISSION_HINT =
  'Compruebe en Supabase el perfil (role admin o sucursal_id de la tienda) y las políticas RLS del proyecto.';
