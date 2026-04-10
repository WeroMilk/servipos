-- Permitir existencia negativa al vender / al editar venta abierta (inventario aún no alineado al 100%).

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
