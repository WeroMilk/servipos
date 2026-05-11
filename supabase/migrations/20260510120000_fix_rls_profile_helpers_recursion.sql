-- is_admin / user_sucursal_id / can_access_sucursal pasaron a SECURITY INVOKER (migración
-- 20260506104500). Al leer public.profiles quedan sujetas a RLS; profiles_own usa
-- is_admin() → recursión infinita → error 500 en PostgREST (p. ej. GET app_events).
-- Implementación privilegiada en private (SECURITY DEFINER); la API pública sigue siendo
-- SECURITY INVOKER que delega en private.

create or replace function private.is_admin_core()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.profile_is_admin(p.role)
  );
$$;

create or replace function private.user_sucursal_id_core()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select p.sucursal_id::text
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function private.can_access_sucursal_core(p_uid uuid, p_sid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_uid
      and (
        public.profile_is_admin(p.role)
        or (p.sucursal_id is not null and p.sucursal_id::text = p_sid)
      )
  );
$$;

revoke all on function private.is_admin_core() from public;
revoke all on function private.user_sucursal_id_core() from public;
revoke all on function private.can_access_sucursal_core(uuid, text) from public;
grant execute on function private.is_admin_core() to authenticated, service_role;
grant execute on function private.user_sucursal_id_core() to authenticated, service_role;
grant execute on function private.can_access_sucursal_core(uuid, text) to authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql
security invoker
set search_path = public
stable
as $$
  select private.is_admin_core();
$$;

create or replace function public.user_sucursal_id()
returns text
language sql
security invoker
set search_path = public
stable
as $$
  select private.user_sucursal_id_core();
$$;

create or replace function public.can_access_sucursal(p_uid uuid, p_sid text)
returns boolean
language sql
security invoker
set search_path = public
stable
as $$
  select private.can_access_sucursal_core(p_uid, p_sid);
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.user_sucursal_id() from public, anon;
grant execute on function public.user_sucursal_id() to authenticated, service_role;

revoke all on function public.can_access_sucursal(uuid, text) from public, anon;
grant execute on function public.can_access_sucursal(uuid, text) to authenticated, service_role;
