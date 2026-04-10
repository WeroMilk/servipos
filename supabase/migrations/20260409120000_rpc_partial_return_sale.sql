-- Devolución parcial: entradas de stock por diferencia de cantidades y actualización del doc de venta.

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
