-- Evita error 500 en GET app_events / outgoing_transfers (helpers RLS sin recursión en profiles).
-- Índices para listados frecuentes.

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

drop policy if exists app_ev_select on public.app_events;
create policy app_ev_select on public.app_events for select
  to authenticated using (
    private.is_admin_core()
    or coalesce(doc->>'sucursalId', '') = private.user_sucursal_id_core()
    or coalesce(doc->>'actorUserId', '') = auth.uid()::text
  );

drop policy if exists out_transfers_select on public.outgoing_transfers;
create policy out_transfers_select on public.outgoing_transfers for select
  to authenticated using (
    private.can_access_sucursal_core(auth.uid(), sucursal_id)
    or coalesce(doc->>'destinoSucursalId', '') = private.user_sucursal_id_core()
  );

drop policy if exists out_transfers_update on public.outgoing_transfers;
create policy out_transfers_update on public.outgoing_transfers for update
  to authenticated using (
    private.can_access_sucursal_core(auth.uid(), sucursal_id)
    or coalesce(doc->>'destinoSucursalId', '') = private.user_sucursal_id_core()
  )
  with check (
    private.can_access_sucursal_core(auth.uid(), sucursal_id)
    or coalesce(doc->>'destinoSucursalId', '') = private.user_sucursal_id_core()
  );

create index if not exists app_events_created_at_idx on public.app_events (created_at desc);
create index if not exists outgoing_transfers_estado_idx
  on public.outgoing_transfers (sucursal_id, ((doc->>'estado')));
