-- Supabase linter: search_path mutable, permissive app_events INSERT, RPC EXECUTE público,
-- RLS ausente en pos_carts, y SECURITY DEFINER expuesto vía anon (GRANT IMPLÍCITO a PUBLIC).

-- ---------------------------------------------------------------------------
-- 0011: profile_is_admin sin search_path fijo
-- ---------------------------------------------------------------------------
create or replace function public.profile_is_admin(p_role text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(trim(coalesce(p_role, ''))) in ('admin', 'administrador');
$$;

-- ---------------------------------------------------------------------------
-- 0013: pos_carts en public sin RLS (idempotente)
-- ---------------------------------------------------------------------------
alter table public.pos_carts enable row level security;

drop policy if exists pos_carts_rw on public.pos_carts;
create policy pos_carts_rw on public.pos_carts for all
  to authenticated using (
    user_id = auth.uid()
    and public.can_access_sucursal(auth.uid(), sucursal_id)
  )
  with check (
    user_id = auth.uid()
    and public.can_access_sucursal(auth.uid(), sucursal_id)
  );

-- ---------------------------------------------------------------------------
-- 0024: app_events INSERT sin WITH CHECK (true)
-- ---------------------------------------------------------------------------
drop policy if exists app_ev_insert on public.app_events;

create policy app_ev_insert on public.app_events for insert
  to authenticated with check (
    coalesce(doc->>'actorUserId', '') = auth.uid()::text
    and (
      coalesce(doc->>'sucursalId', '') = ''
      or public.can_access_sucursal(auth.uid(), coalesce(doc->>'sucursalId', ''))
    )
  );

-- ---------------------------------------------------------------------------
-- 0028 / 0029: Quitar EXECUTE sobre PUBLIC para funciones SECURITY DEFINER expuestas
-- (anon deja de invocarlas; authenticated y service_role siguen usando RPC/helpers).
-- handle_new_user: solo disparador auth; ejecuta supabase_auth_admin, no usuarios API.
-- ---------------------------------------------------------------------------
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.user_sucursal_id() from public, anon;
grant execute on function public.user_sucursal_id() to authenticated, service_role;

revoke all on function public.can_access_sucursal(uuid, text) from public, anon;
grant execute on function public.can_access_sucursal(uuid, text) to authenticated, service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end
$$;

revoke all on function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) from public, anon;
grant execute on function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_allocate_invoice_folio(text) from public, anon;
grant execute on function public.rpc_allocate_invoice_folio(text) to authenticated, service_role;

revoke all on function public.rpc_cancel_sale(text, text, text, text) from public, anon;
grant execute on function public.rpc_cancel_sale(text, text, text, text) to authenticated, service_role;

revoke all on function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) from public, anon;
grant execute on function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) to authenticated, service_role;

revoke all on function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) from public, anon;
grant execute on function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_create_sale(text, text, jsonb) from public, anon;
grant execute on function public.rpc_create_sale(text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_increment_folio_actual_only(text) from public, anon;
grant execute on function public.rpc_increment_folio_actual_only(text) to authenticated, service_role;

revoke all on function public.rpc_open_caja_session(text, numeric, text, text) from public, anon;
grant execute on function public.rpc_open_caja_session(text, numeric, text, text) to authenticated, service_role;

revoke all on function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) from public, anon;
grant execute on function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) to authenticated, service_role;

revoke all on function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) from public, anon;
grant execute on function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) to authenticated, service_role;

revoke all on function public.rpc_reserve_prueba_factura_folio(text) from public, anon;
grant execute on function public.rpc_reserve_prueba_factura_folio(text) to authenticated, service_role;

revoke all on function public.rpc_reserve_prueba_nomina_folio(text) from public, anon;
grant execute on function public.rpc_reserve_prueba_nomina_folio(text) to authenticated, service_role;

revoke all on function public.rpc_update_pending_open_sale(text, text, jsonb) from public, anon;
grant execute on function public.rpc_update_pending_open_sale(text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_partial_return_sale(text, text, text, jsonb) from public, anon;
grant execute on function public.rpc_partial_return_sale(text, text, text, jsonb) to authenticated, service_role;
