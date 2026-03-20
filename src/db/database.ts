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
  patchSaleInvoiceFirestore,
} from '@/lib/firestore/salesFirestore';

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
      role: 'cashier',
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
      isActive: true,
    },
    {
      id: 'user-gabriel',
      username: 'gabriel',
      password: 'veneno123+',
      name: 'Gabriel',
      email: 'gabriel@servipartz.local',
      role: 'cashier',
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
    .filter((p): boolean => 
      p.activo === true && (
        p.nombre.toLowerCase().includes(lowerQuery) ||
        p.sku.toLowerCase().includes(lowerQuery) ||
        (p.codigoBarras !== undefined && p.codigoBarras.includes(lowerQuery))
      )
    )
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

export async function getSaleById(id: string): Promise<Sale | undefined> {
  return await db.sales.get(id);
}

export async function createSale(
  sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>,
  options?: { sucursalId?: string }
): Promise<string> {
  if (options?.sucursalId) {
    return createSaleFirestore(options.sucursalId, sale);
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

  return id as string;
}

export async function cancelSale(
  id: string,
  motivo?: string,
  options?: { sucursalId?: string }
): Promise<void> {
  if (options?.sucursalId) {
    await cancelSaleFirestore(options.sucursalId, id, motivo);
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

  await db.sales.update(id, {
    estado: 'cancelada',
    notas: motivo ? `${sale.notas || ''} | Cancelada: ${motivo}` : sale.notas,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });
}

// ============================================
// FUNCIONES DE COTIZACIONES
// ============================================

export async function getQuotations(): Promise<Quotation[]> {
  return await db.quotations
    .orderBy('createdAt')
    .reverse()
    .toArray();
}

export async function getQuotationById(id: string): Promise<Quotation | undefined> {
  return await db.quotations.get(id);
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
  sucursalId?: string
): Promise<string> {
  const quotation = await db.quotations.get(quotationId);
  if (!quotation) throw new Error('Cotización no encontrada');
  if (quotation.estado === 'convertida') throw new Error('La cotización ya fue convertida');
  if (quotation.estado === 'vencida') throw new Error('La cotización está vencida');

  const folioLocal = sucursalId ? '' : await generateFolio('V');

  const sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'> = {
    folio: folioLocal,
    clienteId: quotation.clienteId,
    productos: quotation.productos.map(q => ({
      id: crypto.randomUUID(),
      productId: q.productId,
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
  };

  const saleId = await createSale(sale, { sucursalId });

  // Actualizar cotización
  await db.quotations.update(quotationId, {
    estado: 'convertida',
    ventaId: saleId,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  return saleId;
}

// ============================================
// FUNCIONES DE FACTURAS
// ============================================

export async function getInvoices(): Promise<Invoice[]> {
  return await db.invoices
    .orderBy('createdAt')
    .reverse()
    .toArray();
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

export async function getClients(): Promise<Client[]> {
  return await db.clients.toArray();
}

export async function getClientById(id: string): Promise<Client | undefined> {
  return await db.clients.get(id);
}

export async function searchClients(query: string): Promise<Client[]> {
  const lowerQuery = query.toLowerCase();
  return await db.clients
    .filter((c): boolean => 
      c.nombre.toLowerCase().includes(lowerQuery) ||
      (c.rfc !== undefined && c.rfc.toLowerCase().includes(lowerQuery))
    )
    .toArray();
}

export async function createClient(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>): Promise<string> {
  const id = await db.clients.add({
    ...client,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'pending',
  } as Client);
  return id as string;
}

export async function updateClient(id: string, updates: Partial<Client>): Promise<void> {
  await db.clients.update(id, { ...updates, updatedAt: new Date(), syncStatus: 'pending' });
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
export async function generateQuotationFolio(): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const count = await db.quotations.where('folio').startsWith(`C-${dateStr}`).count();
  return `C-${dateStr}-${String(count + 1).padStart(4, '0')}`;
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

// ============================================
// SINCRONIZACIÓN
// ============================================

export async function getPendingSyncCount(): Promise<number> {
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
