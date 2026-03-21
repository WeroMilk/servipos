# Reiniciar datos de la sucursal Olivares

Objetivo: dejar **Olivares** en cero operativo (ventas, inventario de esa tienda en Firestore, fichajes ligados a esa sucursal). **No borra Matriz** ni usuarios. El documento `sucursales/olivares` (nombre de la tienda) **no se elimina**.

## Opción A — Script automático (Firestore)

1. En [Firebase Console](https://console.firebase.google.com) → tu proyecto → **Project settings** → **Service accounts** → **Generate new private key**. Guarda el JSON en tu PC (no lo subas a git).

2. En PowerShell (ejemplo):

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\a\tu-service-account.json"
   cd c:\Users\alfon\proyectos\app
   npm run reset:olivares:dry
   ```

   Revisa los conteos. Luego, **sin** `--dry-run`:

   ```powershell
   npm run reset:olivares
   ```

3. Otra sucursal u otro proyecto:

   ```powershell
   node scripts/reset-olivares-firestore.mjs --sucursal=olivares --project=servipartzpos-26417
   ```

El script hace:

| Ruta | Acción |
|------|--------|
| `sucursales/{id}/sales` | `recursiveDelete` (todas las ventas) |
| `sucursales/{id}/inventoryMovements` | idem |
| `sucursales/{id}/products` | idem (catálogo/stock de **esa** tienda) |
| `sucursales/{id}/counters/ventasDiario` | borra el documento del folio diario |
| `checadorRegistros` | borra docs con `sucursalId == {id}` |

**Cliente, cotizaciones y facturas** en esta app viven sobre todo en **IndexedDB** (Dexie). El script **no** limpia el navegador.

## Opción B — Consola Firebase (manual)

Misma tabla que arriba: borrar colecciones bajo `sucursales/OLIVARES_ID/` o usar la CLI:

```bash
firebase firestore:delete "sucursales/olivares/sales" --recursive --project servipartzpos-26417
firebase firestore:delete "sucursales/olivares/inventoryMovements" --recursive --project servipartzpos-26417
firebase firestore:delete "sucursales/olivares/products" --recursive --project servipartzpos-26417
```

(y eliminar `sucursales/olivares/counters/ventasDiario`).

## 2. Navegador / PWA (IndexedDB — obligatorio en cada equipo)

1. Abre la app → F12 → **Application** → **IndexedDB** → `POSMexicoDB`.
2. Borra registros con `sucursalId === "olivares"` (o el id real) en: `clients`, `quotations`, `invoices`, `sales`.
3. Los productos en Dexie suelen ser globales; al vaciar Firestore de Olivares, al sincronizar con tienda Olivares el catálogo volverá desde la nube. Si hace falta, borra también filas huérfanas en `products` / movimientos según tu flujo.

**Clear site data** borra **todo** el origen (incluida Matriz en ese dispositivo).

## 3. Comprobación

- Tienda **Olivares**: sin ventas, sin productos en Firestore hasta que vuelvas a cargar o copies desde Matriz.
- Tienda **Matriz**: intacta si solo tocaste rutas de Olivares.
