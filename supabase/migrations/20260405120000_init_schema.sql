-- SERVIPOS: esquema inicial para migración Firebase → Supabase
-- Ejecutar con Supabase CLI o SQL Editor del proyecto.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tablas base
-- ---------------------------------------------------------------------------

create table if not exists public.sucursales (
  id text primary key,
  nombre text not null default '',
  codigo text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  username text not null default '',
  name text not null default '',
  role text not null default 'cashier',
  is_active boolean not null default true,
  sucursal_id text references public.sucursales (id),
  use_custom_permissions boolean default false,
  custom_permissions jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_sucursal_idx on public.profiles (sucursal_id);

create table if not exists public.products (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create index if not exists products_activo_idx on public.products (sucursal_id, ((doc->>'activo')));

create table if not exists public.sales (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create index if not exists sales_folio_idx on public.sales (sucursal_id, ((doc->>'folio')));
create index if not exists sales_estado_idx on public.sales (sucursal_id, ((doc->>'estado')));

create table if not exists public.inventory_movements (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create index if not exists inv_mov_product_idx on public.inventory_movements (sucursal_id, ((doc->>'productId')));

create table if not exists public.clients (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create table if not exists public.fiscal_config (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  doc_id text not null default 'fiscal',
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, doc_id)
);

create table if not exists public.counters (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  counter_id text not null,
  fecha text,
  seq int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, counter_id)
);

create table if not exists public.caja_estado (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  doc_id text not null default 'current',
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, doc_id)
);

create table if not exists public.caja_sesiones (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create table if not exists public.outgoing_transfers (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create table if not exists public.incoming_transfers (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create table if not exists public.app_events (
  id text primary key,
  doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.checador_registros (
  id text primary key,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Realtime (Supabase replica identity)
-- ---------------------------------------------------------------------------

alter table public.products replica identity full;
alter table public.sales replica identity full;
alter table public.clients replica identity full;
alter table public.sucursales replica identity full;
alter table public.profiles replica identity full;
alter table public.fiscal_config replica identity full;
alter table public.counters replica identity full;
alter table public.caja_estado replica identity full;
alter table public.caja_sesiones replica identity full;
alter table public.inventory_movements replica identity full;
alter table public.outgoing_transfers replica identity full;
alter table public.incoming_transfers replica identity full;
alter table public.app_events replica identity full;
alter table public.checador_registros replica identity full;

alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.sales;
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.sucursales;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.fiscal_config;
alter publication supabase_realtime add table public.counters;
alter publication supabase_realtime add table public.caja_estado;
alter publication supabase_realtime add table public.caja_sesiones;
alter publication supabase_realtime add table public.inventory_movements;
alter publication supabase_realtime add table public.outgoing_transfers;
alter publication supabase_realtime add table public.incoming_transfers;
alter publication supabase_realtime add table public.app_events;
alter publication supabase_realtime add table public.checador_registros;
