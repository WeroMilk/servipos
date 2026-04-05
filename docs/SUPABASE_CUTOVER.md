# Corte con Firestore y uso solo de Supabase

El POS usa **Supabase** (Postgres + Auth + Realtime). Ya no hay scripts en el repo que escriban en Firestore.

## 1. Variables y despliegue

- Local: copie `.env.example` a `.env` y rellene `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUCURSAL_IDS`, `VITE_DEFAULT_SUCURSAL_ID` (ids deben existir en `public.sucursales`).
- Producción (Vercel u otro host): las mismas variables `VITE_*` en el panel del proveedor. Vea [VERCEL.md](./VERCEL.md).
- Comprobación rápida: `npm run verify:supabase` (lee `.env` y llama a `/auth/v1/health` o `/rest/v1/` con la **anon key** en cabeceras; sin ellas el health suele responder 401).

## 2. Respaldo de datos que solo estaban en Firestore (antes de apagar el proyecto)

Si aún tiene acceso a **Google Firebase Console** y necesita un JSON de archivo:

1. Use la exportación de datos que ofrezca la consola o un export que ya haya generado con herramientas propias.
2. El formato esperado por `npm run etl:firestore-to-supabase` es el descrito en `scripts/etl-firestore-to-supabase.mjs` (objeto con `documents: [{ path, data }]` o NDJSON por línea).

Guarde el archivo **fuera del repositorio** si contiene datos sensibles.

## 3. Lista manual de “todo listo” (auth y POS)

Ejecute en un entorno de prueba:

1. **Login** con usuario real (correo/contraseña).
2. **Perfil**: en Table Editor, `public.profiles` con `role` y `sucursal_id` acordes a RLS.
3. **Inventario**: catálogo carga y cambios visibles (Realtime).
4. **Venta de prueba** y, si aplica, **caja** y **fiscal**.
5. Consola del navegador (F12): sin errores repetidos de RLS, JWT o red.

Si algo falla, revise políticas RLS y que el usuario no esté bloqueado en Auth.

## 4. Edge Function `admin-create-user`

Si crea usuarios desde la pantalla de administración, despliegue la función en Supabase y compruebe logs en el dashboard.

## 5. Proyecto Firebase en la nube

Desactivar o eliminar el proyecto Firebase es **manual** en Google Cloud / Firebase Console, solo cuando haya backup y haya validado Supabase en producción.
