-- Actualización de perfiles por admin sin recursión RLS (stack depth limit exceeded).

create or replace function private.admin_update_profile_core(p_uid uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_uid is null then
    raise exception 'uid requerido';
  end if;

  update public.profiles p
  set
    name = case when p_patch ? 'name' then coalesce(nullif(trim(p_patch->>'name'), ''), p.name) else p.name end,
    username = case when p_patch ? 'username' then coalesce(nullif(trim(p_patch->>'username'), ''), '') else p.username end,
    email = case when p_patch ? 'email' then coalesce(nullif(trim(p_patch->>'email'), ''), p.email) else p.email end,
    role = case when p_patch ? 'role' then coalesce(nullif(trim(p_patch->>'role'), ''), p.role) else p.role end,
    is_active = case when p_patch ? 'isActive' then (p_patch->>'isActive')::boolean else p.is_active end,
    sucursal_id = case
      when p_patch ? 'sucursalId' then
        case
          when p_patch->>'sucursalId' is null or trim(p_patch->>'sucursalId') = '' then null
          else trim(p_patch->>'sucursalId')
        end
      else p.sucursal_id
    end,
    use_custom_permissions = case
      when p_patch ? 'useCustomPermissions' then (p_patch->>'useCustomPermissions')::boolean
      else p.use_custom_permissions
    end,
    custom_permissions = case
      when p_patch ? 'customPermissions' and (p_patch->'customPermissions') is null then '[]'::jsonb
      when p_patch ? 'customPermissions' then p_patch->'customPermissions'
      when p_patch ? 'useCustomPermissions' and (p_patch->>'useCustomPermissions')::boolean = false then '[]'::jsonb
      else p.custom_permissions
    end,
    updated_at = now()
  where p.id = p_uid;

  if not found then
    raise exception 'Perfil no encontrado' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function private.admin_update_profile_core(uuid, jsonb) from public;
grant execute on function private.admin_update_profile_core(uuid, jsonb) to authenticated, service_role;

create or replace function public.rpc_admin_update_profile(p_uid uuid, p_patch jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not private.is_admin_core() then
    raise exception 'Solo administradores pueden actualizar usuarios'
      using errcode = '42501';
  end if;
  perform private.admin_update_profile_core(p_uid, p_patch);
end;
$$;

comment on function public.rpc_admin_update_profile(uuid, jsonb) is
  'Actualiza un perfil (Configuración → Usuarios); requiere rol admin.';

revoke all on function public.rpc_admin_update_profile(uuid, jsonb) from public;
grant execute on function public.rpc_admin_update_profile(uuid, jsonb) to authenticated;

-- Políticas profiles: helpers private (evita recursión al evaluar is_admin en RLS).
drop policy if exists profiles_own on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_insert_admin on public.profiles;

create policy profiles_own on public.profiles for select
  to authenticated using (id = auth.uid() or private.is_admin_core());

create policy profiles_update_self on public.profiles for update
  to authenticated using (id = auth.uid() or private.is_admin_core())
  with check (id = auth.uid() or private.is_admin_core());

create policy profiles_insert_admin on public.profiles for insert
  to authenticated with check (private.is_admin_core());
