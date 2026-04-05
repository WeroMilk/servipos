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
