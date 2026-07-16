-- Abonos CxC cobrados en sesión de caja (cuentan en el corte por forma de pago).

create or replace function private.rpc_registrar_abono_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_monto numeric,
  p_forma_pago text,
  p_cliente_id text,
  p_cliente_nombre text,
  p_usuario_id text,
  p_usuario_nombre text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_sess jsonb;
  v_arr jsonb;
  v_item jsonb;
  v_fp text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  if coalesce(p_monto, 0) <= 0 then raise exception 'Indique un monto mayor a cero'; end if;

  v_fp := trim(coalesce(p_forma_pago, ''));
  if v_fp = '' then raise exception 'Indique la forma de pago del abono'; end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if coalesce(v_sess->>'estado', '') <> 'abierta' then raise exception 'La caja no está abierta'; end if;

  v_item := jsonb_build_object(
    'id', replace(gen_random_uuid()::text, '-', ''),
    'monto', round(p_monto::numeric, 2),
    'formaPago', v_fp,
    'clienteId', nullif(trim(coalesce(p_cliente_id, '')), ''),
    'clienteNombre', nullif(trim(coalesce(p_cliente_nombre, '')), ''),
    'createdAt', to_jsonb(v_now),
    'usuarioId', p_usuario_id,
    'usuarioNombre', coalesce(nullif(trim(p_usuario_nombre), ''), 'Usuario')
  );

  v_arr := coalesce(v_sess->'abonosCobros', '[]'::jsonb) || jsonb_build_array(v_item);

  update public.caja_sesiones
  set doc = v_sess || jsonb_build_object(
      'abonosCobros', v_arr,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sesion_id;
end;
$$;

create or replace function public.rpc_registrar_abono_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_monto numeric,
  p_forma_pago text,
  p_cliente_id text,
  p_cliente_nombre text,
  p_usuario_id text,
  p_usuario_nombre text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_registrar_abono_caja(
    p_sucursal_id,
    p_sesion_id,
    p_monto,
    p_forma_pago,
    p_cliente_id,
    p_cliente_nombre,
    p_usuario_id,
    p_usuario_nombre
  );
$$;

revoke all on function public.rpc_registrar_abono_caja(text, text, numeric, text, text, text, text, text)
  from PUBLIC, anon;
grant execute on function public.rpc_registrar_abono_caja(text, text, numeric, text, text, text, text, text)
  to authenticated, service_role;
