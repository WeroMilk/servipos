# Runbook de incidentes (Supabase)

Guía rápida para detectar errores recurrentes y priorizar correcciones.

## 1) Errores por tipo (24h)

```sql
select
  coalesce(doc->'meta'->>'errorCode', 'unknown') as error_code,
  count(*) as total
from public.app_events
where created_at >= now() - interval '24 hours'
  and coalesce(doc->>'kind', '') = 'error'
group by 1
order by total desc;
```

## 2) Top operaciones que más fallan (24h)

```sql
select
  coalesce(doc->>'source', 'unknown') as source,
  coalesce(doc->>'title', 'unknown') as operation,
  count(*) as total
from public.app_events
where created_at >= now() - interval '24 hours'
  and coalesce(doc->>'kind', '') = 'error'
group by 1, 2
order by total desc
limit 20;
```

## 3) Usuarios más impactados (24h)

```sql
select
  coalesce(doc->>'actorUserId', 'unknown') as actor_user_id,
  coalesce(doc->>'actorEmail', 'unknown') as actor_email,
  count(*) as total
from public.app_events
where created_at >= now() - interval '24 hours'
  and coalesce(doc->>'kind', '') = 'error'
group by 1, 2
order by total desc
limit 20;
```

## 4) Triage rápido sugerido

1. Si domina `rls`: revisar `profiles.role`, `profiles.sucursal_id` y políticas de tabla afectada.
2. Si domina `auth`: validar sesión vigente, dominios permitidos y expiración de token.
3. Si domina `network`/`timeout`: revisar conectividad de sucursal y latencia al proyecto Supabase.
4. Si domina `validation`: ajustar validaciones de UI antes de enviar request.
