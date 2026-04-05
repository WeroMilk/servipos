-- RLS, helpers y RPC rpc_create_sale

create or replace function public.profile_is_admin(p_role text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(p_role, ''))) in ('admin', 'administrador');
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
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
security definer
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
security definer
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.sucursales enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.clients enable row level security;
alter table public.fiscal_config enable row level security;
alter table public.counters enable row level security;
alter table public.caja_estado enable row level security;
alter table public.caja_sesiones enable row level security;
alter table public.outgoing_transfers enable row level security;
alter table public.incoming_transfers enable row level security;
alter table public.app_events enable row level security;
alter table public.checador_registros enable row level security;

drop policy if exists sucursales_select on public.sucursales;
drop policy if exists sucursales_write on public.sucursales;
create policy sucursales_select on public.sucursales for select
  to authenticated using (true);
create policy sucursales_write on public.sucursales for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_own on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_own on public.profiles for select
  to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update
  to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_insert_admin on public.profiles for insert
  to authenticated with check (public.is_admin());

drop policy if exists products_rw on public.products;
create policy products_rw on public.products for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists sales_rw on public.sales;
create policy sales_rw on public.sales for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists inv_mov_rw on public.inventory_movements;
create policy inv_mov_rw on public.inventory_movements for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists clients_rw on public.clients;
create policy clients_rw on public.clients for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists fiscal_rw on public.fiscal_config;
create policy fiscal_rw on public.fiscal_config for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists counters_rw on public.counters;
create policy counters_rw on public.counters for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists caja_est_rw on public.caja_estado;
create policy caja_est_rw on public.caja_estado for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists caja_ses_rw on public.caja_sesiones;
create policy caja_ses_rw on public.caja_sesiones for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists out_transfers_rw on public.outgoing_transfers;
drop policy if exists out_transfers_select on public.outgoing_transfers;
drop policy if exists out_transfers_write on public.outgoing_transfers;
create policy out_transfers_select on public.outgoing_transfers for select
  to authenticated using (
    public.can_access_sucursal(auth.uid(), sucursal_id)
    or coalesce(doc->>'destinoSucursalId', '') = public.user_sucursal_id()
  );
create policy out_transfers_write on public.outgoing_transfers for insert
  to authenticated with check (public.can_access_sucursal(auth.uid(), sucursal_id));
create policy out_transfers_update on public.outgoing_transfers for update
  to authenticated using (
    public.can_access_sucursal(auth.uid(), sucursal_id)
    or coalesce(doc->>'destinoSucursalId', '') = public.user_sucursal_id()
  )
  with check (
    public.can_access_sucursal(auth.uid(), sucursal_id)
    or coalesce(doc->>'destinoSucursalId', '') = public.user_sucursal_id()
  );

drop policy if exists in_transfers_rw on public.incoming_transfers;
create policy in_transfers_rw on public.incoming_transfers for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists app_ev_select on public.app_events;
drop policy if exists app_ev_insert on public.app_events;
drop policy if exists app_ev_delete on public.app_events;
create policy app_ev_select on public.app_events for select
  to authenticated using (true);
create policy app_ev_insert on public.app_events for insert
  to authenticated with check (true);
create policy app_ev_delete on public.app_events for delete
  to authenticated using (public.is_admin());

drop policy if exists checador_select on public.checador_registros;
drop policy if exists checador_insert on public.checador_registros;
drop policy if exists checador_update on public.checador_registros;
drop policy if exists checador_delete on public.checador_registros;
create policy checador_select on public.checador_registros for select
  to authenticated using (
    public.is_admin()
    or substring(id from 1 for length(auth.uid()::text) + 1) = auth.uid()::text || '_'
  );
create policy checador_insert on public.checador_registros for insert
  to authenticated with check (
    coalesce(doc->>'userId', '') = auth.uid()::text
    and id = (auth.uid()::text || '_' || coalesce(doc->>'dateKey', ''))
  );
create policy checador_update on public.checador_registros for update
  to authenticated using (coalesce(doc->>'userId', '') = auth.uid()::text)
  with check (coalesce(doc->>'userId', '') = auth.uid()::text);
create policy checador_delete on public.checador_registros for delete
  to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Trigger: perfil al registrarse
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(split_part(new.email, '@', 1), ''),
    coalesce(split_part(new.email, '@', 1), ''),
    'cashier',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: crear venta (folio diario + stock + movimientos + traspaso TTS)
-- ---------------------------------------------------------------------------

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
    if v_new < 0 then raise exception 'Stock insuficiente para %', v_pid; end if;

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

grant execute on function public.rpc_create_sale(text, text, jsonb) to authenticated;
