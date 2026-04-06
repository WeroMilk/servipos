-- Cotizaciones y facturas por sucursal (nube compartida)

create table if not exists public.quotations (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create table if not exists public.invoices (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

alter table public.quotations replica identity full;
alter table public.invoices replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quotations'
  ) then
    alter publication supabase_realtime add table public.quotations;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table public.invoices;
  end if;
end
$$;

alter table public.quotations enable row level security;
alter table public.invoices enable row level security;

drop policy if exists quotations_rw on public.quotations;
create policy quotations_rw on public.quotations for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists invoices_rw on public.invoices;
create policy invoices_rw on public.invoices for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));
