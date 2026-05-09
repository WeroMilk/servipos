-- PIN de acceso POS (clave numérica en UI) y directorio de login para sesión anónima.
-- Nota: la contraseña real sigue siendo la de Supabase Auth; al cambiar el PIN desde
-- Configuración → Usuarios se invoca la Edge Function admin-set-pos-pin para mantener ambas alineadas.
-- Por defecto los perfiles activos usan PIN 2801; la primera entrada con ese PIN puede alinear Auth
-- vía la Edge Function verify-pos-pin-login si la contraseña de Auth era otra.

alter table public.profiles
  add column if not exists pos_pin text not null default '';

comment on column public.profiles.pos_pin is 'Clave numérica mostrada en el login PIN; debe coincidir con auth.users.encrypted_password vía flujo admin.';

update public.profiles p
set pos_pin = '2801',
    updated_at = now()
where p.is_active = true;

alter table public.profiles alter column pos_pin set default '2801';

create or replace function public.rpc_list_login_directory()
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

comment on function public.rpc_list_login_directory() is 'Lista usuarios activos para el selector de login (sin PIN); ejecutable por anon.';

revoke all on function public.rpc_list_login_directory() from public;
grant execute on function public.rpc_list_login_directory() to anon, authenticated;
