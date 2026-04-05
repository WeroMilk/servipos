-- RPCs: cancelar venta, ajuste stock, fiscal, caja, traspaso, venta pendiente

-- ---------------------------------------------------------------------------
-- Cancelar venta (devuelve stock)
-- ---------------------------------------------------------------------------

create or replace function public.rpc_cancel_sale(
  p_sucursal_id text,
  p_sale_id text,
  p_motivo text,
  p_cancelacion_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_doc jsonb;
  v_est text;
  v_fact text;
  v_item jsonb;
  v_pid text;
  v_qty numeric;
  v_ant numeric;
  v_new numeric;
  v_prod jsonb;
  v_mov text;
  v_notas text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select s.doc into v_doc
  from public.sales s
  where s.sucursal_id = p_sucursal_id and s.id = p_sale_id
  for update;

  if not found then raise exception 'Venta no encontrada'; end if;

  v_est := coalesce(v_doc->>'estado', '');
  if v_est = 'cancelada' then raise exception 'La venta ya está cancelada'; end if;
  v_fact := coalesce(v_doc->>'facturaId', '');
  if v_fact <> '' then raise exception 'No se puede cancelar una venta facturada'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(v_doc->'productos', '[]'::jsonb))
  loop
    v_pid := coalesce(v_item->>'productId', '');
    v_qty := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_pid = '' or v_qty <= 0 then continue; end if;

    select p.doc into v_prod
    from public.products p
    where p.sucursal_id = p_sucursal_id and p.id = v_pid
    for update;

    if not found then raise exception 'Producto no encontrado: %', v_pid; end if;

    v_ant := coalesce((v_prod->>'existencia')::numeric, 0);
    v_new := v_ant + v_qty;

    update public.products
    set doc = jsonb_set(v_prod, '{existencia}', to_jsonb(v_new), true),
        updated_at = v_now
    where sucursal_id = p_sucursal_id and id = v_pid;

    v_mov := replace(gen_random_uuid()::text, '-', '');
    insert into public.inventory_movements (sucursal_id, id, doc, created_at)
    values (
      p_sucursal_id,
      v_mov,
      jsonb_build_object(
        'productId', v_pid,
        'tipo', 'entrada',
        'cantidad', v_qty,
        'cantidadAnterior', v_ant,
        'cantidadNueva', v_new,
        'motivo', 'Cancelación de venta: ' || coalesce(nullif(trim(p_motivo), ''), 'Sin motivo'),
        'referencia', p_sale_id,
        'usuarioId', coalesce(v_doc->>'usuarioId', 'system'),
        'createdAt', to_jsonb(v_now)
      ),
      v_now
    );
  end loop;

  v_notas := coalesce(v_doc->>'notas', '');
  if p_motivo is not null and trim(p_motivo) <> '' then
    v_notas := trim(v_notas || ' | Cancelada: ' || p_motivo);
  end if;

  update public.sales
  set doc = v_doc
      || jsonb_build_object(
        'estado', 'cancelada',
        'cancelacionMotivo', nullif(trim(coalesce(p_cancelacion_motivo, '')), ''),
        'notas', nullif(v_notas, ''),
        'updatedAt', to_jsonb(v_now)
      ),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sale_id;
end;
$$;

grant execute on function public.rpc_cancel_sale(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ajuste de stock (entrada/salida/ajuste)
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prod jsonb;
  v_ant numeric;
  v_new numeric;
  v_mov text;
  v_prov text;
  v_prov_cod text;
  v_pu numeric;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select p.doc into v_prod
  from public.products p
  where p.sucursal_id = p_sucursal_id and p.id = p_product_id
  for update;

  if not found then raise exception 'Producto no encontrado'; end if;

  v_ant := coalesce((v_prod->>'existencia')::numeric, 0);
  if p_tipo = 'entrada' then
    v_new := v_ant + p_cantidad;
  elsif p_tipo = 'salida' then
    v_new := v_ant - p_cantidad;
  else
    v_new := p_cantidad;
  end if;

  update public.products
  set doc = jsonb_set(v_prod, '{existencia}', to_jsonb(v_new), true),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_product_id;

  v_mov := replace(gen_random_uuid()::text, '-', '');
  v_prov := nullif(trim(coalesce(p_entrada_meta->>'proveedor', '')), '');
  v_prov_cod := nullif(trim(coalesce(p_entrada_meta->>'proveedorCodigo', '')), '');
  v_pu := nullif((p_entrada_meta->>'precioUnitarioCompra')::numeric, null);

  insert into public.inventory_movements (sucursal_id, id, doc, created_at)
  values (
    p_sucursal_id,
    v_mov,
    jsonb_strip_nulls(jsonb_build_object(
      'productId', p_product_id,
      'tipo', p_tipo,
      'cantidad', p_cantidad,
      'cantidadAnterior', v_ant,
      'cantidadNueva', v_new,
      'motivo', p_motivo,
      'referencia', p_referencia,
      'proveedor', case when p_tipo = 'entrada' then v_prov end,
      'proveedorCodigo', case when p_tipo = 'entrada' then v_prov_cod end,
      'precioUnitarioCompra', case when p_tipo = 'entrada' then to_jsonb(v_pu) end,
      'usuarioId', coalesce(nullif(trim(p_usuario_id), ''), 'system'),
      'createdAt', to_jsonb(v_now)
    )),
    v_now
  );
end;
$$;

grant execute on function public.rpc_adjust_stock(text, text, numeric, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Fiscal: reservar folio factura
-- ---------------------------------------------------------------------------

create or replace function public.rpc_allocate_invoice_folio(p_sucursal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb;
  v_serie text;
  v_n int;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select f.doc into v_doc
  from public.fiscal_config f
  where f.sucursal_id = p_sucursal_id and f.doc_id = 'fiscal'
  for update;

  if not found then raise exception 'No hay configuración fiscal'; end if;

  v_serie := coalesce(v_doc->>'serie', 'A');
  v_n := coalesce((v_doc->>'folioActual')::int, 1);

  update public.fiscal_config
  set doc = jsonb_set(v_doc, '{folioActual}', to_jsonb(v_n + 1), true)
      || jsonb_build_object('updatedAt', to_jsonb(v_now)),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and doc_id = 'fiscal';

  return jsonb_build_object('serie', v_serie, 'folio', v_n);
end;
$$;

grant execute on function public.rpc_allocate_invoice_folio(text) to authenticated;

create or replace function public.rpc_reserve_prueba_factura_folio(p_sucursal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb;
  v_n int;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select f.doc into v_doc
  from public.fiscal_config f
  where f.sucursal_id = p_sucursal_id and f.doc_id = 'fiscal'
  for update;

  if not found then raise exception 'No hay configuración fiscal'; end if;

  v_n := coalesce((v_doc->>'folioPruebaFactura')::int, 1);

  update public.fiscal_config
  set doc = jsonb_set(v_doc, '{folioPruebaFactura}', to_jsonb(v_n + 1), true)
      || jsonb_build_object('updatedAt', to_jsonb(v_now)),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and doc_id = 'fiscal';

  return jsonb_build_object('serie', 'PRUEBA', 'folio', v_n::text);
end;
$$;

grant execute on function public.rpc_reserve_prueba_factura_folio(text) to authenticated;

create or replace function public.rpc_reserve_prueba_nomina_folio(p_sucursal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb;
  v_n int;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select f.doc into v_doc
  from public.fiscal_config f
  where f.sucursal_id = p_sucursal_id and f.doc_id = 'fiscal'
  for update;

  if not found then raise exception 'No hay configuración fiscal'; end if;

  v_n := coalesce((v_doc->>'folioPruebaNomina')::int, 1);

  update public.fiscal_config
  set doc = jsonb_set(v_doc, '{folioPruebaNomina}', to_jsonb(v_n + 1), true)
      || jsonb_build_object('updatedAt', to_jsonb(v_now)),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and doc_id = 'fiscal';

  return jsonb_build_object('serie', 'PRUEBA-N', 'folio', v_n::text);
end;
$$;

grant execute on function public.rpc_reserve_prueba_nomina_folio(text) to authenticated;

create or replace function public.rpc_increment_folio_actual_only(p_sucursal_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb;
  v_n int;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select f.doc into v_doc
  from public.fiscal_config f
  where f.sucursal_id = p_sucursal_id and f.doc_id = 'fiscal'
  for update;

  if not found then raise exception 'No hay configuración fiscal'; end if;

  v_n := coalesce((v_doc->>'folioActual')::int, 1);

  update public.fiscal_config
  set doc = jsonb_set(v_doc, '{folioActual}', to_jsonb(v_n + 1), true)
      || jsonb_build_object('updatedAt', to_jsonb(v_now)),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and doc_id = 'fiscal';
end;
$$;

grant execute on function public.rpc_increment_folio_actual_only(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Caja: abrir sesión
-- ---------------------------------------------------------------------------

create or replace function public.rpc_open_caja_session(
  p_sucursal_id text,
  p_fondo_inicial numeric,
  p_opened_by_user_id text,
  p_opened_by_nombre text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_est jsonb;
  v_open_id text;
  v_sess jsonb;
  v_new_id text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select e.doc into v_est
  from public.caja_estado e
  where e.sucursal_id = p_sucursal_id and e.doc_id = 'current'
  for update;

  if found then
    v_open_id := nullif(trim(coalesce(v_est->>'sesionAbiertaId', '')), '');
    if v_open_id is not null then
      select s.doc into v_sess
      from public.caja_sesiones s
      where s.sucursal_id = p_sucursal_id and s.id = v_open_id;
      if found and coalesce(v_sess->>'estado', '') = 'abierta' then
        raise exception 'Ya hay una caja abierta';
      end if;
    end if;
  end if;

  v_new_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.caja_sesiones (sucursal_id, id, doc, updated_at)
  values (
    p_sucursal_id,
    v_new_id,
    jsonb_build_object(
      'estado', 'abierta',
      'fondoInicial', greatest(0, coalesce(p_fondo_inicial, 0)),
      'openedAt', to_jsonb(v_now),
      'openedByUserId', p_opened_by_user_id,
      'openedByNombre', coalesce(nullif(trim(p_opened_by_nombre), ''), 'Usuario'),
      'updatedAt', to_jsonb(v_now)
    ),
    v_now
  );

  insert into public.caja_estado (sucursal_id, doc_id, doc, updated_at)
  values (
    p_sucursal_id,
    'current',
    jsonb_build_object('sesionAbiertaId', v_new_id, 'updatedAt', to_jsonb(v_now)),
    v_now
  )
  on conflict (sucursal_id, doc_id) do update
  set doc = jsonb_build_object('sesionAbiertaId', v_new_id, 'updatedAt', to_jsonb(v_now)),
      updated_at = v_now;

  return jsonb_build_object('id', v_new_id);
end;
$$;

grant execute on function public.rpc_open_caja_session(text, numeric, text, text) to authenticated;

-- Cierre: totales calculados en cliente (misma lógica que antes de transacción Firestore)
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
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if coalesce(v_sess->>'estado', '') <> 'abierta' then raise exception 'Esta sesión ya está cerrada'; end if;

  v_dif := round((coalesce(p_conteo_declarado, 0) - coalesce(p_efectivo_esperado, 0))::numeric, 2);

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

grant execute on function public.rpc_close_caja_session(text, text, numeric, text, text, text, numeric, int, numeric) to authenticated;

create or replace function public.rpc_registrar_retiro_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_monto numeric,
  p_notas text,
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
  v_total numeric;
  v_item jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  if coalesce(p_monto, 0) <= 0 then raise exception 'Indique un monto mayor a cero'; end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if coalesce(v_sess->>'estado', '') <> 'abierta' then raise exception 'La caja no está abierta'; end if;

  v_item := jsonb_build_object(
    'id', replace(gen_random_uuid()::text, '-', ''),
    'monto', round(p_monto::numeric, 2),
    'notas', nullif(trim(coalesce(p_notas, '')), ''),
    'createdAt', to_jsonb(v_now),
    'usuarioId', p_usuario_id,
    'usuarioNombre', coalesce(nullif(trim(p_usuario_nombre), ''), 'Usuario')
  );

  v_arr := coalesce(v_sess->'retirosEfectivo', '[]'::jsonb) || jsonb_build_array(v_item);
  v_total := coalesce((v_sess->>'retirosEfectivoTotal')::numeric, 0) + round(p_monto::numeric, 2);

  update public.caja_sesiones
  set doc = v_sess || jsonb_build_object(
      'retirosEfectivo', v_arr,
      'retirosEfectivoTotal', v_total,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sesion_id;
end;
$$;

grant execute on function public.rpc_registrar_retiro_caja(text, text, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmar traspaso entrante (líneas ya resueltas en cliente)
-- ---------------------------------------------------------------------------

create or replace function public.rpc_confirm_incoming_transfer(
  p_dest_sucursal_id text,
  p_transfer_id text,
  p_usuario_id text,
  p_usuario_nombre text,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_inc jsonb;
  v_out jsonb;
  v_origen text;
  v_item jsonb;
  v_pid text;
  v_qty numeric;
  v_prod jsonb;
  v_ant numeric;
  v_new numeric;
  v_mov text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_dest_sucursal_id) then raise exception 'forbidden'; end if;

  select t.doc into v_inc
  from public.incoming_transfers t
  where t.sucursal_id = p_dest_sucursal_id and t.id = p_transfer_id
  for update;

  if not found then raise exception 'Traspaso no encontrado'; end if;
  if coalesce(v_inc->>'estado', '') <> 'pendiente' then raise exception 'Este traspaso ya fue confirmado'; end if;

  v_origen := coalesce(v_inc->>'origenSucursalId', '');
  if v_origen = '' then raise exception 'Datos incompletos'; end if;

  select t.doc into v_out
  from public.outgoing_transfers t
  where t.sucursal_id = v_origen and t.id = p_transfer_id
  for update;

  if not found then raise exception 'Registro de salida no encontrado'; end if;
  if coalesce(v_out->>'estado', '') <> 'pendiente' then raise exception 'El envío ya fue marcado'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_pid := coalesce(v_item->>'destProductId', '');
    v_qty := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_pid = '' or v_qty <= 0 then continue; end if;

    select p.doc into v_prod
    from public.products p
    where p.sucursal_id = p_dest_sucursal_id and p.id = v_pid
    for update;

    if not found then raise exception 'Producto no encontrado'; end if;

    v_ant := coalesce((v_prod->>'existencia')::numeric, 0);
    v_new := v_ant + v_qty;

    update public.products
    set doc = jsonb_set(v_prod, '{existencia}', to_jsonb(v_new), true),
        updated_at = v_now
    where sucursal_id = p_dest_sucursal_id and id = v_pid;

    v_mov := replace(gen_random_uuid()::text, '-', '');
    insert into public.inventory_movements (sucursal_id, id, doc, created_at)
    values (
      p_dest_sucursal_id,
      v_mov,
      jsonb_build_object(
        'productId', v_pid,
        'tipo', 'entrada',
        'cantidad', v_qty,
        'cantidadAnterior', v_ant,
        'cantidadNueva', v_new,
        'motivo', 'Traspaso recibido',
        'referencia', p_transfer_id,
        'usuarioId', p_usuario_id,
        'createdAt', to_jsonb(v_now)
      ),
      v_now
    );
  end loop;

  update public.incoming_transfers
  set doc = v_inc || jsonb_build_object(
      'estado', 'recibida',
      'recibidaAt', to_jsonb(v_now),
      'recibidaPorUserId', p_usuario_id,
      'recibidaPorNombre', p_usuario_nombre,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = p_dest_sucursal_id and id = p_transfer_id;

  update public.outgoing_transfers
  set doc = v_out || jsonb_build_object(
      'estado', 'recibida',
      'recibidaAt', to_jsonb(v_now),
      'recibidaPorUserId', p_usuario_id,
      'recibidaPorNombre', p_usuario_nombre,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = v_origen and id = p_transfer_id;
end;
$$;

grant execute on function public.rpc_confirm_incoming_transfer(text, text, text, text, jsonb) to authenticated;
