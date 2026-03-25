import Dexie, { type Table } from 'dexie';
import type { 
  User, 
  FiscalConfig, 
  Product, 
  InventoryMovement, 
  PurchaseOrder,
  Client, 
  Sale, 
  Quotation, 
  Invoice, 
  SyncLog 
} from '@/types';
import { updateStockUnified } from '@/data/stockBridge';
import {
  createSaleFirestore,
  cancelSaleFirestore,
  completePendingSaleFirestore,
  patchSaleInvoiceFirestore,
  getSaleByIdFirestore,
  getSaleByFolioFirestore,
  fetchSalesByClienteIdFirestore,
} from '@/lib/firestore/salesFirestore';
import { fetchInventoryMovementsByProductIdFirestore } from '@/lib/firestore/inventoryMovementsFirestore';
import { updateClientFirestore } from '@/lib/firestore/clientsFirestore';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { getDefaultSucursalIdForNewData } from '@/lib/sucursales';

const MOSTRADOR_CLIENT_ID = 'mostrador';

// ============================================
// BASE DE DATOS LOCAL (IndexedDB / Dexie) — SERVIPARTZ POS
// ============================================

class POSDatabase extends Dexie {
  // Tablas
  users!: Table<User>;
  fiscalConfig!: Table<FiscalConfig>;
  products!: Table<Product>;
  inventoryMovements!: Table<InventoryMovement>;
  purchaseOrders!: Table<PurchaseOrder>;
  clients!: Table<Client>;
  sales!: Table<Sale>;
  quotations!: Table<Quotation>;
  invoices!: Table<Invoice>;
  syncLogs!: Table<SyncLog>;

  constructor() {
    super('POSMexicoDB');
    
    // Definir esquemas de tablas
    this.version(1).stores({
      // Usuarios
      users: '++id, username, email, role, isActive, createdAt',
      
      // Configuración fiscal
      fiscalConfig: '++id, rfc, serie, folioActual',
      
      // Productos e inventario
      products: '++id, sku, codigoBarras, nombre, categoria, existencia, existenciaMinima, activo, syncStatus, updatedAt',
      inventoryMovements: '++id, productId, tipo, referencia, createdAt, syncStatus',
      purchaseOrders: '++id, proveedor, estado, createdAt',
      
      // Clientes
      clients: '++id, rfc, nombre, isMostrador, syncStatus, createdAt',
      
      // Ventas
      sales: '++id, folio, clienteId, estado, facturaId, usuarioId, createdAt, syncStatus',
      
      // Cotizaciones
      quotations: '++id, folio, clienteId, estado, ventaId, createdAt, syncStatus',
      
      // Facturas
      invoices: '++id, uuid, folio, serie, ventaId, clienteId, estado, createdAt, syncStatus',
      
      // Logs de sincronización
      syncLogs: '++id, entidad, entidadId, operacion, estado, createdAt',
    });

    this.version(2).stores({
      users: '++id, username, email, role, isActive, createdAt',
      fiscalConfig: '++id, rfc, serie, folioActual',
      products:
        '++id, sku, codigoBarras, nombre, categoria, existencia, existenciaMinima, activo, syncStatus, updatedAt',
      inventoryMovements: '++id, productId, tipo, referencia, createdAt, syncStatus',
      purchaseOrders: '++id, proveedor, estado, createdAt',
      clients: '++id, rfc, nombre, isMostrador, sucursalId, syncStatus, createdAt',
      sales: '++id, folio, clienteId, estado, facturaId, usuarioId, createdAt, syncStatus',
      quotations: '++id, folio, clienteId, estado, ventaId, sucursalId, createdAt, syncStatus',
      invoices: '++id, uuid, folio, serie, ventaId, clienteId, estado, sucursalId, createdAt, syncStatus',
      syncLogs: '++id, entidad, entidadId, operacion, estado, createdAt',
    }).upgrade(async (tx) => {
      const def = getDefaultSucursalIdForNewData();
      await tx.table('quotations').toCollection().modify((q) => {
        if (q.sucursalId == null) (q as Quotation).sucursalId = def;
      });
      await tx.table('clients').toCollection().modify((c) => {
        if (c.sucursalId == null) (c as Client).sucursalId = def;
      });
      await tx.table('invoices').toCollection().modify((inv) => {
        if (inv.sucursalId == null) (inv as Invoice).sucursalId = def;
      });
    });

    this.version(3).stores({
      users: '++id, username, email, role, isActive, createdAt',
      fiscalConfig: '++id, rfc, serie, folioActual',
      products:
        '++id, sku, codigoBarras, nombre, categoria, existencia, existenciaMinima, activo, syncStatus, updatedAt',
      inventoryMovements: '++id, productId, tipo, referencia, createdAt, syncStatus',
      purchaseOrders: '++id, proveedor, estado, createdAt',
      clients: '++id, rfc, nombre, isMostrador, sucursalId, syncStatus, createdAt',
      sales: '++id, folio, clienteId, estado, facturaId, usuarioId, createdAt, syncStatus',
      quotations: '++id, folio, clienteId, estado, ventaId, sucursalId, createdAt, syncStatus',
      invoices: '++id, uuid, folio, serie, ventaId, clienteId, estado, sucursalId, createdAt, syncStatus',
      syncLogs: '++id, entidad, entidadId, operacion, estado, createdAt',
    }).upgrade(async (tx) => {
      const def = getDefaultSucursalIdForNewData();
      await tx.table('clients').toCollection().modify((c) => {
        if ((c as Client).sucursalId == null) (c as Client).sucursalId = def;
      });
    });

    // Hooks para actualizar timestamps
    this.products.hook('creating', (_primKey, obj) => {
      obj.createdAt = obj.createdAt || new Date();
      obj.updatedAt = new Date();
      obj.syncStatus = obj.syncStatus || 'pending';
    });

    this.products.hook('updating', (mods) => {
      return { ...mods, updatedAt: new Date(), syncStatus: 'pending' };
    });

    this.sales.hook('creating', (_primKey, obj) => {
      obj.createdAt = obj.createdAt || new Date();
      obj.updatedAt = new Date();
      obj.syncStatus = obj.syncStatus || 'pending';
    });

    this.sales.hook('updating', (mods) => {
      return { ...mods, updatedAt: new Date(), syncStatus: 'pending' };
    });

    this.quotations.hook('creating', (_primKey, obj) => {
      obj.createdAt = obj.createdAt || new Date();
      obj.updatedAt = new Date();
      obj.syncStatus = obj.syncStatus || 'pending';
    });

    this.quotations.hook('updating', (mods) => {
      return { ...mods, updatedAt: new Date(), syncStatus: 'pending' };
    });

    this.invoices.hook('creating', (_primKey, obj) => {
      obj.createdAt = obj.createdAt || new Date();
      obj.updatedAt = new Date();
      obj.syncStatus = obj.syncStatus || 'pending';
    });

    this.invoices.hook('updating', (mods) => {
      return { ...mods, updatedAt: new Date(), syncStatus: 'pending' };
    });
  }
}

// Instancia singleton de la base de datos
export const db = new POSDatabase();

// ============================================
// FUNCIONES AUXILIARES DE BASE DE DATOS
// ============================================

// Inicializar datos de demo
export async function initializeDemoData(): Promise<void> {
  const userCount = await db.users.count();
  
  if (userCount === 0) {
    await db.users.add({
      id: 'user-zavala',
      username: 'zavala',
      password: 'sombra123+',
      name: 'Zavala',
      email: 'zavala@servipartz.local',
      role: 'admin',
      sucursalId: getDefaultSucursalIdForNewData(),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.users.add({
      id: 'user-gabriel',
      username: 'gabriel',
      password: 'veneno123+',
      name: 'Gabriel',
      email: 'gabriel@servipartz.local',
      role: 'admin',
      sucursalId: getDefaultSucursalIdForNewData(),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Verificar si existe configuración fiscal
  const configCount = await db.fiscalConfig.count();
  if (configCount === 0 && import.meta.env.DEV) {
    console.log('No hay configuración fiscal. Por favor configure el sistema.');
  }

  // Crear cliente mostrador si no existe
  const mostradorCount = await db.clients.filter((c) => c.isMostrador === true).count();
  if (mostradorCount === 0) {
    await db.clients.add({
      id: 'mostrador',
      nombre: 'Mostrador',
      isMostrador: true,
      sucursalId: getDefaultSucursalIdForNewData(),
      createdAt: new Date(),
      updatedAt: new Date(),
      syncStatus: 'synced',
    });
  }

  // Crear productos de demo si no hay ninguno
  const productCount = await db.products.count();
  if (productCount === 0) {
    const demoProducts: Product[] = [
      {
        id: 'prod-001',
        sku: 'PROD001',
        codigoBarras: '7501234567890',
        nombre: 'Producto Demo 1',
        descripcion: 'Descripción del producto demo 1',
        precioVenta: 100,
        precioCompra: 60,
        impuesto: 16,
        existencia: 50,
        existenciaMinima: 10,
        categoria: 'General',
        proveedor: 'Proveedor Demo',
        unidadMedida: 'H87',
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        syncStatus: 'synced',
      },
      {
        id: 'prod-002',
        sku: 'PROD002',
        codigoBarras: '7501234567891',
        nombre: 'Producto Demo 2',
        descripcion: 'Descripción del producto demo 2',
        precioVenta: 250.50,
        precioCompra: 150,
        impuesto: 16,
        existencia: 25,
        existenciaMinima: 5,
        categoria: 'Electrónica',
        proveedor: 'Electrónica SA',
        unidadMedida: 'H87',
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        syncStatus: 'synced',
      },
      {
        id: 'prod-003',
        sku: 'PROD003',
        codigoBarras: '7501234567892',
        nombre: 'Producto Demo 3',
        descripcion: 'Descripción del producto demo 3',
        precioVenta: 75.99,
        precioCompra: 45,
        impuesto: 16,
        existencia: 3,
        existenciaMinima: 5,
        categoria: 'General',
        proveedor: 'Proveedor Demo',
        unidadMedida: 'H87',
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        syncStatus: 'synced',
      },
    ];

    await db.products.bulkAdd(demoProducts);
  }
}

/** Migra usuarios demo antiguos y deja zavala / gabriel con las contraseñas indicadas */
export async function syncServipartzSeedUsers(): Promise<void> {
  await db.users.where('username').equals('admin').delete();
  await db.users.where('username').equals('cajero').delete();

  const seeds: Omit<User, 'createdAt' | 'updatedAt'>[] = [
    {
      id: 'user-zavala',
      username: 'zavala',
      password: 'sombra123+',
      name: 'Zavala',
      email: 'zavala@servipartz.local',
      role: 'admin',
      sucursalId: getDefaultSucursalIdForNewData(),
      isActive: true,
    },
    {
      id: 'user-gabriel',
      username: 'gabriel',
      password: 'veneno123+',
      name: 'Gabriel',
      email: 'gabriel@servipartz.local',
      role: 'admin',
      sucursalId: getDefaultSucursalIdForNewData(),
      isActive: true,
    },
  ];

  for (const u of seeds) {
    const existing = await db.users.where('username').equals(u.username).first();
    if (existing) {
      await db.users.update(existing.id, {
        password: u.password,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        sucursalId: u.sucursalId,
        updatedAt: new Date(),
      });
    } else {
      await db.users.add({
        ...u,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User);
    }
  }
}

export async function getAllUsers(): Promise<User[]> {
  return db.users.orderBy('username').toArray();
}

export async function createUserRecord(input: {
  username: string;
  password: string;
  name: string;
  email: string;
  role: User['role'];
  isActive: boolean;
}): Promise<string> {
  const username = input.username.trim();
  const dup = await db.users.where('username').equals(username).first();
  if (dup) throw new Error('Ya existe un usuario con ese nombre de usuario');
  const id = crypto.randomUUID();
  await db.users.add({
    id,
    username,
    password: input.password,
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    isActive: input.isActive,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User);
  return id;
}

export async function updateUserRecord(
  id: string,
  input: {
    username?: string;
    password?: string;
    name?: string;
    email?: string;
    role?: User['role'];
    isActive?: boolean;
  }
): Promise<void> {
  const current = await db.users.get(id);
  if (!current) throw new Error('Usuario no encontrado');

  const username = (input.username ?? current.username).trim();
  if (username !== current.username) {
    const dup = await db.users.where('username').equals(username).first();
    if (dup && dup.id !== id) throw new Error('Ya existe un usuario con ese nombre de usuario');
  }

  const patch: Partial<User> = {
    username,
    name: input.name !== undefined ? input.name.trim() : current.name,
    email: input.email !== undefined ? input.email.trim() : current.email,
    role: input.role ?? current.role,
    isActive: input.isActive ?? current.isActive,
    updatedAt: new Date(),
  };

  if (input.password != null && input.password.length > 0) {
    patch.password = input.password;
  }

  await db.users.update(id, patch);
}

export async function deleteUserRecord(id: string, currentUserId: string): Promise<void> {
  if (id === currentUserId) throw new Error('No puede eliminar su propia cuenta');
  const row = await db.users.get(id);
  if (!row) throw new Error('Usuario no encontrado');
  await db.users.delete(id);
}

// ============================================
// FUNCIONES DE PRODUCTOS
// ============================================

export async function getProducts(): Promise<Product[]> {
  return await db.products.filter((p) => p.activo === true).toArray();
}

export async function getProductById(id: string): Promise<Product | undefined> {
  return await db.products.get(id);
}

export async function getProductByBarcode(codigoBarras: string): Promise<Product | undefined> {
  return await db.products.where('codigoBarras').equals(codigoBarras).first();
}

export async function getProductBySku(sku: string): Promise<Product | undefined> {
  return await db.products.where('sku').equals(sku).first();
}

export async function searchProducts(query: string): Promise<Product[]> {
  const lowerQuery = query.toLowerCase();
  return await db.products
    .filter((p): boolean => {
      if (p.activo !== true) return false;
      const nombre = String(p.nombre ?? '').toLowerCase();
      const sku = String(p.sku ?? '').toLowerCase();
      return (
        nombre.includes(lowerQuery) ||
        sku.includes(lowerQuery) ||
        (p.codigoBarras !== undefined && p.codigoBarras.includes(lowerQuery))
      );
    })
    .toArray();
}

export async function getLowStockProducts(): Promise<Product[]> {
  return await db.products
    .filter(p => p.activo === true && p.existencia <= p.existenciaMinima)
    .toArray();
}

export async function createProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>): Promise<string> {
  const id = await db.products.add({
    ...product,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  } as Product);
  return id as string;
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<void> {
  await db.products.update(id, { ...updates, updatedAt: new Date(), syncStatus: 'pending' });
}

export async function deleteProduct(id: string): Promise<void> {
  // Soft delete
  await db.products.update(id, { activo: false, updatedAt: new Date(), syncStatus: 'pending' });
}

// Stock local: ver `dexieStock.updateStockDexie`; ventas usan `updateStockUnified` (Firestore si hay sucursal).

export async function getInventoryMovementsList(limit = 500): Promise<InventoryMovement[]> {
  return db.inventoryMovements.orderBy('createdAt').reverse().limit(limit).toArray();
}

/** Movimientos de un producto: Firestore si hay sucursal; si no, Dexie. Más recientes primero. */
export async function getInventoryMovementsByProductId(
  productId: string,
  options?: { sucursalId?: string | null; limit?: number }
): Promise<InventoryMovement[]> {
  const pid = productId.trim();
  if (!pid) return [];
  const lim = options?.limit ?? 200;
  const sid = options?.sucursalId;
  if (sid != null && String(sid).trim().length > 0) {
    return fetchInventoryMovementsByProductIdFirestore(String(sid).trim(), pid, lim);
  }
  const rows = await db.inventoryMovements.where('productId').equals(pid).toArray();
  rows.sort((a, b) => {
    const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return tb - ta;
  });
  return rows.slice(0, lim);
}

export async function clearAllInventoryMovementsLocal(): Promise<void> {
  await db.inventoryMovements.clear();
}

/** Alta, baja o edición de producto en catálogo (Dexie, modo sin sucursal). */
export async function appendCatalogInventoryMovementLocal(input: {
  productId: string;
  tipo: 'producto_alta' | 'producto_baja' | 'producto_edicion';
  motivo: string;
  usuarioId: string;
  nombreRegistro?: string;
  skuRegistro?: string;
}): Promise<void> {
  await db.inventoryMovements.add({
    id: crypto.randomUUID(),
    productId: input.productId,
    tipo: input.tipo,
    cantidad: 0,
    cantidadAnterior: 0,
    cantidadNueva: 0,
    motivo: input.motivo,
    usuarioId: input.usuarioId,
    nombreRegistro: input.nombreRegistro?.trim() || undefined,
    skuRegistro: input.skuRegistro?.trim() || undefined,
    createdAt: new Date(),
    syncStatus: 'pending',
  } as InventoryMovement);
}

// ============================================
// FUNCIONES DE VENTAS
// ============================================

export async function getSales(limit: number = 100): Promise<Sale[]> {
  return await db.sales
    .orderBy('createdAt')
    .reverse()
    .limit(limit)
    .toArray();
}

export async function getSalesByDateRange(inicio: Date, fin: Date): Promise<Sale[]> {
  return await db.sales
    .where('createdAt')
    .between(inicio, fin)
    .toArray();
}

/**
 * Ventas de un cliente: con sucursal en nube lee Firestore; si no, solo Dexie local.
 * Más recientes primero.
 */
export async function getSalesByClienteId(
  clienteId: string,
  options?: { sucursalId?: string | null }
): Promise<Sale[]> {
  if (!clienteId || clienteId === 'mostrador') return [];
  const sid = options?.sucursalId;
  if (sid != null && String(sid).trim().length > 0) {
    return fetchSalesByClienteIdFirestore(String(sid).trim(), clienteId);
  }
  const rows = await db.sales.where('clienteId').equals(clienteId).toArray();
  rows.sort((a, b) => {
    const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return tb - ta;
  });
  return rows;
}

export async function getSaleById(id: string): Promise<Sale | undefined> {
  return await db.sales.get(id);
}

export async function getSaleByFolio(
  folio: string,
  options?: { sucursalId?: string }
): Promise<Sale | undefined> {
  const f = folio.trim();
  if (!f) return undefined;
  if (options?.sucursalId) {
    const s = await getSaleByFolioFirestore(options.sucursalId, f);
    return s ?? undefined;
  }
  return await db.sales.where('folio').equals(f).first();
}

export async function createSale(
  sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>,
  options?: { sucursalId?: string }
): Promise<{ id: string; folio: string }> {
  if (options?.sucursalId) {
    const { id, folio } = await createSaleFirestore(options.sucursalId, sale);
    if (sale.estado !== 'pendiente') {
      await adjustClientTicketCount(sale.clienteId, 1, { sucursalId: options.sucursalId });
    }
    return { id, folio };
  }

  const folio =
    sale.folio && String(sale.folio).trim().length > 0 ? sale.folio : await generateFolio('V');

  const id = await db.sales.add({
    ...sale,
    folio,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  } as Sale);

  for (const item of sale.productos) {
    await updateStockUnified(
      undefined,
      item.productId,
      item.cantidad,
      'salida',
      'Venta',
      id as string,
      sale.usuarioId
    );
  }

  if (sale.estado !== 'pendiente') {
    await adjustClientTicketCount(sale.clienteId, 1);
  }
  return { id: id as string, folio };
}

/** Cierra cobro de venta `pendiente` (inventario ya salió al crearla). */
export async function completePendingSale(
  id: string,
  patch: {
    formaPago: Sale['formaPago'];
    metodoPago: Sale['metodoPago'];
    pagos: Sale['pagos'];
    cambio: number;
    usuarioNombreCierre?: string | null;
    cajaSesionId?: string | null;
    /** Cliente elegido en el POS al cobrar (sustituye al de la venta pendiente si cambió). */
    clienteId?: string;
    cliente?: Client | null;
  },
  options?: { sucursalId?: string }
): Promise<void> {
  const sucursalId = options?.sucursalId;
  if (sucursalId) {
    await completePendingSaleFirestore(sucursalId, id, patch);
    const updated = await getSaleByIdFirestore(sucursalId, id);
    if (updated?.clienteId && updated.clienteId !== MOSTRADOR_CLIENT_ID) {
      await adjustClientTicketCount(updated.clienteId, 1, { sucursalId });
    }
    return;
  }

  const sale = await db.sales.get(id);
  if (!sale) throw new Error('Venta no encontrada');
  if (sale.estado !== 'pendiente') throw new Error('Esta venta ya no está pendiente de pago');
  if (sale.facturaId) throw new Error('No se puede completar una venta ya vinculada a factura');

  const cajaPatch =
    typeof patch.cajaSesionId === 'string' && patch.cajaSesionId.trim().length > 0
      ? { cajaSesionId: patch.cajaSesionId.trim() }
      : {};

  const clienteCierrePatch: Partial<Sale> = {};
  if (patch.clienteId !== undefined) {
    clienteCierrePatch.clienteId = patch.clienteId;
    if (patch.cliente && patch.clienteId !== MOSTRADOR_CLIENT_ID) {
      clienteCierrePatch.cliente = patch.cliente;
    } else {
      clienteCierrePatch.cliente = undefined;
    }
  }

  await db.sales.update(id, {
    estado: 'completada',
    formaPago: patch.formaPago,
    metodoPago: patch.metodoPago,
    pagos: patch.pagos,
    cambio: patch.cambio,
    usuarioNombre:
      typeof patch.usuarioNombreCierre === 'string' && patch.usuarioNombreCierre.trim().length > 0
        ? patch.usuarioNombreCierre.trim()
        : sale.usuarioNombre,
    ...cajaPatch,
    ...clienteCierrePatch,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  const clienteIdTickets =
    patch.clienteId !== undefined ? patch.clienteId : sale.clienteId;
  if (clienteIdTickets && clienteIdTickets !== MOSTRADOR_CLIENT_ID) {
    await adjustClientTicketCount(clienteIdTickets, 1);
  }
}

export async function cancelSale(
  id: string,
  options?: {
    motivo?: string;
    sucursalId?: string;
    cancelacionMotivo?: 'devolucion' | 'panel';
  }
): Promise<void> {
  const motivo = options?.motivo;
  const cancelacionMotivo = options?.cancelacionMotivo;
  const sucursalId = options?.sucursalId;

  if (sucursalId) {
    const prev = await getSaleByIdFirestore(sucursalId, id);
    await cancelSaleFirestore(sucursalId, id, motivo, cancelacionMotivo);
    if (
      prev &&
      prev.estado !== 'cancelada' &&
      (prev.estado === 'completada' || prev.estado === 'facturada') &&
      prev.clienteId &&
      prev.clienteId !== MOSTRADOR_CLIENT_ID
    ) {
      await adjustClientTicketCount(prev.clienteId, -1, { sucursalId });
    }
    return;
  }

  const sale = await db.sales.get(id);
  if (!sale) throw new Error('Venta no encontrada');
  if (sale.estado === 'cancelada') throw new Error('La venta ya está cancelada');
  if (sale.facturaId) throw new Error('No se puede cancelar una venta facturada');

  for (const item of sale.productos) {
    await updateStockUnified(
      undefined,
      item.productId,
      item.cantidad,
      'entrada',
      `Cancelación de venta: ${motivo || 'Sin motivo'}`,
      id,
      sale.usuarioId
    );
  }

  const tipoEtiqueta =
    cancelacionMotivo === 'devolucion' ? 'devolución' : cancelacionMotivo === 'panel' ? 'panel' : 'venta';
  const notas = motivo
    ? `${sale.notas || ''} | Cancelada (${tipoEtiqueta}): ${motivo}`.trim()
    : sale.notas;

  await db.sales.update(id, {
    estado: 'cancelada',
    cancelacionMotivo,
    notas,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  if (
    (sale.estado === 'completada' || sale.estado === 'facturada') &&
    sale.clienteId &&
    sale.clienteId !== MOSTRADOR_CLIENT_ID
  ) {
    await adjustClientTicketCount(sale.clienteId, -1);
  }
}

// ============================================
// FUNCIONES DE COTIZACIONES
// ============================================

/** Rellena `producto` en cada línea desde el catálogo local (Dexie a veces no conserva el embed). */
function attachProductsToQuotation(q: Quotation, productMap: Map<string, Product>): Quotation {
  const productos = q.productos.map((it) => {
    if (it.producto?.nombre?.trim()) return it;
    const p = productMap.get(it.productId);
    return p ? { ...it, producto: p } : it;
  });
  return { ...q, productos };
}

export async function getQuotations(sucursalId?: string): Promise<Quotation[]> {
  let rows: Quotation[];
  if (sucursalId) {
    rows = await db.quotations.where('sucursalId').equals(sucursalId).toArray();
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    rows = await db.quotations.orderBy('createdAt').reverse().toArray();
  }

  const ids = [
    ...new Set(
      rows
        .map((r) => r.clienteId)
        .filter((id): id is string => Boolean(id) && id !== MOSTRADOR_CLIENT_ID)
    ),
  ];
  const clientMap = new Map<string, Client>();
  await Promise.all(
    ids.map(async (id) => {
      const c = await db.clients.get(id);
      if (c) clientMap.set(id, c);
    })
  );

  const productIds = [
    ...new Set(rows.flatMap((q) => q.productos.map((p) => p.productId)).filter(Boolean)),
  ];
  const productMap = new Map<string, Product>();
  await Promise.all(
    productIds.map(async (pid) => {
      const p = await db.products.get(pid);
      if (p) productMap.set(pid, p);
    })
  );

  return rows.map((q) => {
    let next = q;
    if (!q.cliente?.nombre?.trim()) {
      const c =
        q.clienteId && q.clienteId !== MOSTRADOR_CLIENT_ID ? clientMap.get(q.clienteId) : undefined;
      if (c) next = { ...next, cliente: c };
    }
    return attachProductsToQuotation(next, productMap);
  });
}

/**
 * Busca cotización pendiente y vigente cuyo folio termine en -XXXX (últimos 4 dígitos del consecutivo).
 * Ej. folio `C-20260323-0007` → buscar `0007` o `7`.
 */
export async function findQuotationByLast4Folio(
  last4Raw: string,
  sucursalId?: string
): Promise<Quotation | undefined> {
  const digits = last4Raw.replace(/\D/g, '').slice(-4);
  if (digits.length < 1) return undefined;
  const suffix = `-${digits.padStart(4, '0')}`;
  const all = await getQuotations(sucursalId);
  const now = Date.now();
  const cands = all.filter(
    (q) =>
      q.estado === 'pendiente' &&
      q.folio.endsWith(suffix) &&
      new Date(q.fechaVigencia).getTime() >= now
  );
  if (cands.length === 0) return undefined;
  cands.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return cands[0];
}

/** Marca cotización como cobrada en POS y enlaza el id de la venta completada. */
export async function markQuotationConvertedWithSale(quotationId: string, ventaId: string): Promise<void> {
  const q = await db.quotations.get(quotationId);
  if (!q) throw new Error('Cotización no encontrada');
  if (q.estado === 'convertida') return;
  await updateQuotation(quotationId, {
    estado: 'convertida',
    ventaId,
  });
}

export async function getQuotationById(id: string): Promise<Quotation | undefined> {
  const q = await db.quotations.get(id);
  if (!q) return undefined;

  let next: Quotation = q;
  if (!q.cliente?.nombre?.trim() && q.clienteId && q.clienteId !== MOSTRADOR_CLIENT_ID) {
    const c = await db.clients.get(q.clienteId);
    if (c) next = { ...next, cliente: c };
  }

  const productIds = [...new Set(q.productos.map((p) => p.productId).filter(Boolean))];
  if (productIds.length === 0) return next;

  const productMap = new Map<string, Product>();
  await Promise.all(
    productIds.map(async (pid) => {
      const p = await db.products.get(pid);
      if (p) productMap.set(pid, p);
    })
  );
  return attachProductsToQuotation(next, productMap);
}

export async function createQuotation(quotation: Omit<Quotation, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>): Promise<string> {
  const id = await db.quotations.add({
    ...quotation,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  } as Quotation);
  return id as string;
}

export async function updateQuotation(id: string, updates: Partial<Quotation>): Promise<void> {
  await db.quotations.update(id, { ...updates, updatedAt: new Date(), syncStatus: 'pending' });
}

export async function convertQuotationToSale(
  quotationId: string,
  usuarioId: string,
  sucursalId?: string,
  usuarioNombre?: string
): Promise<string> {
  const quotation = await db.quotations.get(quotationId);
  if (!quotation) throw new Error('Cotización no encontrada');
  if (quotation.estado === 'convertida') throw new Error('La cotización ya fue convertida');
  if (quotation.estado === 'vencida') throw new Error('La cotización está vencida');

  const folioLocal = sucursalId ? '' : await generateFolio('V');

  const sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'> = {
    folio: folioLocal,
    clienteId: quotation.clienteId,
    productos: quotation.productos.map((q) => ({
      id: crypto.randomUUID(),
      productId: q.productId,
      productoNombre: q.producto?.nombre?.trim() || undefined,
      cantidad: q.cantidad,
      precioUnitario: q.precioUnitario,
      descuento: q.descuento,
      impuesto: q.impuesto,
      subtotal: q.subtotal,
      total: q.total,
    })),
    subtotal: quotation.subtotal,
    descuento: quotation.descuento,
    impuestos: quotation.impuestos,
    total: quotation.total,
    formaPago: '01', // Efectivo por defecto
    metodoPago: 'PUE',
    pagos: [],
    estado: 'pendiente',
    notas: `Convertido de cotización ${quotation.folio}`,
    usuarioId,
    usuarioNombre: usuarioNombre?.trim() || quotation.usuarioNombre?.trim() || undefined,
  };

  const { id: saleId } = await createSale(sale, { sucursalId });

  // Actualizar cotización
  await db.quotations.update(quotationId, {
    estado: 'convertida',
    ventaId: saleId,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  return saleId;
}

/** Deshace "Ya cobrada": vuelve a pendiente y quita el vínculo a la venta (la venta no se elimina). */
export async function revertQuotationToPending(quotationId: string): Promise<void> {
  const q = await db.quotations.get(quotationId);
  if (!q) throw new Error('Cotización no encontrada');
  if (q.estado !== 'convertida') throw new Error('Solo las cotizaciones ya cobradas pueden volver a pendiente');

  const next: Quotation = {
    ...q,
    estado: 'pendiente',
    updatedAt: new Date(),
    syncStatus: 'pending',
  };
  Reflect.deleteProperty(next as unknown as Record<string, unknown>, 'ventaId');
  await db.quotations.put(next);
}

// ============================================
// FUNCIONES DE FACTURAS
// ============================================

export async function getInvoices(sucursalId?: string): Promise<Invoice[]> {
  if (sucursalId) {
    const rows = await db.invoices.where('sucursalId').equals(sucursalId).toArray();
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return await db.invoices.orderBy('createdAt').reverse().toArray();
}

export async function getInvoiceById(id: string): Promise<Invoice | undefined> {
  return await db.invoices.get(id);
}

export async function createInvoice(
  invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>,
  options?: { sucursalId?: string }
): Promise<string> {
  const id = await db.invoices.add({
    ...invoice,
    id: crypto.randomUUID(),
    sucursalId: options?.sucursalId,
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  } as Invoice);

  if (invoice.ventaId) {
    if (options?.sucursalId) {
      await patchSaleInvoiceFirestore(options.sucursalId, invoice.ventaId, {
        facturaId: id as string,
        estado: 'facturada',
      });
    } else {
      await db.sales.update(invoice.ventaId, {
        facturaId: id as string,
        estado: 'facturada',
        updatedAt: new Date(),
        syncStatus: 'pending',
      });
    }
  }

  return id as string;
}

export async function cancelInvoice(
  id: string,
  motivo: string,
  options?: { sucursalId?: string }
): Promise<void> {
  const invoice = await db.invoices.get(id);
  if (!invoice) throw new Error('Factura no encontrada');
  if (invoice.estado === 'cancelada') throw new Error('La factura ya está cancelada');

  await db.invoices.update(id, {
    estado: 'cancelada',
    motivoCancelacion: motivo,
    fechaCancelacion: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  if (invoice.ventaId) {
    if (options?.sucursalId) {
      await patchSaleInvoiceFirestore(options.sucursalId, invoice.ventaId, {
        facturaId: null,
        estado: 'completada',
      });
    } else {
      await db.sales.update(invoice.ventaId, {
        facturaId: undefined,
        estado: 'completada',
        updatedAt: new Date(),
        syncStatus: 'pending',
      });
    }
  }
}

// ============================================
// FUNCIONES DE CLIENTES
// ============================================

/** Ajusta el contador de tickets de compra del cliente (Dexie y, si aplica, Firestore). No interrumpe ventas si falla. */
export async function adjustClientTicketCount(
  clienteId: string | undefined,
  delta: number,
  options?: { sucursalId?: string | null }
): Promise<void> {
  if (!clienteId || clienteId === MOSTRADOR_CLIENT_ID || delta === 0) return;
  try {
    const row = await db.clients.get(clienteId);
    if (!row || row.isMostrador) return;
    const next = Math.max(0, (row.ticketsComprados ?? 0) + delta);
    const sid = options?.sucursalId?.trim();
    if (sid) {
      await updateClientFirestore(sid, clienteId, { ticketsComprados: next });
    }
    await db.clients.update(clienteId, {
      ticketsComprados: next,
      updatedAt: new Date(),
      syncStatus: sid ? 'synced' : 'pending',
    });
  } catch (e) {
    console.error('adjustClientTicketCount:', e);
  }
}

export async function getClients(sucursalId?: string): Promise<Client[]> {
  if (sucursalId) {
    return await db.clients.where('sucursalId').equals(sucursalId).toArray();
  }
  return await db.clients.toArray();
}

export async function getClientById(id: string): Promise<Client | undefined> {
  return await db.clients.get(id);
}

export async function searchClients(query: string, sucursalId?: string): Promise<Client[]> {
  const lowerQuery = query.toLowerCase();
  return await db.clients
    .filter((c): boolean => {
      if (sucursalId && c.sucursalId !== sucursalId) return false;
      return (
        c.nombre.toLowerCase().includes(lowerQuery) ||
        (c.rfc !== undefined && c.rfc.toLowerCase().includes(lowerQuery))
      );
    })
    .toArray();
}

export async function createClient(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>): Promise<string> {
  const sid = client.sucursalId ?? getDefaultSucursalIdForNewData();
  const id = await db.clients.add({
    ...client,
    sucursalId: sid,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  } as Client);
  return id as string;
}

export async function deleteQuotation(id: string): Promise<void> {
  await db.quotations.delete(id);
}

export async function deleteInvoiceRecord(id: string): Promise<void> {
  const inv = await db.invoices.get(id);
  if (!inv) return;
  if (inv.estado === 'timbrada') {
    throw new Error('No se puede eliminar una factura ya timbrada ante el SAT.');
  }
  await db.invoices.delete(id);
}

export async function updateClient(id: string, updates: Partial<Client>): Promise<void> {
  await db.clients.update(id, { ...updates, updatedAt: new Date(), syncStatus: 'pending' });
}

export async function deleteClient(id: string): Promise<void> {
  await db.clients.delete(id);
}

// ============================================
// FUNCIONES DE CONFIGURACIÓN
// ============================================

export async function getFiscalConfig(): Promise<FiscalConfig | undefined> {
  return await db.fiscalConfig.toCollection().first();
}

export async function saveFiscalConfig(config: Omit<FiscalConfig, 'id' | 'updatedAt'>): Promise<string> {
  const existing = await db.fiscalConfig.toCollection().first();
  
  if (existing) {
    await db.fiscalConfig.update(existing.id, {
      ...config,
      updatedAt: new Date(),
    });
    return existing.id;
  } else {
    const id = await db.fiscalConfig.add({
      ...config,
      id: crypto.randomUUID(),
      updatedAt: new Date(),
    } as FiscalConfig);
    return id as string;
  }
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

// Generar folio consecutivo
export async function generateFolio(prefix: string = 'V'): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const count = await db.sales.where('folio').startsWith(`${prefix}-${dateStr}`).count();
  return `${prefix}-${dateStr}-${String(count + 1).padStart(4, '0')}`;
}

// Generar folio de cotización
export async function generateQuotationFolio(sucursalId?: string): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `C-${dateStr}`;
  const count = sucursalId
    ? await db.quotations
        .where('sucursalId')
        .equals(sucursalId)
        .filter((q) => q.folio.startsWith(prefix))
        .count()
    : await db.quotations.where('folio').startsWith(prefix).count();
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

// Obtener siguiente folio fiscal
export async function getNextInvoiceFolio(): Promise<{ serie: string; folio: number }> {
  const config = await db.fiscalConfig.toCollection().first();
  if (!config) throw new Error('No hay configuración fiscal');
  
  return {
    serie: config.serie,
    folio: config.folioActual,
  };
}

// Incrementar folio fiscal
export async function incrementInvoiceFolio(): Promise<void> {
  const config = await db.fiscalConfig.toCollection().first();
  if (!config) throw new Error('No hay configuración fiscal');
  
  await db.fiscalConfig.update(config.id, {
    folioActual: config.folioActual + 1,
    updatedAt: new Date(),
  });
}

/** Serie fija para facturas en modo prueba (no es folio autorizado ante el SAT). */
export const SERIE_FACTURA_PRUEBA = 'PRUEBA';

/** Serie fija para recibos de nómina impresos solo como prueba. */
export const SERIE_NOMINA_PRUEBA = 'PRUEBA-N';

/** Reserva folio de factura de prueba sin tocar `folioActual`. */
export async function reservePruebaInvoiceFolio(): Promise<{ serie: string; folio: string }> {
  const config = await db.fiscalConfig.toCollection().first();
  if (!config) throw new Error('No hay configuración fiscal');

  const n = config.folioPruebaFactura ?? 1;
  await db.fiscalConfig.update(config.id, {
    folioPruebaFactura: n + 1,
    updatedAt: new Date(),
  });
  return { serie: SERIE_FACTURA_PRUEBA, folio: String(n) };
}

/** Reserva folio para una impresión de recibo de nómina de prueba sin tocar `folioNominaActual`. */
export async function reservePruebaNominaFolio(): Promise<{ serie: string; folio: string }> {
  const config = await db.fiscalConfig.toCollection().first();
  if (!config) throw new Error('No hay configuración fiscal');

  const n = config.folioPruebaNomina ?? 1;
  await db.fiscalConfig.update(config.id, {
    folioPruebaNomina: n + 1,
    updatedAt: new Date(),
  });
  return { serie: SERIE_NOMINA_PRUEBA, folio: String(n) };
}

// ============================================
// SINCRONIZACIÓN
// ============================================

export async function getPendingSyncCount(): Promise<number> {
  const cloudSid = getEffectiveSucursalId();
  if (cloudSid != null && String(cloudSid).trim().length > 0) {
    // Con sucursal en Firestore el catálogo autoritativo está en la nube; `pending` en Dexie no es cola de subida.
    return 0;
  }

  const [products, sales, quotations, invoices, clients, movements] = await Promise.all([
    db.products.where('syncStatus').equals('pending').count(),
    db.sales.where('syncStatus').equals('pending').count(),
    db.quotations.where('syncStatus').equals('pending').count(),
    db.invoices.where('syncStatus').equals('pending').count(),
    db.clients.where('syncStatus').equals('pending').count(),
    db.inventoryMovements.where('syncStatus').equals('pending').count(),
  ]);
  
  return products + sales + quotations + invoices + clients + movements;
}

export async function markAsSynced(tableName: keyof POSDatabase, id: string): Promise<void> {
  const table = db[tableName] as Table<any>;
  await table.update(id, { syncStatus: 'synced', lastSyncAt: new Date() });
}

export async function getPendingItems(tableName: keyof POSDatabase): Promise<any[]> {
  const table = db[tableName] as Table<any>;
  return await table.where('syncStatus').equals('pending').toArray();
}
