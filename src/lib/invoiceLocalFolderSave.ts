import JSZip from 'jszip';
import type { Invoice } from '@/types';
import {
  FACTURAS_SERVIPARTZ_ROOT,
  invoiceCfdiFileBaseName,
  invoiceClientFolderName,
  invoiceDateFolderName,
  invoiceServipartzRelativeDir,
} from '@/lib/invoiceFolderPaths';

export { FACTURAS_SERVIPARTZ_ROOT, invoiceServipartzRelativeDir, invoiceCfdiFileBaseName };

const IDB_NAME = 'servipos-invoice-folders';
const IDB_STORE = 'handles';
const IDB_KEY = 'parent';

type FsWritable = {
  write: (data: BufferSource | Blob) => Promise<void>;
  truncate?: (size: number) => Promise<void>;
  close: () => Promise<void>;
};

type FsFileHandle = {
  createWritable: (opts?: { keepExistingData?: boolean }) => Promise<FsWritable>;
};

type FsDirHandle = {
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FsDirHandle>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
  queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
};

function pickerAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function isInvoiceFolderSaveAbort(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = String((e as { name?: string }).name ?? '');
  return name === 'AbortError' || name === 'NotAllowedError';
}

function openHandlesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function loadStoredParentHandle(): Promise<FsDirHandle | null> {
  try {
    const db = await openHandlesDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve((r.result as FsDirHandle | undefined) ?? null);
    });
  } catch {
    return null;
  }
}

async function storeParentHandle(handle: FsDirHandle): Promise<void> {
  try {
    const db = await openHandlesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const r = tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve();
    });
  } catch {
    /* sin persistencia el picker se pedirá de nuevo */
  }
}

async function ensureReadWrite(handle: FsDirHandle): Promise<boolean> {
  const mode = { mode: 'readwrite' };
  try {
    if (handle.queryPermission) {
      const q = await handle.queryPermission(mode);
      if (q === 'granted') return true;
    }
    if (handle.requestPermission) {
      const p = await handle.requestPermission(mode);
      return p === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

async function getParentDirectoryHandle(): Promise<FsDirHandle> {
  const stored = await loadStoredParentHandle();
  if (stored && (await ensureReadWrite(stored))) return stored;
  const picked = (await window.showDirectoryPicker!({
    id: 'servipos-facturas-servipartz',
    mode: 'readwrite',
    startIn: 'documents',
  })) as FsDirHandle;
  await storeParentHandle(picked);
  return picked;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy: ArrayBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
}

async function writeFile(dir: FsDirHandle, name: string, data: Uint8Array): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable({ keepExistingData: false });
  if (w.truncate) await w.truncate(0);
  await w.write(new Blob([toArrayBuffer(data)]));
  await w.close();
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function saveInvoicePdfAndXmlToServipartzFolder(opts: {
  invoice: Invoice;
  pdfBytes: Uint8Array;
  xmlText: string;
}): Promise<{ method: 'directory' | 'zip'; pathHint: string }> {
  const { invoice, pdfBytes, xmlText } = opts;
  const base = invoiceCfdiFileBaseName(invoice);
  const clientDir = invoiceClientFolderName(invoice);
  const dateDir = invoiceDateFolderName(invoice);
  const xmlBytes = new TextEncoder().encode(xmlText);

  if (pickerAvailable()) {
    const parent = await getParentDirectoryHandle();
    const root = await parent.getDirectoryHandle(FACTURAS_SERVIPARTZ_ROOT, { create: true });
    const client = await root.getDirectoryHandle(clientDir, { create: true });
    const day = await client.getDirectoryHandle(dateDir, { create: true });
    await writeFile(day, `${base}.pdf`, pdfBytes);
    await writeFile(day, `${base}.xml`, xmlBytes);
    return {
      method: 'directory',
      pathHint: `${invoiceServipartzRelativeDir(invoice)}\\${base}.pdf (+ XML)`,
    };
  }

  const zip = new JSZip();
  const folder = zip.folder(invoiceServipartzRelativeDir(invoice));
  if (!folder) throw new Error('No se pudo armar el ZIP');
  folder.file(`${base}.pdf`, Array.from(pdfBytes));
  folder.file(`${base}.xml`, xmlText);
  const blob = await zip.generateAsync({ type: 'blob' });
  const zipName = `${FACTURAS_SERVIPARTZ_ROOT} - ${clientDir} - ${dateDir} - ${base}.zip`;
  triggerBlobDownload(blob, zipName);
  return { method: 'zip', pathHint: zipName };
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<unknown>;
  }
}
