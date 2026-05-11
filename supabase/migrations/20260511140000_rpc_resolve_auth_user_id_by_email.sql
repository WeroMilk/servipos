-- Resolución estable de auth.users.id por email desde Edge Functions (service_role).
-- Evita depender del parámetro `filter` en GET /auth/v1/admin/users, que con `@` falla en algunas versiones.

create or replace function public.rpc_resolve_auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.id
  from auth.users u
  where lower(trim(u.email)) = lower(trim(p_email))
  limit 1;
$$;

comment on function public.rpc_resolve_auth_user_id_by_email(text) is
  'Devuelve auth.users.id para un email; sólo service_role (p. ej. verify-pos-pin-login).';

revoke all on function public.rpc_resolve_auth_user_id_by_email(text) from public;
grant execute on function public.rpc_resolve_auth_user_id_by_email(text) to service_role;
