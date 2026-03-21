# Reiniciar datos de la sucursal Olivares

Objetivo: dejar **solo Olivares** lista para operar desde cero (ventas, inventario de esa tienda, cotizaciones, facturas y clientes asociados a esa sucursal en el dispositivo). **No borra Matriz** ni el catálogo global de usuarios.

Sustituye `OLIVARES_ID` por el **id real** del documento en Firestore (`sucursales/{id}`), por ejemplo `olivares`.

## 1. Firebase (Firestore)

En la consola de Firebase o con un script admin, en la ruta `sucursales/OLIVARES_ID/`:

| Colección / doc | Acción |
|-----------------|--------|
| `sales` | Eliminar **todos** los documentos. |
| `inventoryMovements` | Eliminar **todos** los documentos. |
| `products` | Para cada producto: poner `existencia` (y campos de stock que uses) en **0**, o borrar documentos si prefieres catálogo vacío. |
| `counters/ventasDiario` | Borrar el doc o poner el contador diario en el valor inicial que use tu app (p. ej. `0` / reinicio por campo según implementación). |

**No** elimines el documento `sucursales/OLIVARES_ID` en sí (metadatos de la tienda).

Si usas otra colección por sucursal (eventos, checador, etc.) y quieres cero también ahí, repite el mismo criterio solo bajo `OLIVARES_ID`.

## 2. Navegador / PWA (IndexedDB — Dexie)

Los clientes, cotizaciones, facturas y ventas **locales** llevan `sucursalId`. Para limpiar solo Olivares en un equipo:

1. Abre la app en Chrome → F12 → **Application** → **IndexedDB** → `POSMexicoDB`.
2. En las tablas `clients`, `quotations`, `invoices`, `sales`, borra registros donde `sucursalId === OLIVARES_ID`.
3. Para inventario local de esa tienda: tabla `products` (y movimientos) filtrados por la misma sucursal, según cómo estén guardados en tu build; si todo el stock va por sucursal en Dexie, ajusta o borra solo lo de Olivares.

Alternativa: **Clear site data** para el origen borra **todo** (incluida Matriz en ese dispositivo); úsalo solo si te conviene resetear el dispositivo completo.

## 3. Comprobación

- Entrar con tienda **Olivares**: ventas en 0, sin movimientos recientes, clientes/cotiz/facturas de esa sucursal vacíos.
- Cambiar a **Matriz**: los datos de Matriz deben seguir intactos si solo tocaste rutas bajo `OLIVARES_ID`.
