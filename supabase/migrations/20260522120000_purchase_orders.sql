-- Pedidos / facturas de proveedor por sucursal (recepción diferida y parcial)

create table if not exists public.purchase_orders (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

alter table public.purchase_orders replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'purchase_orders'
  ) then
    alter publication supabase_realtime add table public.purchase_orders;
  end if;
end
$$;

alter table public.purchase_orders enable row level security;

drop policy if exists purchase_orders_rw on public.purchase_orders;
create policy purchase_orders_rw on public.purchase_orders for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));
