# Desplegar en Vercel (variables de entorno)

El archivo `.env` solo existe en su PC; **no se sube** a git (está en `.gitignore`). En Vercel debe configurar las mismas variables para que Vite las inyecte al compilar.

## 0. Rutas del SPA (`/inventario`, etc.)

En la raíz del repo hay un `vercel.json` que redirige las rutas a `index.html`. Sin eso, al recargar una URL interna el servidor puede devolver **404**.

## 1. Variables en Vercel

1. [Vercel Dashboard](https://vercel.com/dashboard) → su proyecto.
2. **Settings** → **Environment Variables**.
3. Cree **una entrada por variable** (valores desde Supabase → **Project Settings** → **API**).

| Nombre (Key) | Valor |
|--------------|--------|
| `VITE_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `VITE_SERVIPARTZ_EMAIL_DOMAIN` | `servipartz.com` (o el dominio de correo corto que use) |
| `VITE_SUCURSAL_IDS` | Lista separada por comas, ej. `olivares,principal` |
| `VITE_DEFAULT_SUCURSAL_ID` | Uno de los ids anteriores |

4. Marque al menos **Production** (y **Preview** si desea).
5. Guarde y **vuelva a desplegar** (Deployments → Redeploy); sin redeploy el bundle sigue sin las variables nuevas.

## 2. Supabase Auth: URL autorizada

Para que el login funcione en `https://su-app.vercel.app` (o dominio propio):

1. Supabase Dashboard → **Authentication** → **URL Configuration**.
2. En **Site URL** y **Redirect URLs** incluya el origen del front (p. ej. `https://servipos.vercel.app`).

## 3. Comprobar

- Abra la URL del deploy: no debe fallar por variables `VITE_SUPABASE_*` faltantes.
- Opcional: `npm run verify:supabase` en local con el mismo `.env` que copiará a Vercel.

Los nombres deben coincidir **exactamente** (prefijo `VITE_` incluido). Vite solo expone al cliente variables que empiezan por `VITE_`.

## 4. Hardening de Edge Function (Supabase)

Las funciones `admin-create-user`, `verify-pos-pin-login` y **`list-login-directory`** validan origen con la misma allowlist. Configure en Supabase:

- **Project Settings -> Edge Functions -> Secrets**
- `ADMIN_CREATE_USER_ALLOWED_ORIGINS` con lista CSV de orígenes permitidos.

Ejemplo:

`https://servipos.vercel.app,https://servipos-git-main-weromilks-projects.vercel.app,*.vercel.app`

Si no define esta variable, la función rechazará requests por seguridad.

### Directorio de usuarios en el login (`list-login-directory`)

Si PostgREST devuelve **401** al RPC `rpc_list_login_directory` (clave anon o gateway), la app usa la Edge Function **`list-login-directory`**, que consulta con `service_role` en el servidor.

Despliegue al menos una vez (desde la raíz del repo, con CLI de Supabase autenticado):

`supabase functions deploy list-login-directory`

Sin este deploy, el front intentará la función, recibirá **404** y hará fallback al RPC por REST (que seguirá fallando si el 401 era del proyecto).

## 5. Checklist de release (obligatorio)

1. `npm run verify:supabase`
2. Verificar en Vercel todas las `VITE_*` requeridas
3. Confirmar `Site URL` y `Redirect URLs` en Supabase Auth
4. Confirmar secret `ADMIN_CREATE_USER_ALLOWED_ORIGINS` en Supabase Edge Functions
5. `supabase functions deploy list-login-directory` (listado de usuarios en pantalla de login)
6. Redeploy en Vercel y prueba smoke de login + alta de usuario admin + flujo POS básico
