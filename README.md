# SERVIPARTZ POS

![SERVIPARTZ POS](https://img.shields.io/badge/SERVIPARTZ-POS-cyan)
![React](https://img.shields.io/badge/React-18-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Vite](https://img.shields.io/badge/Vite-5-purple)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-cyan)
![CFDI 4.0](https://img.shields.io/badge/CFDI-4.0-green)

Sistema de Punto de Venta (POS) completo, profesional y 100% funcional, enfocado en el mercado mexicano. Incluye facturación electrónica CFDI 4.0, gestión de inventario, cotizaciones, y sincronización online/offline.

## Características Principales

### Funcionalidades

- **Punto de Venta (POS)**: Interfaz rápida y eficiente para procesar ventas
- **Facturación Electrónica CFDI 4.0**: Generación de facturas válidas ante el SAT
- **Gestión de Inventario**: Control completo de productos con alertas de stock bajo
- **Cotizaciones**: Crear y convertir cotizaciones en ventas
- **Clientes**: Base de datos de clientes con datos fiscales
- **Reportes y Dashboard**: Visualización de métricas y estadísticas
- **Sincronización Online/Offline**: Funciona sin internet y sincroniza al reconectar
- **Multi-usuario**: Roles de administrador y cajero; el administrador gestiona usuarios en Configuración

### Tecnologías

- **Frontend**: React 18 + TypeScript + Vite
- **Estilos**: Tailwind CSS + shadcn/ui
- **Base de Datos Local**: IndexedDB con Dexie.js
- **Estado Global**: Zustand
- **Gráficas**: Recharts
- **PDF**: jsPDF
- **XML CFDI**: xml-js

## Instalación

### Requisitos Previos

- Node.js 18+
- npm o yarn

### Pasos de Instalación

1. **Clonar o descargar el proyecto**

```bash
cd ruta/al/proyecto
```

2. **Instalar dependencias**

```bash
npm install
```

3. **Iniciar servidor de desarrollo**

```bash
npm run dev
```

4. **Abrir en el navegador**

```
http://localhost:5173
```

### Compilar para Producción

```bash
npm run build
```

Los archivos compilados se encuentran en la carpeta `dist/`.

### Despliegue en Vercel

La app **requiere** las variables `VITE_FIREBASE_*` en tiempo de build. En Vercel debes definirlas en **Settings → Environment Variables** y luego **Redeploy**; el `.env` local no se sube al repositorio.

Guía paso a paso: **[docs/VERCEL.md](docs/VERCEL.md)** (incluye dominio autorizado en Firebase Auth).

## Uso

### Credenciales iniciales

| Usuario | Contraseña | Rol |
|---------|------------|-----|
| zavala | sombra123+ | Administrador |
| gabriel | veneno123+ | Administrador |

En **producción (Firebase)**, el rol y la tienda vienen del documento `users/{UID}` en Firestore. Para que un usuario coincida con otro admin en la misma sucursal, asigne el mismo `sucursalId` y `role: "admin"` (desde **Configuración → Usuarios** o desde la consola de Firebase).

Al cargar la app se migran las cuentas antiguas (`admin` / `cajero`) a las anteriores.

### Configuración Inicial

1. **Iniciar sesión** con las credenciales indicadas
2. **Configurar datos fiscales** en el menú Configuración:
   - RFC del negocio
   - Razón social
   - Régimen fiscal
   - Serie y folio inicial
   - Lugar de expedición (código postal)
3. **Agregar productos** al inventario
4. **Comenzar a vender** en el módulo POS

### Flujo de Venta

1. Ir al módulo **Punto de Venta**
2. Buscar productos por nombre, SKU o código de barras
3. Agregar productos al carrito
4. Seleccionar cliente (opcional)
5. Aplicar descuentos si es necesario
6. Cobrar y seleccionar forma de pago
7. Imprimir o enviar ticket

### Generar Factura

1. Ir al módulo **Facturación**
2. Click en "Nueva Factura"
3. Seleccionar una venta completada
4. Verificar datos del cliente
5. Generar factura
6. Descargar XML y/o PDF

### Sincronización Offline

El sistema detecta automáticamente cuando no hay conexión a internet:

- Las ventas se guardan localmente en IndexedDB
- Los datos se sincronizan automáticamente al recuperar la conexión
- Se muestra un indicador de estado de conexión en la barra lateral

## Estructura del Proyecto

```
src/
├── components/
│   └── ui-custom/          # Componentes personalizados
│       ├── Layout.tsx      # Layout principal con sidebar
│       ├── Sidebar.tsx     # Navegación lateral
│       ├── Header.tsx      # Barra superior
│       ├── ToastContainer.tsx # Notificaciones
│       └── LoginForm.tsx   # Formulario de login
├── db/
│   └── database.ts         # Configuración de IndexedDB con Dexie
├── hooks/
│   ├── useProducts.ts      # Hook de productos
│   ├── useSales.ts         # Hook de ventas
│   ├── useClients.ts       # Hook de clientes
│   ├── useQuotations.ts    # Hook de cotizaciones
│   ├── useInvoices.ts      # Hook de facturas
│   └── useConfig.ts        # Hook de configuración
├── pages/
│   ├── Dashboard.tsx       # Panel principal
│   ├── POS.tsx             # Punto de venta
│   ├── Inventario.tsx      # Gestión de inventario
│   ├── Cotizaciones.tsx    # Cotizaciones
│   ├── Facturas.tsx        # Facturación CFDI
│   ├── Clientes.tsx        # Gestión de clientes
│   └── Configuracion.tsx   # Configuración del sistema
├── stores/
│   ├── authStore.ts        # Estado de autenticación
│   ├── appStore.ts         # Estado de la app (tema, notificaciones)
│   ├── syncStore.ts        # Estado de sincronización
│   └── cartStore.ts        # Estado del carrito de compras
├── types/
│   └── index.ts            # Tipos TypeScript
├── App.tsx                 # Componente principal
└── main.tsx               # Punto de entrada
```

## Configuración Fiscal

### Datos Requeridos

Para generar facturas electrónicas válidas, configure:

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| RFC | Registro Federal de Contribuyentes | XAXX010101000 |
| Razón Social | Nombre fiscal registrado | EMPRESA SA DE CV |
| Régimen Fiscal | Catálogo del SAT | 601 - General de Ley |
| Serie | Serie de facturación | A |
| Folio Actual | Número de siguiente factura | 1 |
| Lugar de Expedición | Código postal | 01000 |

### Catálogos SAT Incluidos

- Régimenes Fiscales
- Usos CFDI
- Formas de Pago
- Claves de Unidad

## Facturación Electrónica CFDI 4.0

### Características

- Generación de XML en formato CFDI 4.0
- Estructura compatible con validación del SAT
- Campos obligatorios según normativa vigente
- Descarga de XML y PDF

### Nota sobre Timbrado

Este sistema genera el XML en formato correcto pero **no incluye timbrado real**. Para timbrar facturas ante el SAT, necesita:

1. **Certificados de Sello Digital (CSD)** del SAT
2. **Contratar un PAC** (Proveedor Autorizado de Certificación):
   - Facturama
   - Finkok
   - SW Sapien
   - Edicom

### Integración con PAC (Futura)

```typescript
// Ejemplo de integración con PAC
const timbrarFactura = async (xml: string) => {
  const response = await fetch('https://api.pac.com.mx/timbrar', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer TU_API_KEY',
      'Content-Type': 'application/xml',
    },
    body: xml,
  });
  return response.json();
};
```

## Sincronización Online/Offline

### Cómo Funciona

1. **Detección de Conexión**: El sistema usa `navigator.onLine` y eventos
2. **Almacenamiento Local**: Todos los datos se guardan en IndexedDB
3. **Cola de Sincronización**: Operaciones pendientes se marcan como 'pending'
4. **Sincronización Automática**: Al recuperar conexión, se sincronizan datos

### Pruebas Offline

1. Abrir DevTools (F12)
2. Ir a la pestaña Network
3. Cambiar "No throttling" a "Offline"
4. Realizar operaciones en el POS
5. Volver a "Online" y verificar sincronización

## Personalización

### Temas

El sistema incluye modo oscuro/claro. Para cambiar:

```typescript
const { toggleTheme } = useAppStore();
toggleTheme();
```

### Colores

Los colores principales se definen en `tailwind.config.js`:

```javascript
colors: {
  cyan: {
    400: '#22d3ee',
    500: '#06b6d4',
  },
  slate: {
    900: '#0f172a',
    950: '#020617',
  },
}
```

## API de Datos

### Productos

```typescript
// Obtener todos los productos
const products = await getProducts();

// Buscar productos
const results = await searchProducts('query');

// Crear producto
const id = await createProduct({
  sku: 'PROD001',
  nombre: 'Producto',
  precioVenta: 100,
  // ...
});
```

### Ventas

```typescript
// Crear venta
const saleId = await createSale({
  clienteId: 'cliente-id',
  productos: [...],
  total: 1000,
  formaPago: '01',
  // ...
});
```

## Solución de Problemas

### Problemas Comunes

| Problema | Solución |
|----------|----------|
| Error al guardar | Verificar que IndexedDB esté habilitada |
| No se genera factura | Verificar configuración fiscal completa |
| Stock no se actualiza | Recargar página o verificar consola |
| Sincronización falla | Revisar conexión a internet |

### Limpieza de Datos

Para limpiar todos los datos locales:

```javascript
// En consola del navegador
indexedDB.deleteDatabase('POSMexicoDB');
location.reload();
```

## Seguridad

- Contraseñas almacenadas en texto plano (demo) - **Cambiar en producción**
- Usar bcrypt o similar para hashing de contraseñas
- Implementar HTTPS en producción
- Validar todos los inputs del usuario
- Sanitizar datos antes de mostrarlos

## Roadmap

### Próximas Funcionalidades

- [ ] Integración con PAC para timbrado real
- [ ] Soporte para múltiples sucursales
- [ ] Reportes avanzados con exportación a Excel
- [ ] App móvil para consultas
- [ ] Integración con pasarelas de pago
- [ ] Soporte para notas de crédito
- [ ] Complementos de pago (CFDI 4.0)

## Contribución

1. Fork el proyecto
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## Licencia

MIT License - Libre para uso personal y comercial.

## Soporte

Para reportar bugs o solicitar funcionalidades:

- Crear un issue en el repositorio
- Contactar al desarrollador

## Créditos

Desarrollado con:

- [React](https://reactjs.org/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Dexie.js](https://dexie.org/)
- [Zustand](https://github.com/pmndrs/zustand)

---

**SERVIPARTZ POS** — Punto de venta con facturación electrónica CFDI 4.0 (México)
