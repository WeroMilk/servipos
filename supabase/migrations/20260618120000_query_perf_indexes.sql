-- Índices para consultas frecuentes con filtros en doc JSON (PostgREST doc->>campo).

create index if not exists sales_cliente_idx
  on public.sales (sucursal_id, ((doc->>'clienteId')));

create index if not exists sales_caja_sesion_idx
  on public.sales (sucursal_id, ((doc->>'cajaSesionId')));

create index if not exists sales_updated_at_idx
  on public.sales (sucursal_id, updated_at desc);

create index if not exists checador_quincena_idx
  on public.checador_registros (((doc->>'quincenaId')));
