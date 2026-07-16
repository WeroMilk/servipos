-- Empleados y recibos de nómina electrónica (doc jsonb por sucursal)

create table if not exists public.employees (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

create table if not exists public.nomina_recibos (
  sucursal_id text not null references public.sucursales (id) on delete cascade,
  id text not null,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sucursal_id, id)
);

alter table public.employees replica identity full;
alter table public.nomina_recibos replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employees'
  ) then
    alter publication supabase_realtime add table public.employees;
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
      and tablename = 'nomina_recibos'
  ) then
    alter publication supabase_realtime add table public.nomina_recibos;
  end if;
end
$$;

alter table public.employees enable row level security;
alter table public.nomina_recibos enable row level security;

drop policy if exists employees_rw on public.employees;
create policy employees_rw on public.employees for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

drop policy if exists nomina_recibos_rw on public.nomina_recibos;
create policy nomina_recibos_rw on public.nomina_recibos for all
  to authenticated using (public.can_access_sucursal(auth.uid(), sucursal_id))
  with check (public.can_access_sucursal(auth.uid(), sucursal_id));

-- Folio oficial de nómina (serieNomina / folioNominaActual)
create or replace function public.rpc_allocate_nomina_folio(p_sucursal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb;
  v_serie text;
  v_n int;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  select f.doc into v_doc
  from public.fiscal_config f
  where f.sucursal_id = p_sucursal_id and f.doc_id = 'fiscal'
  for update;

  if not found then raise exception 'No hay configuración fiscal'; end if;

  v_serie := coalesce(nullif(trim(v_doc->>'serieNomina'), ''), 'N');
  v_n := coalesce((v_doc->>'folioNominaActual')::int, 1);

  update public.fiscal_config
  set doc = jsonb_set(v_doc, '{folioNominaActual}', to_jsonb(v_n + 1), true)
      || jsonb_build_object('updatedAt', to_jsonb(v_now)),
      updated_at = v_now
  where sucursal_id = p_sucursal_id and doc_id = 'fiscal';

  return jsonb_build_object('serie', v_serie, 'folio', v_n);
end;
$$;

revoke all on function public.rpc_allocate_nomina_folio(text) from public, anon;
grant execute on function public.rpc_allocate_nomina_folio(text) to authenticated, service_role;
