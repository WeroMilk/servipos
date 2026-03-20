# Plan técnico Firestore — SERVIPARTZ POS

Objetivo: **una sola fuente de verdad en la nube** por sucursal, para que varios dispositivos vean el mismo catálogo, stock y (en fases siguientes) ventas y clientes.

## 1. Principios

- **Multi-tenant por sucursal**: todo el negocio vive bajo `sucursales/{sucursalId}/…`. El valor de `sucursalId` en `users/{uid}` debe coincidir con el **ID del documento** en la colección raíz `sucursales` (ej. `Matriz`).
- **Conmutación en la app**: si el usuario **no** tiene `sucursalId`, la app sigue usando **solo Dexie** (modo local / demo). Si **sí** tiene `sucursalId`, productos y ajustes de stock de esos productos van por **Firestore**.
- **Orden de migración recomendado**
  1. **Productos + movimientos de inventario** (hecho): tiempo real, CRUD, stock transaccional.
  2. **Ventas** (hecho): subcolección `sales`, folio diario atómico (`counters/ventasDiario`), creación/cancelación en transacción con stock, listener `orderBy(createdAt desc)` para listas y detalle por documento.
  3. **Clientes** (en paralelo o después de ventas): colección `clients`.
  4. **Cotizaciones y facturas**: cuando el flujo de ventas esté estable en la nube.

## 2. Modelo de datos (colecciones)

### Raíz (ya existente)

| Colección     | ID documento | Uso |
|---------------|--------------|-----|
| `sucursales`  | ej. `Matriz` | Metadatos de sucursal (`nombre`, `activa`, …) |
| `users`       | UID Auth     | Perfil: `role`, `sucursalId`, … |

### Por sucursal: `sucursales/{sucursalId}/…`

| Subcolección           | ID documento | Contenido principal |
|------------------------|--------------|----------------------|
| `products`             | auto / UUID  | Campos alineados con `Product` (sin `syncStatus` obligatorio en Firestore; la app marca `synced` al mapear). |
| `inventoryMovements`   | auto         | Movimientos de stock. |
| `sales`                | auto         | Venta completa (líneas y pagos embebidos); `createdAt` para orden en tiempo real. |
| `counters`             | ej. `ventasDiario` | `fecha` (YYYYMMDD), `seq` para folios `V-YYYYMMDD-####` sin colisiones entre cajas. |

**Pendiente (fase 3+)**:

| Subcolección | Notas |
|--------------|--------|
| `clients`    | Clientes de la sucursal. |
| `quotations` | Cotizaciones. |
| `invoices`   | CFDI/metadata cuando integres timbrado. |

## 3. Índices

- `products`: consulta actual = `where('activo', '==', true)` sin `orderBy` (orden por nombre en cliente). Si más adelante usas `orderBy('nombre')` compuesto con `activo`, Firestore pedirá un índice compuesto; créalo desde el enlace del error en consola.
- `sales`: `orderBy('createdAt', 'desc')` con `limit` (índice de campo único; si la consola pide índice compuesto, créalo desde el enlace del error).

## 4. Reglas de seguridad

- Obtener `sucursalId` del usuario autenticado: lectura de `users/{request.auth.uid}`.
- Permitir read/write en `sucursales/{sid}/products/*` e `inventoryMovements/*` solo si `user.sucursalId == sid`.
- Afinar después: escritura de productos solo `admin`, ventas `admin` + `cashier`, etc.

Ver fragmento actualizado en `FIRESTORE_SETUP.md`.

## 5. Concurrencia de stock

- Los ajustes que afectan existencia (venta, cancelación, entrada manual) usan **`runTransaction`** sobre el documento del producto para evitar condiciones de carrera entre dos cajas.

## 6. Migración desde Dexie (operativa)

1. Asegura en Firebase que exista `sucursales/{tuId}` y que cada usuario tenga el mismo `sucursalId`.
2. Desde la consola Firestore o un script: exporta productos de prueba y créalos en `sucursales/{sucursalId}/products` con los mismos campos.
3. Opcional: pantalla “Importar desde local” (futuro) que lea Dexie y haga `setDoc` por lote.

## 7. Qué queda en local (hasta la siguiente fase)

- Con `sucursalId`: **ventas** y **stock** viven en Firestore; listas y panel usan listeners.
- **Cotizaciones, facturas (documento), clientes** siguen en Dexie; al facturar, la venta en Firestore se actualiza (`facturaId`, `estado: facturada`).
- Sin `sucursalId`: todo el flujo anterior solo en Dexie (`generateFolio` local, etc.).

## 8. Variables de entorno

Sin flag extra: la conmutación es **`sucursalId` en el perfil Firestore**. Sigue usando `.env` con las claves Firebase (`VITE_*`) como en `.env.example`.

---

## 9. Checklist paso a paso (ponerlo en marcha)

1. **Firebase**: Firestore activo; pega las reglas de **`FIRESTORE_SETUP.md`** (sección 2) en la consola → Reglas → Publicar.
2. **Sucursal**: En la raíz de la base, colección `sucursales` → documento con ID exacto al que usarás (ej. `Matriz`) y campos `nombre`, `activa`, etc.
3. **Usuarios**: En `users/{UID}` (UID = Authentication), campo **`sucursalId`** = mismo string que el ID del doc de sucursal (ej. `Matriz`). Sin esto, la app sigue en modo **solo Dexie**.
4. **Productos**: En consola, bajo `sucursales/Matriz` (o tu id), colección **`products`** → agregar documentos con campos alineados a la app (`sku`, `nombre`, `precioVenta`, `existencia`, `existenciaMinima`, `impuesto`, `unidadMedida`, `activo`, `createdAt`/`updatedAt` como timestamp), o crearlos desde la pantalla **Inventario** ya logueado.
5. **Probar multi-dispositivo**: Dos navegadores con el mismo usuario (o dos usuarios con el mismo `sucursalId`); al editar stock o crear producto en uno, el otro debe actualizar en segundos (listener en tiempo real).
6. **Siguiente fase**: migrar **facturas** y/o **clientes** a Firestore si necesitas el mismo historial fiscal en todos los dispositivos.
