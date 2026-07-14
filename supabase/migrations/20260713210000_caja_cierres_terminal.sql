-- Cierre de caja: registrar corte de terminal (total + folio 5 dígitos).
-- Amplía rpc_close_caja_session y agrega rpc_registrar_cierre_terminal.

-- ---------------------------------------------------------------------------
-- rpc_close_caja_session (nueva firma con terminal)
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric);
drop function if exists private.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric);

create or replace function private.rpc_close_caja_session(
  p_sucursal_id text,
  p_sesion_id text,
  p_conteo_declarado numeric,
  p_notas text,
  p_closed_by_user_id text,
  p_closed_by_nombre text,
  p_efectivo_esperado numeric,
  p_tickets int,
  p_total_ventas_bruto numeric,
  p_tarjetas_esperadas numeric,
  p_cierre_terminal_total numeric,
  p_cierre_terminal_folio text
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
  v_est jsonb;
  v_open text;
  v_dif numeric;
  v_folio text;
  v_term_total numeric;
  v_item jsonb;
  v_arr jsonb;
  v_conteo_tarj numeric;
  v_dif_tarj numeric;
  v_tarj_esp numeric;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  v_folio := trim(coalesce(p_cierre_terminal_folio, ''));
  if v_folio !~ '^\d{5}$' then
    raise exception 'Indique el folio del voucher de terminal (5 dígitos)';
  end if;

  v_term_total := round(coalesce(p_cierre_terminal_total, 0)::numeric, 2);
  if v_term_total < 0 then
    raise exception 'Indique el total del corte de terminal';
  end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if coalesce(v_sess->>'estado', '') <> 'abierta' then raise exception 'Esta sesión ya está cerrada'; end if;

  v_dif := round((coalesce(p_conteo_declarado, 0) - coalesce(p_efectivo_esperado, 0))::numeric, 2);

  v_item := jsonb_build_object(
    'id', replace(gen_random_uuid()::text, '-', ''),
    'total', v_term_total,
    'folio', v_folio,
    'createdAt', to_jsonb(v_now),
    'usuarioId', p_closed_by_user_id,
    'usuarioNombre', coalesce(nullif(trim(p_closed_by_nombre), ''), 'Usuario')
  );

  v_arr := coalesce(v_sess->'cierresTerminal', '[]'::jsonb) || jsonb_build_array(v_item);

  select coalesce(sum((elem->>'total')::numeric), 0)
  into v_conteo_tarj
  from jsonb_array_elements(v_arr) as elem;

  v_conteo_tarj := round(v_conteo_tarj::numeric, 2);
  v_tarj_esp := round(coalesce(p_tarjetas_esperadas, 0)::numeric, 2);
  v_dif_tarj := round((v_conteo_tarj - v_tarj_esp)::numeric, 2);

  update public.caja_sesiones
  set doc = v_sess || jsonb_build_object(
      'estado', 'cerrada',
      'closedAt', to_jsonb(v_now),
      'closedByUserId', p_closed_by_user_id,
      'closedByNombre', coalesce(nullif(trim(p_closed_by_nombre), ''), 'Usuario'),
      'conteoDeclarado', p_conteo_declarado,
      'efectivoEsperado', p_efectivo_esperado,
      'diferencia', v_dif,
      'notasCierre', nullif(trim(coalesce(p_notas, '')), ''),
      'ticketsCompletados', p_tickets,
      'totalVentasBruto', p_total_ventas_bruto,
      'cierresTerminal', v_arr,
      'conteoTarjetasDeclarado', v_conteo_tarj,
      'tarjetasEsperadas', v_tarj_esp,
      'diferenciaTarjetas', v_dif_tarj,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sesion_id;

  select e.doc into v_est
  from public.caja_estado e
  where e.sucursal_id = p_sucursal_id and e.doc_id = 'current'
  for update;

  v_open := nullif(trim(coalesce(v_est->>'sesionAbiertaId', '')), '');
  if v_open = p_sesion_id then
    update public.caja_estado
    set doc = jsonb_set(v_est, '{sesionAbiertaId}', 'null'::jsonb, true)
        || jsonb_build_object('updatedAt', to_jsonb(v_now)),
        updated_at = v_now
    where sucursal_id = p_sucursal_id and doc_id = 'current';
  end if;
end;
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
  p_total_ventas_bruto numeric,
  p_tarjetas_esperadas numeric,
  p_cierre_terminal_total numeric,
  p_cierre_terminal_folio text
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
    p_total_ventas_bruto,
    p_tarjetas_esperadas,
    p_cierre_terminal_total,
    p_cierre_terminal_folio
  );
$$;

revoke all on function public.rpc_close_caja_session(
  text, text, numeric, text, text, text, numeric, int, numeric, numeric, numeric, text
) from PUBLIC, anon;
grant execute on function public.rpc_close_caja_session(
  text, text, numeric, text, text, text, numeric, int, numeric, numeric, numeric, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rpc_registrar_cierre_terminal (apéndice en sesión abierta o cerrada)
-- ---------------------------------------------------------------------------
create or replace function private.rpc_registrar_cierre_terminal(
  p_sucursal_id text,
  p_sesion_id text,
  p_total numeric,
  p_folio text,
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
  v_folio text;
  v_total numeric;
  v_item jsonb;
  v_arr jsonb;
  v_conteo_tarj numeric;
  v_dif_tarj numeric;
  v_tarj_esp numeric;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  v_folio := trim(coalesce(p_folio, ''));
  if v_folio !~ '^\d{5}$' then
    raise exception 'Indique el folio del voucher de terminal (5 dígitos)';
  end if;

  v_total := round(coalesce(p_total, 0)::numeric, 2);
  if v_total < 0 then
    raise exception 'Indique el total del corte de terminal';
  end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;

  v_item := jsonb_build_object(
    'id', replace(gen_random_uuid()::text, '-', ''),
    'total', v_total,
    'folio', v_folio,
    'createdAt', to_jsonb(v_now),
    'usuarioId', p_usuario_id,
    'usuarioNombre', coalesce(nullif(trim(p_usuario_nombre), ''), 'Usuario')
  );

  v_arr := coalesce(v_sess->'cierresTerminal', '[]'::jsonb) || jsonb_build_array(v_item);

  select coalesce(sum((elem->>'total')::numeric), 0)
  into v_conteo_tarj
  from jsonb_array_elements(v_arr) as elem;

  v_conteo_tarj := round(v_conteo_tarj::numeric, 2);
  v_tarj_esp := case
    when v_sess ? 'tarjetasEsperadas' and nullif(trim(coalesce(v_sess->>'tarjetasEsperadas', '')), '') is not null
      then round((v_sess->>'tarjetasEsperadas')::numeric, 2)
    else null
  end;
  v_dif_tarj := case when v_tarj_esp is not null then round((v_conteo_tarj - v_tarj_esp)::numeric, 2) else null end;

  update public.caja_sesiones
  set doc = v_sess || jsonb_strip_nulls(jsonb_build_object(
      'cierresTerminal', v_arr,
      'conteoTarjetasDeclarado', v_conteo_tarj,
      'diferenciaTarjetas', v_dif_tarj,
      'updatedAt', to_jsonb(v_now)
    )),
    updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sesion_id;
end;
$$;

create or replace function public.rpc_registrar_cierre_terminal(
  p_sucursal_id text,
  p_sesion_id text,
  p_total numeric,
  p_folio text,
  p_usuario_id text,
  p_usuario_nombre text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_registrar_cierre_terminal(
    p_sucursal_id,
    p_sesion_id,
    p_total,
    p_folio,
    p_usuario_id,
    p_usuario_nombre
  );
$$;

revoke all on function public.rpc_registrar_cierre_terminal(text, text, numeric, text, text, text)
  from PUBLIC, anon;
grant execute on function public.rpc_registrar_cierre_terminal(text, text, numeric, text, text, text)
  to authenticated, service_role;
