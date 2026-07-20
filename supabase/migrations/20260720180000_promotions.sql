-- Promociones por sucursal (doc jsonb)

create table if not exists public.promotions (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

alter table public.promotions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'promotions'
  ) then
    alter publication supabase_realtime add table public.promotions;
  end if;
end
$$;

alter table public.promotions enable row level security;

drop policy if exists promotions_rw on public.promotions;
create policy promotions_rw on public.promotions for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));
