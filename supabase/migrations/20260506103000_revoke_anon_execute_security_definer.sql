-- 0028 anon_security_definer_function_executable: revocar EXECUTE en `anon` de forma explícita.
-- En Supabase `anon` suele tener GRANT directo además de PUBLIC; REVOKE FROM PUBLIC no alcanza.

revoke all on function public.is_admin() from anon;
revoke all on function public.user_sucursal_id() from anon;
revoke all on function public.can_access_sucursal(uuid, text) from anon;

-- Disparador de auth: ni anónimo ni sesión de usuario deben invocar por RPC.
revoke all on function public.handle_new_user() from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end
$$;

revoke all on function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) from anon;
revoke all on function public.rpc_allocate_invoice_folio(text) from anon;
revoke all on function public.rpc_cancel_sale(text, text, text, text) from anon;
revoke all on function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) from anon;
revoke all on function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) from anon;
revoke all on function public.rpc_create_sale(text, text, jsonb) from anon;
revoke all on function public.rpc_increment_folio_actual_only(text) from anon;
revoke all on function public.rpc_open_caja_session(text, numeric, text, text) from anon;
revoke all on function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) from anon;
revoke all on function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) from anon;
revoke all on function public.rpc_reserve_prueba_factura_folio(text) from anon;
revoke all on function public.rpc_reserve_prueba_nomina_folio(text) from anon;
revoke all on function public.rpc_update_pending_open_sale(text, text, jsonb) from anon;
revoke all on function public.rpc_partial_return_sale(text, text, text, jsonb) from anon;
