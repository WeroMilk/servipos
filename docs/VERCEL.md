# Desplegar en Vercel (variables de entorno)

Si ves en consola:

`Falta variable de entorno VITE_FIREBASE_API_KEY...`

es porque **en Vercel no están configuradas** las variables que Vite inyecta al compilar. El archivo `.env` solo existe en tu PC; **nunca se sube** (está en `.gitignore`).

## 1. Añadir variables en Vercel

1. Entra a [Vercel Dashboard](https://vercel.com/dashboard) → tu proyecto (ej. **servipos**).
2. **Settings** → **Environment Variables**.
3. Crea **una entrada por variable** (copia los valores desde Firebase Console → ⚙️ *Configuración del proyecto* → *Tus aplicaciones* → app web).

| Nombre (Key) | Valor |
|--------------|--------|
| `VITE_FIREBASE_API_KEY` | *apiKey* |
| `VITE_FIREBASE_AUTH_DOMAIN` | *authDomain* |
| `VITE_FIREBASE_PROJECT_ID` | *projectId* |
| `VITE_FIREBASE_STORAGE_BUCKET` | *storageBucket* |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | *messagingSenderId* |
| `VITE_FIREBASE_APP_ID` | *appId* |
| `VITE_SERVIPARTZ_EMAIL_DOMAIN` | `servipartz.com` (o el dominio de correo que uses para login) |

4. Marca al menos **Production** (y **Preview** si quieres que ramas/PR también funcionen).
5. Guarda.

## 2. Volver a desplegar

- **Deployments** → último deploy → menú **⋯** → **Redeploy** (sin usar caché si quieres forzar).

Sin un redeploy, el bundle sigue compilado **sin** esas variables.

## 3. Firebase Authentication: dominio autorizado

Para que el login funcione en `https://servipos.vercel.app` (o tu dominio):

1. [Firebase Console](https://console.firebase.google.com/) → tu proyecto → **Authentication** → **Settings** → **Authorized domains**.
2. Añade: `servipos.vercel.app` (sin `https://`).
3. Si usas dominio propio, añádelo también.

## 4. Comprobar

Abre la URL del deploy y revisa la consola: no debe aparecer el error de `VITE_FIREBASE_*`.

---

**Nota:** Los nombres deben ser **exactamente** los de la tabla (prefijo `VITE_` incluido). Vite solo expone al cliente las variables que empiezan por `VITE_`.
