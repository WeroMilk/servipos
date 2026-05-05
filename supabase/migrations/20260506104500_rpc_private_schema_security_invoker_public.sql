-- Advisor 0029: evita SECURITY DEFINER expuesto en schema `public` para sesiones JWT.
-- - Helpers SQL sólo consultan datos permitidos por RLS → SECURITY INVOKER en public.
-- - Lógica privilegiada de RPC permanece SECURITY DEFINER en `private` (no aparece en
--   `[api]` config.toml schemas); `public.rpc_*` quedan como delegados SECURITY INVOKER.

create schema if not exists private;

revoke all on schema private from PUBLIC;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers (antes SECURITY DEFINER; con RLS basta INVOKER sin recursión en policies)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security invoker
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

create or replace function public.user_sucursal_id()
returns text
language sql
security invoker
set search_path = public
stable
as $$
  select p.sucursal_id::text
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.can_access_sucursal(p_uid uuid, p_sid text)
returns boolean
language sql
security invoker
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

revoke all on function public.is_admin() from PUBLIC, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.user_sucursal_id() from PUBLIC, anon;
grant execute on function public.user_sucursal_id() to authenticated, service_role;

revoke all on function public.can_access_sucursal(uuid, text) from PUBLIC, anon;
grant execute on function public.can_access_sucursal(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mover implementación SECURITY DEFINER a `private`
-- ---------------------------------------------------------------------------
alter function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) set schema private;
alter function public.rpc_allocate_invoice_folio(text) set schema private;
alter function public.rpc_cancel_sale(text, text, text, text) set schema private;
alter function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) set schema private;
alter function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) set schema private;
alter function public.rpc_create_sale(text, text, jsonb) set schema private;
alter function public.rpc_increment_folio_actual_only(text) set schema private;
alter function public.rpc_open_caja_session(text, numeric, text, text) set schema private;
alter function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) set schema private;
alter function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) set schema private;
alter function public.rpc_reserve_prueba_factura_folio(text) set schema private;
alter function public.rpc_reserve_prueba_nomina_folio(text) set schema private;
alter function public.rpc_update_pending_open_sale(text, text, jsonb) set schema private;
alter function public.rpc_partial_return_sale(text, text, text, jsonb) set schema private;

revoke all on all functions in schema private from PUBLIC, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Delegados públicos SECURITY INVOKER → mismos nombres para supabase.rpc(...)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_adjust_stock(
  p_sucursal_id text,
  p_product_id text,
  p_cantidad numeric,
  p_tipo text,
  p_motivo text,
  p_referencia text,
  p_usuario_id text,
  p_entrada_meta jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_adjust_stock(
    p_sucursal_id,
    p_product_id,
    p_cantidad,
    p_tipo,
    p_motivo,
    p_referencia,
    p_usuario_id,
    p_entrada_meta
  );
$$;

create or replace function public.rpc_allocate_invoice_folio(p_sucursal_id text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.rpc_allocate_invoice_folio(p_sucursal_id);
$$;

create or replace function public.rpc_cancel_sale(
  p_sucursal_id text,
  p_sale_id text,
  p_motivo text,
  p_cancelacion_motivo text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_cancel_sale(p_sucursal_id, p_sale_id, p_motivo, p_cancelacion_motivo);
$$;

create or replace function public.rpc_close_caja_session(
  p_sucursal_id text,
  p_sesion_id text,
  p_conteo_declarado numeric,
  p_notas text,
  p_closed_by_user_id text,
  p_closed_by_nombre text,
  p_efectivo_esperado numeric,
  p_tickets int,
  p_total_ventas_bruto numeric
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_close_caja_session(
    p_sucursal_id,
    p_sesion_id,
    p_conteo_declarado,
    p_notas,
    p_closed_by_user_id,
    p_closed_by_nombre,
    p_efectivo_esperado,
    p_tickets,
    p_total_ventas_bruto
  );
$$;

create or replace function public.rpc_confirm_incoming_transfer(
  p_dest_sucursal_id text,
  p_transfer_id text,
  p_usuario_id text,
  p_usuario_nombre text,
  p_lines jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_confirm_incoming_transfer(
    p_dest_sucursal_id,
    p_transfer_id,
    p_usuario_id,
    p_usuario_nombre,
    p_lines
  );
$$;

create or replace function public.rpc_create_sale(
  p_sucursal_id text,
  p_date_str text,
  p_sale jsonb
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.rpc_create_sale(p_sucursal_id, p_date_str, p_sale);
$$;

create or replace function public.rpc_increment_folio_actual_only(p_sucursal_id text)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_increment_folio_actual_only(p_sucursal_id);
$$;

create or replace function public.rpc_open_caja_session(
  p_sucursal_id text,
  p_fondo_inicial numeric,
  p_opened_by_user_id text,
  p_opened_by_nombre text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.rpc_open_caja_session(p_sucursal_id, p_fondo_inicial, p_opened_by_user_id, p_opened_by_nombre);
$$;

create or replace function public.rpc_registrar_aporte_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_monto numeric,
  p_notas text,
  p_usuario_id text,
  p_usuario_nombre text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_registrar_aporte_caja(p_sucursal_id, p_sesion_id, p_monto, p_notas, p_usuario_id, p_usuario_nombre);
$$;

create or replace function public.rpc_registrar_retiro_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_monto numeric,
  p_notas text,
  p_usuario_id text,
  p_usuario_nombre text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_registrar_retiro_caja(p_sucursal_id, p_sesion_id, p_monto, p_notas, p_usuario_id, p_usuario_nombre);
$$;

create or replace function public.rpc_reserve_prueba_factura_folio(p_sucursal_id text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.rpc_reserve_prueba_factura_folio(p_sucursal_id);
$$;

create or replace function public.rpc_reserve_prueba_nomina_folio(p_sucursal_id text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.rpc_reserve_prueba_nomina_folio(p_sucursal_id);
$$;

create or replace function public.rpc_update_pending_open_sale(
  p_sucursal_id text,
  p_sale_id text,
  p_patch jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_update_pending_open_sale(p_sucursal_id, p_sale_id, p_patch);
$$;

create or replace function public.rpc_partial_return_sale(
  p_sucursal_id text,
  p_sale_id text,
  p_motivo text,
  p_patch jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_partial_return_sale(p_sucursal_id, p_sale_id, p_motivo, p_patch);
$$;

revoke all on function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) from PUBLIC, anon;
grant execute on function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_allocate_invoice_folio(text) from PUBLIC, anon;
grant execute on function public.rpc_allocate_invoice_folio(text) to authenticated, service_role;

revoke all on function public.rpc_cancel_sale(text, text, text, text) from PUBLIC, anon;
grant execute on function public.rpc_cancel_sale(text, text, text, text) to authenticated, service_role;

revoke all on function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) from PUBLIC, anon;
grant execute on function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) to authenticated, service_role;

revoke all on function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) from PUBLIC, anon;
grant execute on function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_create_sale(text, text, jsonb) from PUBLIC, anon;
grant execute on function public.rpc_create_sale(text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_increment_folio_actual_only(text) from PUBLIC, anon;
grant execute on function public.rpc_increment_folio_actual_only(text) to authenticated, service_role;

revoke all on function public.rpc_open_caja_session(text, numeric, text, text) from PUBLIC, anon;
grant execute on function public.rpc_open_caja_session(text, numeric, text, text) to authenticated, service_role;

revoke all on function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) from PUBLIC, anon;
grant execute on function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) to authenticated, service_role;

revoke all on function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) from PUBLIC, anon;
grant execute on function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) to authenticated, service_role;

revoke all on function public.rpc_reserve_prueba_factura_folio(text) from PUBLIC, anon;
grant execute on function public.rpc_reserve_prueba_factura_folio(text) to authenticated, service_role;

revoke all on function public.rpc_reserve_prueba_nomina_folio(text) from PUBLIC, anon;
grant execute on function public.rpc_reserve_prueba_nomina_folio(text) to authenticated, service_role;

revoke all on function public.rpc_update_pending_open_sale(text, text, jsonb) from PUBLIC, anon;
grant execute on function public.rpc_update_pending_open_sale(text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_partial_return_sale(text, text, text, jsonb) from PUBLIC, anon;
grant execute on function public.rpc_partial_return_sale(text, text, text, jsonb) to authenticated, service_role;
