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

**Desde CSV mergeado** (`data/precios-merged-olivares.csv`, columnas de listas sin IVA):

```bash
set SUPABASE_URL=https://xxxx.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=eyJ...
npm run import:csv-olivares-to-supabase -- --csv=./data/precios-merged-olivares.csv --sucursal=olivares
```

**Desde Excel + RTF** (inventario real por carpeta + lista Crystal): véase [IMPORT_OLIVARES_INVENTARIO.md](./IMPORT_OLIVARES_INVENTARIO.md).

`npm run import:olivares-to-supabase -- --dir="..." --rtf="..." --sucursal=olivares --ultimo-gana`

(con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno).

Migración `20260405120005_olivares_sucursal.sql`: crea/actualiza la fila `sucursales.id = olivares` y asigna perfiles zavala/gabriel a esa tienda con roles admin/cajero.

## Nota

No commitee claves `service_role`; úselas solo en su máquina o CI seguro.
