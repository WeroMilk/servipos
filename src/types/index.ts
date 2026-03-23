// ============================================
// TIPOS DEL SISTEMA SERVIPARTZ POS
// ============================================

// ============================================
// USUARIOS Y AUTENTICACIÓN
// ============================================
export type UserRole = 'admin' | 'cashier';

export interface User {
  id: string;
  username: string;
  /** Solo usuarios locales (Dexie). Con Firebase Auth no se usa. */
  password?: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  /** Sucursal asignada; la app filtrará datos por este id cuando migre a Firestore. */
  sucursalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Catálogo de sucursales (Firestore `sucursales/{id}`). */
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
  /** true después del primer evento de Firebase Auth (evita flash al /login). */
  authReady: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
}

export type Permission = 
  | 'ventas:ver' 
  | 'ventas:crear' 
  | 'inventario:ver' 
  | 'inventario:crear' 
  | 'inventario:editar' 
  | 'inventario:eliminar'
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

/** Un día de asistencia en Firestore `checadorRegistros/{userId}_{YYYY-MM-DD}`. */
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
  impuesto: number; // IVA por defecto 16%
  existencia: number;
  existenciaMinima: number;
  categoria?: string;
  proveedor?: string;
  imagen?: string;
  unidadMedida: string; // pza, kg, lt, etc.
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
  lastSyncAt?: Date;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'compra';
  cantidad: number;
  cantidadAnterior: number;
  cantidadNueva: number;
  motivo?: string;
  referencia?: string; // ID de venta, compra, etc.
  usuarioId: string;
  createdAt: Date;
  syncStatus: SyncStatus;
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
  /** Número de tickets de compra completados (ventas) asociados a este cliente. */
  ticketsComprados?: number;
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
  /** Tienda (ruta Firestore `sucursales/{id}/sales/...`); para ticket / reimpresión. */
  sucursalId?: string;
  createdAt: Date;
  updatedAt: Date;
  syncStatus: SyncStatus;
  lastSyncAt?: Date;
}

export interface SaleItem {
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

export interface Payment {
  id: string;
  formaPago: FormaPago;
  monto: number;
  /** Referencia bancaria / folio; en tarjeta (04/28) = últimos 4 dígitos para voucher/auditoría. */
  referencia?: string;
}

export type SaleStatus = 'pendiente' | 'completada' | 'cancelada' | 'facturada';

/** Traspaso tienda→tienda (documentos en Firestore por sucursal). */
export type StoreTransferEstado = 'pendiente' | 'recibida';

export interface StoreTransferLine {
  productIdOrigen: string;
  sku: string;
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
  | 'DEV'; // Devolución: cancela ticket previo y reembolso en mostrador (no es forma SAT)

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

export type InvoiceStatus = 'pendiente' | 'timbrada' | 'cancelada' | 'error';

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
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  
  // Loading states
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
}
