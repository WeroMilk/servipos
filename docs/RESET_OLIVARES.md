# Vaciar datos de prueba (sucursal Olivares) en Supabase

Antes usaba scripts contra **Firestore**; el catálogo vive ahora en **Postgres** (`public.products`, etc.).

## Opción A: SQL Editor (recomendado)

En Supabase → **SQL Editor**, con cuidado (irreversible), borre filas por `sucursal_id`, por ejemplo:

```sql
-- Sustituya 'olivares' por el id real de la tienda.
delete from public.products where sucursal_id = 'olivares';
delete from public.sales where sucursal_id = 'olivares';
-- …otras tablas con sucursal_id según necesite
```

Respete el orden de claves foráneas (hijos antes que padres si aplica). Para un reset completo de una sucursal puede usar las utilidades en la app (admin) o borrar en el orden inverso a las FK del esquema en `supabase/migrations/`.

## Opción B: Table Editor

Elimine o edite filas manualmente en **Table Editor** filtrando por `sucursal_id`.

## Reimportar catálogo

Tras vaciar, puede volver a cargar inventario + lista de precios con:

`npm run import:olivares-to-supabase -- --dir="..." --rtf="..." --sucursal=olivares`

(con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno).

## Nota

No commitee claves `service_role`; úselas solo en su máquina o CI seguro.
