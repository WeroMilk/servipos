# Firestore para SERVIPARTZ POS

## 1. Activar Firestore

1. En [Firebase Console](https://console.firebase.google.com/) abre el proyecto **servipartzpos-26417**.
2. Menú **Build → Firestore Database** → **Crear base de datos**.
3. Modo **producción** (o prueba para desarrollo) y elige una región cercana (ej. `us-central` o `southamerica-east1`).

## 2. Reglas de seguridad

La app ya escribe **productos** y **movimientos de inventario** en `sucursales/{sucursalId}/products` y `.../inventoryMovements` cuando el usuario tiene `sucursalId` en su perfil. Usa reglas que comprueben que ese campo coincide con el `{sucursalId}` de la ruta.

> **Importante:** `get()` a `users/{uid}` cuenta como lectura adicional por evaluación de reglas. Es el patrón habitual para multi-sucursal sin custom claims.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function userProfilePath() {
      return /databases/$(database)/documents/users/$(request.auth.uid);
    }

    function userSucursalMatches(sid) {
      return request.auth != null
        && exists(userProfilePath())
        && get(userProfilePath()).data.sucursalId == sid;
    }

    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false;
    }

    match /sucursales/{sid} {
      allow read: if userSucursalMatches(sid);
      allow write: if false;

      match /products/{pid} {
        allow read, write: if userSucursalMatches(sid);
      }

      match /inventoryMovements/{mid} {
        allow read, write: if userSucursalMatches(sid);
      }

      match /sales/{saleId} {
        allow read, write: if userSucursalMatches(sid);
      }

      match /counters/{cid} {
        allow read, write: if userSucursalMatches(sid);
      }
    }
  }
}
```

- El documento raíz `sucursales/{sid}` queda **solo lectura** desde la app (metadatos los editas en consola o luego con admin).
- Cuando añadas **ventas** u otras colecciones bajo `sucursales/{sid}/…`, replica el mismo patrón `userSucursal() == sid` y ajusta permisos por rol si lo necesitas.

Plan detallado de colecciones y fases: **`docs/FIRESTORE_PLAN.md`**.

## 3. Colección `sucursales` (multi-sucursal)

Crea al menos un documento para enlazar usuarios.

| Campo       | Tipo     | Ejemplo                    |
|------------|----------|----------------------------|
| `nombre`   | string   | `Matriz` o `Sucursal centro` |
| `activa`   | boolean  | `true` (tipo **boolean**, no texto) |
| `notas`    | string   | (opcional)                 |

**Ojo con el campo `nombre`:** debe ser **texto** con el nombre de la sucursal (ej. `Matriz`). Si pusiste el valor `"true"` como string, cámbialo: o bien borra el campo y crea `activa` como **boolean** `true`, o pon `nombre` en string con el nombre real.

- **ID del documento** (lo importante para la app): es el **nombre del documento** en la segunda columna (ej. `Matriz`). Ese mismo texto es el que pondrás en **`sucursalId`** dentro de cada usuario. Si tu documento se llama `Matriz`, entonces `sucursalId` = `Matriz`.

---

## 4. Colección `users` — dónde va y cómo crearla

### La idea clave

- **`users` va al mismo nivel que `sucursales`**, en la raíz de la base de datos (junto a `(default)`).
- **No** la crees con **“+ Iniciar colección”** *dentro* del documento `Matriz` (eso sería una subcolección *dentro* de esa sucursal y **no** es lo que usa la app para el login).
- En la consola, el camino debe verse así: `(default)` → colecciones **`sucursales`** y **`users`** como **hermanas**, no una dentro de la otra.

### Pasos en la consola de Firestore

1. Haz clic en el **icono de casa** o en **`(default)`** arriba a la izquierda (vuelve a la raíz de la base).
2. En la **primera columna**, pulsa **“+ Iniciar colección”**.
3. ID de la colección: escribe **`users`** (minúsculas, como en el código).
4. Te pedirá el **primer documento**:
   - **ID del documento:** aquí **no** pongas `zavala` ni el correo. Ve a **Build → Authentication → Usuarios**, elige al usuario (ej. Zavala), copia el **UID** (cadena larga) y pégalo como ID del documento.
5. Añade campos con **“+ Agregar campo”**:

| Campo         | Tipo        | Ejemplo                          |
|---------------|-------------|----------------------------------|
| `email`       | string      | `zavala@servipartz.com`          |
| `username`    | string      | `zavala`                         |
| `name`        | string      | `Zavala`                         |
| `role`        | string      | **`admin`** o **`cashier`** (en minúsculas; la app distingue permisos solo con este campo) |
| `sucursalId`  | string      | **`Matriz`** (igual al ID del doc en `sucursales`) |
| `isActive`    | boolean     | `true`                           |
| `createdAt`   | timestamp   | “ahora”                          |
| `updatedAt`   | timestamp   | “ahora”                          |

6. Repite: **nuevo documento** en `users` con el **UID** del otro usuario (Gabriel) y sus datos. Para que vea **la misma app que un admin** en una tienda concreta (p. ej. Olivares), use el **mismo** `sucursalId` que el documento de esa tienda en `sucursales` y `role: "admin"`. Si es cajero (`cashier`), verá menos menús y no podrá usar el selector de tienda de la barra.

### Resumen visual de la estructura

```
(default)
├── sucursales
│   └── Matriz          ← documento (ID = Matriz)
│       └── campos: nombre, activa, ...
│
└── users
    ├── <UID-de-zavala> ← documento (ID = UID de Authentication)
    └── <UID-de-gabriel>
```

Si **no** existe el documento en `users` para ese UID, la app **sí** puede iniciar sesión, pero el rol por defecto será **cajero** hasta que exista el perfil en Firestore.

### Admin vs cajero (cómo lo sabe la app)

- **Firebase Authentication** solo guarda correo y contraseña; **no** tiene columna de admin/cajero.
- El rol vive en **Firestore**, en el documento `users/{UID}`, campo **`role`** (tipo string):
  - `admin` → permisos completos (inventario editar/eliminar, facturas, configuración, usuarios, etc.).
  - `cashier` (o cualquier otro texto, o si falta el campo) → se trata como **cajero** (ventas, ver inventario, cotizaciones).
- Ejemplo: Zavala y Gabriel en Olivares: ambos `role: "admin"` y el mismo `sucursalId` (id del doc de Olivares en `sucursales`). Desde la app, en **Configuración → Usuarios**, un admin también puede cambiar rol y tienda sin abrir la consola de Firebase.

## 5. Índices

Todavía no son obligatorios solo para leer `users/{uid}`. Cuando añadas consultas compuestas (ventas por sucursal y fecha), la consola te pedirá crear índices; créalos desde el enlace que aparece en el error.

## 6. Variables `.env` en el proyecto

Las claves web de Firebase van en `.env` (ver `.env.example`). El archivo `.env` no debe subirse a git (está en `.gitignore`).
