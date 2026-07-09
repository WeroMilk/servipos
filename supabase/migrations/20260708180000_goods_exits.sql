-- Salidas de mercancía (baja de inventario sin venta)

create table if not exists public.goods_exits (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

alter table public.goods_exits replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'goods_exits'
  ) then
    alter publication supabase_realtime add table public.goods_exits;
  end if;
end
$$;

alter table public.goods_exits enable row level security;

drop policy if exists goods_exits_rw on public.goods_exits;
create policy goods_exits_rw on public.goods_exits for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));
