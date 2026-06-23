-- Directorio de usuarios para Configuración → Usuarios (evita fallos de RLS en SELECT masivo).

create or replace function private.list_profiles_directory_rows_core()
returns setof public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select p.*
  from public.profiles p
  order by p.name asc nulls last, p.email asc;
$$;

revoke all on function private.list_profiles_directory_rows_core() from public;
grant execute on function private.list_profiles_directory_rows_core() to authenticated, service_role;

create or replace function public.rpc_list_profiles_directory()
returns setof public.profiles
language plpgsql
security invoker
set search_path = public
stable
as $$
begin
  if not private.is_admin_core() then
    raise exception 'Solo administradores pueden listar usuarios'
      using errcode = '42501';
  end if;
  return query select * from private.list_profiles_directory_rows_core();
end;
$$;

comment on function public.rpc_list_profiles_directory() is
  'Lista perfiles para pantalla Configuración → Usuarios; requiere rol admin.';

revoke all on function public.rpc_list_profiles_directory() from public;
grant execute on function public.rpc_list_profiles_directory() to authenticated;

-- Asegurar roles admin para cuentas operativas principales.
update public.profiles
set role = 'admin', updated_at = now()
where lower(split_part(coalesce(email, ''), '@', 1)) in ('zavala', 'gabriel')
   or lower(trim(coalesce(username, ''))) in ('zavala', 'gabriel');
