-- Lectura de perfil para Edge verify-pos-pin-login sin depender de que PostgREST + RLS
-- resuelvan igual en todos los proyectos (service_role suele omitir RLS; esto lo garantiza).

create or replace function public.rpc_verify_pos_pin_profile_row(p_email text)
returns table (
  id uuid,
  pos_pin text,
  is_active boolean,
  email text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    coalesce(nullif(trim(p.pos_pin::text), ''), '')::text as pos_pin,
    p.is_active,
    p.email::text
  from public.profiles p
  where lower(trim(p.email)) = lower(trim(p_email))
  limit 2;
$$;

comment on function public.rpc_verify_pos_pin_profile_row(text) is
  'Solo service_role: filas de perfil por email para verify-pos-pin-login (SECURITY DEFINER).';

revoke all on function public.rpc_verify_pos_pin_profile_row(text) from public;
grant execute on function public.rpc_verify_pos_pin_profile_row(text) to service_role;
