-- Estado de app en nube (por sucursal y por usuario+sucursal)

create table if not exists public.sucursal_state_docs (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  doc_key text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, doc_key)
);

create table if not exists public.user_state_docs (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  doc_key text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, user_id, doc_key)
);

alter table public.sucursal_state_docs replica identity full;
alter table public.user_state_docs replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sucursal_state_docs'
  ) then
    alter publication supabase_realtime add table public.sucursal_state_docs;
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
      and tablename = 'user_state_docs'
  ) then
    alter publication supabase_realtime add table public.user_state_docs;
  end if;
end
$$;

alter table public.sucursal_state_docs enable row level security;
alter table public.user_state_docs enable row level security;

drop policy if exists sucursal_state_docs_rw on public.sucursal_state_docs;
create policy sucursal_state_docs_rw on public.sucursal_state_docs for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists user_state_docs_rw on public.user_state_docs;
create policy user_state_docs_rw on public.user_state_docs for all
  to authenticated using (
    public.can_access_sucursal(auth.uid(), sucursal_id)
    and user_id = auth.uid()
  )
  with check (
    public.can_access_sucursal(auth.uid(), sucursal_id)
    and user_id = auth.uid()
  );
