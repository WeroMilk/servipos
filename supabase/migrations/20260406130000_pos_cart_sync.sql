-- POS: borrador de carrito por usuario + sucursal (sincronización entre dispositivos)

create table if not exists public.pos_carts (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, user_id)
);

create index if not exists pos_carts_updated_idx on public.pos_carts (sucursal_id, updated_at desc);

alter table public.pos_carts replica identity full;
alter publication supabase_realtime add table public.pos_carts;
