-- Productos marcados como servicio (`doc.esServicio`) o categoría SERVICIOS:
-- no mueven existencias ni generan movimientos en ventas, cancelaciones, ajustes ni traspasos recibidos.

create or replace function public.product_doc_es_servicio(doc jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select lower(trim(coalesce(doc->>'esServicio', ''))) in ('true', '1', 't', 'yes')
    or upper(trim(coalesce(doc->>'categoria', ''))) = 'SERVICIOS';
$$;

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

  if public.product_doc_es_servicio(v_prod) then
    return;
  end if;

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

    if public.product_doc_es_servicio(v_prod) then
      continue;
    end if;

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

create or replace function public.rpc_create_sale(
  p_sucursal_id text,
  p_date_str text,
  p_sale jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sale_id text;
  v_now timestamptz := now();
  v_seq int := 1;
  v_cur_fecha text;
  v_cur_seq int;
  v_folio text;
  v_item jsonb;
  v_pid text;
  v_qty numeric;
  v_ant numeric;
  v_new numeric;
  v_prod jsonb;
  v_is_tts boolean;
  v_dest text;
  v_mov text;
  v_transfer_items jsonb := '[]'::jsonb;
  v_final_doc jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  v_sale_id := replace(gen_random_uuid()::text, '-', '');

  select c.fecha, c.seq into v_cur_fecha, v_cur_seq
  from public.counters c
  where c.sucursal_id = p_sucursal_id and c.counter_id = 'ventasDiario'
  for update;

  if not found then
    v_seq := 1;
    insert into public.counters (sucursal_id, counter_id, fecha, seq, updated_at)
    values (p_sucursal_id, 'ventasDiario', p_date_str, v_seq, v_now);
  else
    if v_cur_fecha is distinct from p_date_str then
      v_seq := 1;
    else
      v_seq := coalesce(v_cur_seq, 0) + 1;
    end if;
    update public.counters
    set fecha = p_date_str, seq = v_seq, updated_at = v_now
    where sucursal_id = p_sucursal_id and counter_id = 'ventasDiario';
  end if;

  v_folio := 'V-' || p_date_str || '-' || lpad(v_seq::text, 4, '0');

  v_is_tts := coalesce(p_sale->>'formaPago', '') = 'TTS'
    and length(trim(coalesce(p_sale->>'transferenciaSucursalDestinoId', ''))) > 0;

  for v_item in select * from jsonb_array_elements(coalesce(p_sale->'productos', '[]'::jsonb))
  loop
    v_pid := coalesce(v_item->>'productId', '');
    v_qty := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_pid = '' or v_qty <= 0 then continue; end if;

    select p.doc into v_prod
    from public.products p
    where p.sucursal_id = p_sucursal_id and p.id = v_pid
    for update;

    if not found then raise exception 'Producto no encontrado: %', v_pid; end if;

    if public.product_doc_es_servicio(v_prod) then
      continue;
    end if;

    v_ant := coalesce((v_prod->>'existencia')::numeric, 0);
    v_new := v_ant - v_qty;

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
        'tipo', 'salida',
        'cantidad', v_qty,
        'cantidadAnterior', v_ant,
        'cantidadNueva', v_new,
        'motivo', case when v_is_tts then 'Traspaso a tienda (salida)' else 'Venta' end,
        'referencia', v_sale_id,
        'usuarioId', coalesce(p_sale->>'usuarioId', 'system'),
        'createdAt', to_jsonb(v_now)
      ),
      v_now
    );

    if v_is_tts then
      v_transfer_items := v_transfer_items || jsonb_build_array(
        jsonb_build_object(
          'productIdOrigen', v_pid,
          'sku', coalesce(v_prod->>'sku', ''),
          'codigoBarras', coalesce(v_prod->>'codigoBarras', ''),
          'nombre', coalesce(v_prod->>'nombre', ''),
          'cantidad', v_qty
        )
      );
    end if;
  end loop;

  if v_is_tts and jsonb_array_length(v_transfer_items) > 0 then
    v_dest := trim(coalesce(p_sale->>'transferenciaSucursalDestinoId', ''));
    insert into public.incoming_transfers (sucursal_id, id, doc, updated_at)
    values (
      v_dest,
      v_sale_id,
      jsonb_build_object(
        'estado', 'pendiente',
        'origenSucursalId', p_sucursal_id,
        'origenSaleId', v_sale_id,
        'origenFolio', v_folio,
        'items', v_transfer_items,
        'usuarioNombre', nullif(trim(coalesce(p_sale->>'usuarioNombre', '')), ''),
        'createdAt', to_jsonb(v_now),
        'updatedAt', to_jsonb(v_now)
      ),
      v_now
    );
    insert into public.outgoing_transfers (sucursal_id, id, doc, updated_at)
    values (
      p_sucursal_id,
      v_sale_id,
      jsonb_build_object(
        'estado', 'pendiente',
        'destinoSucursalId', v_dest,
        'saleId', v_sale_id,
        'folio', v_folio,
        'items', v_transfer_items,
        'createdAt', to_jsonb(v_now),
        'updatedAt', to_jsonb(v_now)
      ),
      v_now
    );
  end if;

  v_final_doc := p_sale || jsonb_build_object(
    'folio', v_folio,
    'createdAt', to_jsonb(v_now),
    'updatedAt', to_jsonb(v_now)
  );

  insert into public.sales (sucursal_id, id, doc, updated_at)
  values (p_sucursal_id, v_sale_id, v_final_doc, v_now);

  return jsonb_build_object('id', v_sale_id, 'folio', v_folio);
end;
$$;

grant execute on function public.rpc_create_sale(text, text, jsonb) to authenticated;

create or replace function public.rpc_update_pending_open_sale(
  p_sucursal_id text,
  p_sale_id text,
  p_patch jsonb
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
  v_old jsonb;
  v_pid text;
  v_delta numeric;
  v_ant numeric;
  v_new numeric;
  v_prod jsonb;
  v_mov text;
  v_old_qty numeric;
  v_new_qty numeric;
  v_old_line jsonb;
  v_new_line jsonb;
  v_ids text[] := array[]::text[];
  v_id text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select s.doc into v_old
  from public.sales s
  where s.sucursal_id = p_sucursal_id and s.id = p_sale_id
  for update;

  if not found then raise exception 'Venta no encontrada'; end if;
  if coalesce(v_old->>'estado', '') <> 'pendiente' then raise exception 'Solo se pueden editar ventas abiertas'; end if;
  if coalesce(v_old->>'facturaId', '') <> '' then raise exception 'No se puede editar una venta ya vinculada a factura'; end if;

  select coalesce(array_agg(distinct x), array[]::text[]) into v_ids
  from (
    select coalesce(j->>'productId', '') as x
    from jsonb_array_elements(coalesce(v_old->'productos', '[]'::jsonb)) j
    where coalesce(j->>'productId', '') <> ''
    union
    select coalesce(j->>'productId', '')
    from jsonb_array_elements(coalesce(p_patch->'productos', '[]'::jsonb)) j
    where coalesce(j->>'productId', '') <> ''
  ) q;

  foreach v_id in array coalesce(v_ids, array[]::text[])
  loop
    v_old_qty := 0;
    for v_old_line in select * from jsonb_array_elements(coalesce(v_old->'productos', '[]'::jsonb))
    loop
      if coalesce(v_old_line->>'productId', '') = v_id then
        v_old_qty := v_old_qty + coalesce((v_old_line->>'cantidad')::numeric, 0);
      end if;
    end loop;

    v_new_qty := 0;
    for v_new_line in select * from jsonb_array_elements(coalesce(p_patch->'productos', '[]'::jsonb))
    loop
      if coalesce(v_new_line->>'productId', '') = v_id then
        v_new_qty := v_new_qty + coalesce((v_new_line->>'cantidad')::numeric, 0);
      end if;
    end loop;

    v_delta := v_new_qty - v_old_qty;
    if v_delta = 0 then continue; end if;

    select p.doc into v_prod
    from public.products p
    where p.sucursal_id = p_sucursal_id and p.id = v_id
    for update;

    if not found then raise exception 'Producto no encontrado: %', v_id; end if;

    if public.product_doc_es_servicio(v_prod) then
      continue;
    end if;

    v_ant := coalesce((v_prod->>'existencia')::numeric, 0);
    if v_delta > 0 then
      v_new := v_ant - v_delta;
    else
      v_new := v_ant + (-v_delta);
    end if;

    update public.products
    set doc = jsonb_set(v_prod, '{existencia}', to_jsonb(v_new), true),
        updated_at = v_now
    where sucursal_id = p_sucursal_id and id = v_id;

    v_mov := replace(gen_random_uuid()::text, '-', '');
    if v_delta > 0 then
      insert into public.inventory_movements (sucursal_id, id, doc, created_at)
      values (
        p_sucursal_id,
        v_mov,
        jsonb_build_object(
          'productId', v_id,
          'tipo', 'salida',
          'cantidad', v_delta,
          'cantidadAnterior', v_ant,
          'cantidadNueva', v_new,
          'motivo', 'Ajuste por edición de venta abierta',
          'referencia', p_sale_id,
          'usuarioId', coalesce(v_old->>'usuarioId', 'system'),
          'createdAt', to_jsonb(v_now)
        ),
        v_now
      );
    else
      insert into public.inventory_movements (sucursal_id, id, doc, created_at)
      values (
        p_sucursal_id,
        v_mov,
        jsonb_build_object(
          'productId', v_id,
          'tipo', 'entrada',
          'cantidad', -v_delta,
          'cantidadAnterior', v_ant,
          'cantidadNueva', v_new,
          'motivo', 'Ajuste por edición de venta abierta',
          'referencia', p_sale_id,
          'usuarioId', coalesce(v_old->>'usuarioId', 'system'),
          'createdAt', to_jsonb(v_now)
        ),
        v_now
      );
    end if;
  end loop;

  v_doc := v_old || p_patch || jsonb_build_object('updatedAt', to_jsonb(v_now));

  update public.sales
  set doc = v_doc,
      updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sale_id;
end;
$$;

grant execute on function public.rpc_update_pending_open_sale(text, text, jsonb) to authenticated;

create or replace function public.rpc_partial_return_sale(
  p_sucursal_id text,
  p_sale_id text,
  p_motivo text,
  p_patch jsonb
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
  v_old_item jsonb;
  v_new_item jsonb;
  v_pid text;
  v_old_qty numeric;
  v_new_qty numeric;
  v_delta numeric;
  v_ant numeric;
  v_new numeric;
  v_prod jsonb;
  v_mov text;
  v_motivo_mov text;
  v_found boolean;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select s.doc into v_doc
  from public.sales s
  where s.sucursal_id = p_sucursal_id and s.id = p_sale_id
  for update;

  if not found then raise exception 'Venta no encontrada'; end if;

  v_est := coalesce(v_doc->>'estado', '');
  if v_est <> 'completada' then raise exception 'Solo aplica a ventas completadas'; end if;
  v_fact := coalesce(v_doc->>'facturaId', '');
  if v_fact <> '' then raise exception 'No se puede devolver mercancía de una venta facturada'; end if;

  if p_patch is null or p_patch->'productos' is null then
    raise exception 'Parche inválido';
  end if;

  for v_new_item in select * from jsonb_array_elements(coalesce(p_patch->'productos', '[]'::jsonb))
  loop
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(v_doc->'productos', '[]'::jsonb)) o
      where coalesce(o->>'id', '') = coalesce(v_new_item->>'id', '')
        and coalesce(o->>'id', '') <> ''
    ) then
      raise exception 'Línea de venta no reconocida en devolución parcial';
    end if;
  end loop;

  v_motivo_mov := 'Devolución parcial: ' || coalesce(nullif(trim(p_motivo), ''), 'Sin motivo');

  for v_old_item in select * from jsonb_array_elements(coalesce(v_doc->'productos', '[]'::jsonb))
  loop
    v_pid := coalesce(v_old_item->>'productId', '');
    v_old_qty := coalesce((v_old_item->>'cantidad')::numeric, 0);
    if v_pid = '' or v_old_qty <= 0 then continue; end if;

    v_new_qty := 0;
    v_found := false;
    for v_new_item in select * from jsonb_array_elements(coalesce(p_patch->'productos', '[]'::jsonb))
    loop
      if coalesce(v_new_item->>'id', '') = coalesce(v_old_item->>'id', '') then
        v_new_qty := coalesce((v_new_item->>'cantidad')::numeric, 0);
        v_found := true;
        exit;
      end if;
    end loop;

    if not v_found then
      v_new_qty := 0;
    end if;

    if v_new_qty > v_old_qty then
      raise exception 'Cantidad devuelta inválida en línea';
    end if;

    v_delta := v_old_qty - v_new_qty;
    if v_delta <= 0 then continue; end if;

    select p.doc into v_prod
    from public.products p
    where p.sucursal_id = p_sucursal_id and p.id = v_pid
    for update;

    if not found then raise exception 'Producto no encontrado: %', v_pid; end if;

    if public.product_doc_es_servicio(v_prod) then
      continue;
    end if;

    v_ant := coalesce((v_prod->>'existencia')::numeric, 0);
    v_new := v_ant + v_delta;

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
        'cantidad', v_delta,
        'cantidadAnterior', v_ant,
        'cantidadNueva', v_new,
        'motivo', v_motivo_mov,
        'referencia', p_sale_id,
        'usuarioId', coalesce(v_doc->>'usuarioId', 'system'),
        'createdAt', to_jsonb(v_now)
      ),
      v_now
    );
  end loop;

  update public.sales
  set doc = v_doc
      || p_patch
      || jsonb_build_object('updatedAt', to_jsonb(v_now)),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sale_id;
end;
$$;

grant execute on function public.rpc_partial_return_sale(text, text, text, jsonb) to authenticated;

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

    if public.product_doc_es_servicio(v_prod) then
      continue;
    end if;

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
