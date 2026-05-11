-- Advisor 0028 / 0029: public.rpc_list_login_directory era SECURITY DEFINER y ejecutable por
-- anon/authenticated vía PostgREST. Misma solución que otros RPC: núcleo en private (DEFINER),
-- delegado público (INVOKER). El esquema private no está en [api].schemas → no expone el core.

create or replace function private.rpc_list_login_directory_core()
returns table (
  id uuid,
  name text,
  email text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.name, p.email
  from public.profiles p
  where p.is_active = true
  order by p.name asc;
$$;

comment on function private.rpc_list_login_directory_core() is
  'Núcleo privilegiado del directorio de login (activos solamente); llamado sólo desde public.rpc_list_login_directory.';

revoke all on function private.rpc_list_login_directory_core() from public;
grant execute on function private.rpc_list_login_directory_core() to anon, authenticated, service_role;

-- Invocación indirecta desde el wrapper público (rol anon).
grant usage on schema private to anon;

create or replace function public.rpc_list_login_directory()
returns table (
  id uuid,
  name text,
  email text
)
language sql
security invoker
set search_path = public
stable
as $$
  select * from private.rpc_list_login_directory_core();
$$;

comment on function public.rpc_list_login_directory() is
  'Lista usuarios activos para el selector de login (sin PIN); ejecutable por anon vía RPC público.';

revoke all on function public.rpc_list_login_directory() from public;
grant execute on function public.rpc_list_login_directory() to anon, authenticated;
