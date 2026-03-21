# Reiniciar sucursal Olivares (ventas, inventario, checador)

Objetivo: dejar **Olivares** en cero en **Firestore**: ventas, inventario (productos + movimientos), **todos** los documentos bajo `counters` de esa tienda, y **fichajes del checador** ligados a Olivares. **No borra Matriz** ni el documento `sucursales/olivares` (nombre de la tienda).

## Script automático (recomendado)

1. Firebase Console → **Project settings** → **Service accounts** → **Generate new private key** (JSON). No lo subas a git.

2. PowerShell:

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\a\tu-service-account.json"
   cd c:\Users\alfon\proyectos\app
   npm run reset:olivares:dry
   npm run reset:olivares
   ```

3. Otra sucursal u otro proyecto:

   ```powershell
   node scripts/reset-olivares-firestore.mjs --sucursal=olivares --project=servipartzpos-26417
   ```

### Qué hace el script en Firestore

| Ruta | Acción |
|------|--------|
| `sucursales/{id}/sales` | Vacía toda la colección (`recursiveDelete`) |
| `sucursales/{id}/inventoryMovements` | Idem |
| `sucursales/{id}/products` | Idem (inventario/catálogo **de esa tienda**) |
| `sucursales/{id}/counters` | Vacía **toda** la subcolección (folio diario y cualquier otro contador) |
| `checadorRegistros` | Borra docs con `sucursalId == {id}` |
| `checadorRegistros` (legado) | Borra docs **sin** `sucursalId` (null/vacío) si `userId` está en `users` con `sucursalId == {id}` |

Si un cajero ya no es de Olivares pero su perfil en `users` sigue con `sucursalId: olivares`, sus fichajes “sin sucursal” también se borrarán en ese paso; conviene tener el perfil al día.

## IndexedDB (cada navegador / PWA)

El script **no** toca datos locales. En Chrome → F12 → **Application** → **IndexedDB** → `POSMexicoDB`, borra filas con `sucursalId === "olivares"` en `sales`, `clients`, `quotations`, `invoices` si quieres cero también en el dispositivo.

## Manual (CLI Firebase)

```bash
firebase firestore:delete "sucursales/olivares/sales" --recursive --project TU_PROJECT_ID
firebase firestore:delete "sucursales/olivares/inventoryMovements" --recursive --project TU_PROJECT_ID
firebase firestore:delete "sucursales/olivares/products" --recursive --project TU_PROJECT_ID
firebase firestore:delete "sucursales/olivares/counters" --recursive --project TU_PROJECT_ID
```

El checador por `sucursalId` y el legado conviene hacerlo con el script o desde la consola con consultas.

## Comprobación

- Tienda **Olivares**: sin ventas, sin productos en Firestore hasta volver a cargar catálogo, checador limpio para esa sucursal.
- **Matriz**: intacta si solo se usó `sucursales/olivares/...` y consultas de checador filtradas a Olivares.
