-- Actualizar venta pendiente (stock + doc) — equivalente a updatePendingOpenSaleFirestore

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

    if v_new < 0 then raise exception 'Stock insuficiente para %', v_id; end if;

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
