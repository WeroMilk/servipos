-- Guardrails de seguridad: asegurar RLS en tablas de estado

alter table if exists public.pos_carts enable row level security;
alter table if exists public.sucursal_state_docs enable row level security;
alter table if exists public.user_state_docs enable row level security;

do $$
declare
  missing_rls text[];
begin
  select array_agg(t.tablename order by t.tablename)
  into missing_rls
  from pg_tables t
  join pg_class c on c.relname = t.tablename
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
  where t.schemaname = 'public'
    and t.tablename in ('pos_carts', 'sucursal_state_docs', 'user_state_docs')
    and not c.relrowsecurity;

  if missing_rls is not null then
    raise exception 'RLS deshabilitado en tablas críticas: %', array_to_string(missing_rls, ', ');
  end if;
end
$$;

do $$
declare
  open_policies text[];
begin
  select array_agg(format('%s.%s', p.tablename, p.policyname) order by p.tablename, p.policyname)
  into open_policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('pos_carts', 'sucursal_state_docs', 'user_state_docs')
    and (
      coalesce(p.qual, '') ~* '^\(?true\)?$'
      or coalesce(p.with_check, '') ~* '^\(?true\)?$'
    );

  if open_policies is not null then
    raise exception 'Políticas abiertas detectadas en tablas críticas: %', array_to_string(open_policies, ', ');
  end if;
end
$$;
