-- Incluir código de barras en ítems de traspaso TTS para resolver el producto en destino
-- cuando el SKU está vacío o hay colisiones por SKU.

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
