// ============================================
// TIPOS DEL SISTEMA SERVIPARTZ POS
// ============================================

import type { ClientPriceListId } from '@/lib/clientPriceLists';

// ============================================
// USUARIOS Y AUTENTICACIÓN
// ============================================
export type UserRole = 'admin' | 'gerente' | 'cashier';

export type Permission =
  | 'ventas:ver'
  | 'ventas:crear'
  | 'inventario:ver'
  | 'inventario:crear'
  | 'inventario:editar'
  | 'inventario:eliminar'
  /** Revisión diaria por lotes (misiones); no implica ver todo el inventario. */
  | 'inventario:mision_diaria'
  /** Ajustar existencia desde la pantalla de misiones (diálogo cantidad + comentario). */
  | 'inventario:mision_ajustar_stock'
  | 'cotizaciones:ver'
  | 'cotizaciones:crear'
  | 'facturas:ver'
  | 'facturas:crear'
  | 'reportes:ver'
  | 'configuracion:ver'
  | 'configuracion:editar'
  | 'usuarios:gestionar'
  | 'sucursales:gestionar'
  | 'checador:registrar'
  | 'checador:reporte';

export interface User {
  id: string;
  username: string;
  /** Solo usuarios locales (Dexie). Con Supabase Auth no se usa. */
  password?: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  /** Sucursal asignada; la app filtra datos remotos por este id. */
  sucursalId?: string;
  /**
   * Si es true, solo aplican `customPermissions` (sustituyen la plantilla del rol).
   * Si es false o no existe, se usa la plantilla del rol (admin / gerente / cajero).
   */
  useCustomPermissions?: boolean;
  /** Lista completa de permisos cuando `useCustomPermissions` es true. */
  customPermissions?: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

/** Catálogo de sucursales (tabla `public.sucursales`). */
export interface Sucursal {
  id: string;
  nombre: string;
  /** Código corto opcional (ej. HMO-01). */
  codigo?: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  /** true después del primer evento de sesión Supabase (evita flash al /login). */
  authReady: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  /** Vuelve a leer el perfil en `public.profiles` y actualiza la sesión (p. ej. tras cambiar permisos). */
  refreshUserProfile: () => Promise<void>;
}

/** Un día de asistencia (`public.checador_registros`, id tipo `userId_YYYY-MM-DD`). */
export interface ChecadorDiaRegistro {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  dateKey: string;
  quincenaId: string;
  sucursalId?: string;
  entrada: Date | null;
  salidaComer: Date | null;
  regresoComer: Date | null;
  cierre: Date | null;
}

// ============================================
// CONFIGURACIÓN FISCAL
// ============================================
export interface FiscalConfig {
  id: string;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoUsoCfdi: string;
  serie: string;
  folioActual: number;
  /** Serie y folio para CFDI de nómina (folios autorizados ante el SAT). */
  serieNomina?: string;
  folioNominaActual?: number;
  /**
   * Si es true, las facturas usan serie PRUEBA y folios locales (no avanza `folioActual`).
   * Las vistas impresas de nómina de prueba no avanzan `folioNominaActual`.
   */
  modoPruebaFiscal?: boolean;
  /** Siguiente número para facturas de prueba (solo informativo / secuencia local). */
  folioPruebaFactura?: number;
  /** Siguiente número para impresiones de recibo de nómina de prueba. */
  folioPruebaNomina?: number;
  lugarExpedicion: string; // Código postal
  certificadoCsd?: string;
  llavePrivadaCsd?: string;
  contrasenaCsd?: string;
  // Datos adicionales del negocio
  nombreComercial?: string;
  telefono?: string;
  email?: string;
  direccion?: Direccion;
  updatedAt: Date;
  /**
   * Si es false, las listas por cliente se interpretan sin IVA. Si es true o no existe el campo, por defecto la app
   * trata los precios de lista como con IVA incluido.
   */
  preciosListaIncluyenIva?: boolean;
}

export interface Direccion {
  calle?: string;
  numeroExterior?: string;
  numeroInterior?: string;
  colonia?: string;
  codigoPostal: string;
  ciudad?: string;
  municipio?: string;
  estado?: string;
  pais: string;
}

// ============================================
// PRODUCTOS E INVENTARIO
// ============================================

export interface Product {
  id: string;
  sku: string;
  codigoBarras?: string;
  nombre: string;
  descripcion?: string;
  precioVenta: number;
  precioCompra?: number;
  /** Precio unitario sin IVA por tipo de cliente (opcional); si falta, aplica el % de configuración sobre `precioVenta`. */
  preciosPorListaCliente?: Partial<Record<ClientPriceListId, number>>;
  /**
   * Si es true, los valores en `preciosPorListaCliente` son precio al público **con IVA**.
   * Si es false, sin IVA. Si es undefined, aplica la sucursal (por defecto: con IVA incluido).
   */
  preciosListaIncluyenIva?: boolean;
  impuesto: number; // IVA por defecto 16%
  existencia: number;
  existenciaMinima: number;
  categoria?: string;
  proveedor?: string;
  imagen?: string;
  /** Clave de unidad SAT (c_ClaveUnidad), ej. H87 pieza, MTR metro, CMT centímetro, E48 servicio. */
  unidadMedida: string;
  /** Clave de producto o servicio SAT (8 dígitos), ej. 31171504 — requerida para facturar correctamente. */
  claveProdServ?: string;
  /** Si es true (o categoría SERVICIOS), el POS y los RPC no mueven existencias por ventas ni ajustes manuales en DB (ver `productServicio`). */
  esServicio?: boolean;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
  lastSyncAt?: Date;
}

export type InventoryMovementTipo =
  | 'entrada'
  | 'salida'
  | 'ajuste'
  | 'venta'
  | 'compra'
  | 'producto_alta'
  | 'producto_baja'
  | 'producto_edicion';

export interface InventoryMovement {
  id: string;
  productId: string;
  tipo: InventoryMovementTipo;
  cantidad: number;
  cantidadAnterior: number;
  cantidadNueva: number;
  motivo?: string;
  referencia?: string; // ID de venta, compra, etc.
  /** Proveedor registrado en entradas de stock (compra / abasto). */
  proveedor?: string;
  /** Código de proveedor (lista Configuración, formato CODIGO|Nombre), si aplica. */
  proveedorCodigo?: string;
  /** Precio unitario de compra en esa entrada (sin IVA), si se capturó. */
  precioUnitarioCompra?: number;
  /** Copia al registrar el evento (p. ej. producto dado de baja y ya no está en catálogo activo). */
  nombreRegistro?: string;
  skuRegistro?: string;
  usuarioId: string;
  createdAt: Date;
  syncStatus: SyncStatus;
}

/** Metadatos opcionales al registrar entrada de mercancía (remoto / Dexie). */
export interface StockEntradaMeta {
  proveedor?: string;
  proveedorCodigo?: string;
  precioUnitarioCompra?: number;
}

export interface PurchaseOrder {
  id: string;
  proveedor?: string;
  productos: PurchaseOrderItem[];
  estado: 'pendiente' | 'enviada' | 'recibida' | 'cancelada';
  notas?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseOrderItem {
  productId: string;
  cantidadSolicitada: number;
  cantidadRecibida?: number;
}

/** Entrada en historial de abonos (Cuentas por cobrar); `at` más reciente primero en el arreglo. */
export interface ClientAbonoHistorialEntry {
  at: Date;
  monto: number;
  saldoAnterior: number;
  saldoNuevo: number;
  usuarioNombre?: string;
}

// ============================================
// CLIENTES
// ============================================
export interface Client {
  id: string;
  rfc?: string;
  nombre: string;
  razonSocial?: string;
  codigoPostal?: string;
  regimenFiscal?: string;
  usoCfdi?: string;
  email?: string;
  telefono?: string;
  direccion?: Direccion;
  isMostrador: boolean; // Cliente genérico para ventas de mostrador
  /**
   * Lista de precios por defecto en POS (regular, técnico, mayoreo −, mayoreo +, Cananea).
   * Si no viene definida, se trata como `regular`.
   */
  listaPreciosId?: ClientPriceListId;
  /** Número de tickets de compra completados (ventas) asociados a este cliente. */
  ticketsComprados?: number;
  /**
   * Total de ventas que cuentan para el cliente (excluye canceladas).
   * Puede corregirse al abrir «Ventas del cliente». Si no existe, la UI usa `ticketsComprados`.
   */
  ventasHistorial?: number;
  /**
   * Saldo que el cliente debe a la tienda (ventas PPD con pago parcial o sin pago).
   * Se incrementa al cobrar con adeudo y puede reducirse con abonos en Cuentas por cobrar.
   */
  saldoAdeudado?: number;
  /** Último abono registrado (para reimpresión de comprobante). */
  ultimoAbonoMonto?: number;
  ultimoAbonoAt?: Date;
  ultimoAbonoSaldoAnterior?: number;
  ultimoAbonoSaldoNuevo?: number;
  ultimoAbonoUsuarioNombre?: string;
  /**
   * Abonos registrados en Cuentas por cobrar (más reciente primero).
   * Limitado en servidor/local para no inflar el documento del cliente.
   */
  abonosHistorial?: ClientAbonoHistorialEntry[];
  /** Notas solo para el equipo (no se muestran al cliente ni en CFDI). */
  notasInternas?: string;
  /** Aislamiento por tienda en datos locales (Dexie). */
  sucursalId?: string;
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
}

// ============================================
// VENTAS
// ============================================
export interface Sale {
  id: string;
  folio: string;
  clienteId: string;
  cliente?: Client;
  productos: SaleItem[];
  subtotal: number;
  descuento: number;
  impuestos: number;
  total: number;
  formaPago: FormaPago;
  metodoPago: MetodoPago;
  pagos: Payment[];
  cambio?: number;
  estado: SaleStatus;
  /** Si la venta fue cancelada: devolución en POS o cancelación manual desde panel (admin). */
  cancelacionMotivo?: 'devolucion' | 'panel';
  facturaId?: string;
  notas?: string;
  /** Destino cuando forma de pago es traspaso entre sucursales (admin). */
  transferenciaSucursalDestinoId?: string;
  usuarioId: string;
  /** Nombre del cajero al momento de la venta (ticket / historial). */
  usuarioNombre?: string;
  /** Tienda (`sucursal_id` en `public.sales`); para ticket / reimpresión. */
  sucursalId?: string;
  /** Solo ventas `pendiente`: % desc. global del carrito al guardar (retomar en POS). */
  posResumeGlobalDiscount?: number;
  /** Lista de precios del carrito al guardar venta abierta (`regular`, `tecnico`, …). */
  posResumeListaPrecios?: string;
  /** Sesión de caja (apertura/cierre) en la que se registró la venta; para arqueo. */
  cajaSesionId?: string;
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
  lastSyncAt?: Date;
}

export type CajaSesionEstado = 'abierta' | 'cerrada';

/** Retiro de efectivo del cajón durante una sesión abierta (bolsa / banco). */
export interface CajaRetiroEfectivo {
  id: string;
  monto: number;
  notas?: string;
  createdAt: Date;
  usuarioId: string;
  usuarioNombre: string;
}

/** Ingreso de efectivo a caja durante la sesión (no venta): fondeo, cambio extra, etc. */
export type CajaAporteEfectivo = CajaRetiroEfectivo;

/** Registro de apertura/cierre de caja por sucursal (`public.caja_sesiones`). */
export interface CajaSesion {
  id: string;
  sucursalId?: string;
  estado: CajaSesionEstado;
  fondoInicial: number;
  openedAt: Date;
  openedByUserId: string;
  openedByNombre: string;
  /** Suma de aportes en efectivo registrados en la sesión; aumenta el efectivo esperado en caja. */
  aportesEfectivoTotal?: number;
  aportesEfectivo?: CajaAporteEfectivo[];
  /** Suma de retiros registrados en la sesión; reduce el efectivo esperado en caja. */
  retirosEfectivoTotal?: number;
  retirosEfectivo?: CajaRetiroEfectivo[];
  closedAt?: Date;
  closedByUserId?: string;
  closedByNombre?: string;
  /** Efectivo contado físicamente al cierre. */
  conteoDeclarado?: number;
  /** Fondo + efectivo cobrado − cambio entregado + aportes − retiros (ventas de la sesión completadas). */
  efectivoEsperado?: number;
  /** Declarado − esperado (positivo = sobrante). */
  diferencia?: number;
  notasCierre?: string;
  ticketsCompletados?: number;
  totalVentasBruto?: number;
}

export interface SaleItem {
  id: string;
  productId: string;
  producto?: Product;
  /** Nombre capturado al vender; en ticket e historial aunque no venga `producto` embebido. */
  productoNombre?: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  impuesto: number;
  subtotal: number;
  total: number;
}

export interface Payment {
  id: string;
  formaPago: FormaPago;
  monto: number;
  /** Referencia bancaria / folio; en tarjeta (04/28) = últimos 4 dígitos para voucher/auditoría. */
  referencia?: string;
}

export type SaleStatus = 'pendiente' | 'completada' | 'cancelada' | 'facturada';

/** Traspaso tienda→tienda (tablas incoming/outgoing transfers por sucursal). */
export type StoreTransferEstado = 'pendiente' | 'recibida';

export interface StoreTransferLine {
  productIdOrigen: string;
  sku: string;
  /** Código de barras en origen; ayuda a enlazar el mismo artículo en destino si el id/SKU difieren. */
  codigoBarras?: string;
  nombre: string;
  cantidad: number;
}

export interface IncomingStoreTransfer {
  id: string;
  estado: StoreTransferEstado;
  origenSucursalId: string;
  origenSaleId: string;
  origenFolio: string;
  items: StoreTransferLine[];
  usuarioNombre?: string;
  createdAt: Date;
  updatedAt: Date;
  recibidaAt?: Date;
  recibidaPorUserId?: string;
  recibidaPorNombre?: string;
}

export type FormaPago = 
  | '01' // Efectivo
  | '02' // Cheque nominativo
  | '03' // Transferencia electrónica de fondos
  | '04' // Tarjeta de crédito
  | '08' // Vales de despensa
  | '28' // Tarjeta de débito
  | '99' // Por definir
  | 'TTS' // Transferencia de tienda a tienda (interno; solo admin, total $0)
  | 'DEV' // Devolución: cancela ticket previo y reembolso en mostrador (no es forma SAT)
  | 'COT' // Cotización: solo en POS para cargar carrito; no se guarda en venta timbrada
  | 'PPC'; // Pendiente de pago: venta completada sin cobro; saldo en cuenta (POS interno)

export type MetodoPago = 'PUE' | 'PPD'; // Pago en una sola exhibición o Parcialidades

// ============================================
// COTIZACIONES
// ============================================
export interface Quotation {
  id: string;
  folio: string;
  clienteId: string;
  cliente?: Client;
  productos: QuotationItem[];
  subtotal: number;
  descuento: number;
  impuestos: number;
  total: number;
  vigenciaDias: number;
  fechaVigencia: Date;
  estado: QuotationStatus;
  notas?: string;
  usuarioId: string;
  /** Nombre del cajero que creó la cotización (impresión / correo). */
  usuarioNombre?: string;
  /** Alcance por sucursal (Dexie / filtrado). */
  sucursalId?: string;
  ventaId?: string; // Si se convirtió en venta
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
}

export interface QuotationItem {
  id: string;
  productId: string;
  producto?: Product;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  impuesto: number;
  subtotal: number;
  total: number;
}

export type QuotationStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'vencida' | 'convertida';

// ============================================
// FACTURAS CFDI 4.0
// ============================================
export interface Invoice {
  id: string;
  uuid?: string; // UUID asignado por el PAC al timbrar
  folio: string;
  serie: string;
  ventaId?: string;
  clienteId: string;
  cliente?: Client;
  emisor: FiscalConfig;
  productos: InvoiceItem[];
  subtotal: number;
  descuento: number;
  impuestosTrasladados: number;
  impuestosRetenidos: number;
  total: number;
  formaPago: FormaPago;
  metodoPago: MetodoPago;
  lugarExpedicion: string;
  fechaEmision: Date;
  fechaTimbrado?: Date;
  selloDigital?: string;
  cadenaOriginal?: string;
  certificado?: string;
  estado: InvoiceStatus;
  xml?: string;
  pdfUrl?: string;
  motivoCancelacion?: string;
  fechaCancelacion?: Date;
  /** Generada en modo prueba: sin validez fiscal; no consume folio SAT configurado. */
  esPrueba?: boolean;
  /** Aislamiento por tienda en datos locales (Dexie). */
  sucursalId?: string;
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
}

export interface InvoiceItem {
  id: string;
  productId: string;
  producto?: Product;
  claveProdServ: string; // Catálogo SAT
  claveUnidad: string; // Catálogo SAT
  cantidad: number;
  descripcion: string;
  precioUnitario: number;
  descuento: number;
  impuestosTrasladados: InvoiceTax[];
  impuestosRetenidos: InvoiceTax[];
  subtotal: number;
  total: number;
}

export interface InvoiceTax {
  tipo: 'Traslado' | 'Retencion';
  impuesto: '002' | '003'; // IVA o IEPS
  tipoFactor: 'Tasa' | 'Cuota' | 'Exento';
  tasaOCuota: number;
  base: number;
  importe: number;
}

export type InvoiceStatus = 'pendiente' | 'enviada' | 'timbrada' | 'cancelada' | 'error';

// ============================================
// SINCRONIZACIÓN
// ============================================
export type SyncStatus = 'synced' | 'pending' | 'error' | 'conflict';

export interface SyncLog {
  id: string;
  entidad: string;
  entidadId: string;
  operacion: 'create' | 'update' | 'delete';
  estado: SyncStatus;
  error?: string;
  intentos: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt?: Date;
  pendingCount: number;
  sync: () => Promise<void>;
  checkConnection: () => void;
}

// ============================================
// REPORTES
// ============================================
export interface SalesReport {
  periodo: { inicio: Date; fin: Date };
  totalVentas: number;
  totalTransacciones: number;
  ticketPromedio: number;
  productosVendidos: number;
  ventasPorDia: DailySales[];
  productosMasVendidos: TopProduct[];
  ventasPorCategoria: CategorySales[];
  ventasPorUsuario: UserSales[];
}

export interface DailySales {
  fecha: Date;
  total: number;
  transacciones: number;
}

export interface TopProduct {
  productId: string;
  producto: Product;
  cantidad: number;
  total: number;
}

export interface CategorySales {
  categoria: string;
  total: number;
  cantidad: number;
}

export interface UserSales {
  usuarioId: string;
  usuario: User;
  total: number;
  transacciones: number;
}

export interface InventoryReport {
  totalProductos: number;
  valorInventario: number;
  productosBajoStock: Product[];
  movimientos: InventoryMovement[];
}

// ============================================
// CATÁLOGOS SAT
// ============================================
export interface CatalogoSAT {
  clave: string;
  descripcion: string;
}

export const REGIMENES_FISCALES: CatalogoSAT[] = [
  { clave: '601', descripcion: 'General de Ley Personas Morales' },
  { clave: '603', descripcion: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { clave: '606', descripcion: 'Arrendamiento' },
  { clave: '608', descripcion: 'Demás ingresos' },
  { clave: '609', descripcion: 'Consolidación' },
  { clave: '610', descripcion: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { clave: '611', descripcion: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', descripcion: 'Ingresos por intereses' },
  { clave: '615', descripcion: 'Régimen de los ingresos por obtención de premios' },
  { clave: '616', descripcion: 'Sin obligaciones fiscales' },
  { clave: '620', descripcion: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
  { clave: '621', descripcion: 'Incorporación Fiscal' },
  { clave: '622', descripcion: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { clave: '623', descripcion: 'Opcional para Grupos de Sociedades' },
  { clave: '624', descripcion: 'Coordinados' },
  { clave: '625', descripcion: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { clave: '626', descripcion: 'Régimen Simplificado de Confianza' },
];

export const USOS_CFDI: CatalogoSAT[] = [
  { clave: 'G01', descripcion: 'Adquisición de mercancías' },
  { clave: 'G02', descripcion: 'Devoluciones, descuentos o bonificaciones' },
  { clave: 'G03', descripcion: 'Gastos en general' },
  { clave: 'I01', descripcion: 'Construcciones' },
  { clave: 'I02', descripcion: 'Mobiliario y equipo de oficina por inversiones' },
  { clave: 'I03', descripcion: 'Equipo de transporte' },
  { clave: 'I04', descripcion: 'Equipo de computo y accesorios' },
  { clave: 'I05', descripcion: 'Dados, troqueles, moldes, matrices y herramental' },
  { clave: 'I06', descripcion: 'Comunicaciones telefónicas' },
  { clave: 'I07', descripcion: 'Comunicaciones satelitales' },
  { clave: 'I08', descripcion: 'Otra maquinaria y equipo' },
  { clave: 'D01', descripcion: 'Honorarios médicos, dentales y gastos hospitalarios' },
  { clave: 'D02', descripcion: 'Gastos médicos por incapacidad o discapacidad' },
  { clave: 'D03', descripcion: 'Gastos funerales' },
  { clave: 'D04', descripcion: 'Donativos' },
  { clave: 'D05', descripcion: 'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)' },
  { clave: 'D06', descripcion: 'Aportaciones voluntarias al SAR' },
  { clave: 'D07', descripcion: 'Primas por seguros de gastos médicos' },
  { clave: 'D08', descripcion: 'Gastos de transportación escolar obligatoria' },
  { clave: 'D09', descripcion: 'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones' },
  { clave: 'D10', descripcion: 'Pagos por servicios educativos (colegiaturas)' },
  { clave: 'S01', descripcion: 'Sin efectos fiscales' },
  { clave: 'CP01', descripcion: 'Pagos' },
  { clave: 'CN01', descripcion: 'Nómina' },
];

export const FORMAS_PAGO: CatalogoSAT[] = [
  { clave: '01', descripcion: 'Efectivo' },
  { clave: '02', descripcion: 'Cheque nominativo' },
  { clave: '03', descripcion: 'Transferencia Bancaria' },
  { clave: '04', descripcion: 'Tarjeta de crédito' },
  { clave: '05', descripcion: 'Monedero electrónico' },
  { clave: '06', descripcion: 'Dinero electrónico' },
  { clave: '08', descripcion: 'Vales de despensa' },
  { clave: '12', descripcion: 'Dación en pago' },
  { clave: '13', descripcion: 'Pago por subrogación' },
  { clave: '14', descripcion: 'Pago por consignación' },
  { clave: '15', descripcion: 'Condonación' },
  { clave: '17', descripcion: 'Compensación' },
  { clave: '23', descripcion: 'Novación' },
  { clave: '24', descripcion: 'Confusión' },
  { clave: '25', descripcion: 'Remisión de deuda' },
  { clave: '26', descripcion: 'Prescripción o caducidad' },
  { clave: '27', descripcion: 'A satisfacción del acreedor' },
  { clave: '28', descripcion: 'Tarjeta de débito' },
  { clave: '29', descripcion: 'Tarjeta de servicios' },
  { clave: '30', descripcion: 'Aplicación de anticipos' },
  { clave: '31', descripcion: 'Intermediario pagos' },
  { clave: '99', descripcion: 'Por definir' },
  { clave: 'DEV', descripcion: 'Devolución' },
  { clave: 'COT', descripcion: 'Cotización' },
  { clave: 'PPC', descripcion: 'Pendiente de pago' },
];

/** Opciones mostradas en POS y facturación (el catálogo completo sigue en FORMAS_PAGO para tickets e históricos). */
export const FORMAS_PAGO_UI: CatalogoSAT[] = [
  { clave: '01', descripcion: 'Efectivo' },
  { clave: '03', descripcion: 'Transferencia Bancaria' },
  { clave: '04', descripcion: 'Tarjeta de crédito' },
  { clave: '08', descripcion: 'Vales de despensa' },
  { clave: '28', descripcion: 'Tarjeta de débito' },
];

export const CLAVES_UNIDAD: CatalogoSAT[] = [
  { clave: 'H87', descripcion: 'Pieza' },
  { clave: 'KGM', descripcion: 'Kilogramo' },
  { clave: 'LTR', descripcion: 'Litro' },
  { clave: 'MTR', descripcion: 'Metro' },
  { clave: 'MTK', descripcion: 'Metro cuadrado' },
  { clave: 'MTQ', descripcion: 'Metro cúbico' },
  { clave: 'XBX', descripcion: 'Caja' },
  { clave: 'XPK', descripcion: 'Paquete' },
  { clave: 'XUN', descripcion: 'Unidad' },
  { clave: 'GRM', descripcion: 'Gramo' },
  { clave: 'MLT', descripcion: 'Mililitro' },
  { clave: 'CMT', descripcion: 'Centímetro' },
];

// ============================================
// UI / ESTADO
// ============================================
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

/** Eventos globales del sistema (panel de notificaciones / auditoría). */
export type AppEventKind = 'info' | 'success' | 'warning' | 'error';

export interface AppEventLogRecord {
  id: string;
  createdAt: Date;
  kind: AppEventKind;
  source: string;
  title: string;
  detail?: string;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  sucursalId?: string;
  route?: string;
  meta?: Record<string, unknown>;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
  /** Precio unitario base (sin IVA) distinto al catálogo; si no hay, se usa lista por línea o la del ticket. */
  precioUnitarioOverride?: number;
  /**
   * Lista de precios solo para esta línea (sin pisar la lista global del ticket).
   * Ignorada si hay `precioUnitarioOverride`.
   */
  precioListaId?: ClientPriceListId;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppState {
  /** Preferencia guardada; `system` sigue a `prefers-color-scheme`. */
  themePreference: ThemePreference;
  /** Último valor del media query (solo afecta cuando `themePreference === 'system'`). */
  systemPrefersDark: boolean;
  toggleTheme: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  
  // Toast notifications
  toasts: Toast[];
  /** `logToAppEvents`: solo si true se guarda en `public.app_events` (panel de eventos). Por defecto no se registra. */
  addToast: (toast: Omit<Toast, 'id'> & { logToAppEvents?: boolean }) => void;
  removeToast: (id: string) => void;
  
  // Loading states
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
}
