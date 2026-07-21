import { useState, useEffect, useCallback, useRef } from 'react';
import { isRemotePermissionDenied, SUPABASE_PERMISSION_HINT } from '@/lib/remotePermissionError';
import type { Client, FormaPago } from '@/types';
import {
  db,
  getClients,
  getClientById,
  searchClients,
  createClient,
  updateClient,
  deleteClient,
  registrarAbonoACuentaCliente,
  emitirCreditoTiendaCliente,
} from '@/db/database';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { getDefaultSucursalIdForNewData } from '@/lib/sucursales';
import { POS_GENERIC_CLIENT_LABEL } from '@/lib/posDefaultCliente';
import {
  subscribeClientsCatalog,
  createClientFirestore,
  updateClientFirestore,
  deleteClientFirestore,
  getClientsCatalogSnapshot,
} from '@/lib/firestore/clientsFirestore';
import { createDebouncedAsyncFn } from '@/lib/debouncedAsync';
import { filterClientsByQuery } from '@/lib/clientCatalogSearch';

function mostradorPlaceholder(sucursalId: string): Client {
  return {
    id: 'mostrador',
    nombre: POS_GENERIC_CLIENT_LABEL,
    isMostrador: true,
    sucursalId,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    syncStatus: 'synced',
  };
}

function clientsWithMostrador(rows: Client[], sucursalId: string): Client[] {
  if (rows.some((c) => c.id === 'mostrador')) return rows;
  return [mostradorPlaceholder(sucursalId), ...rows];
}

function normalizeNombreCliente(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

function digitsOnlyTel(s: string): string {
  return s.replace(/\D/g, '');
}

function isSparseClientIdentity(x: Pick<Client, 'rfc' | 'email' | 'telefono'>): boolean {
  const rfc = (x.rfc ?? '').trim();
  const email = (x.email ?? '').trim();
  const tel = digitsOnlyTel(x.telefono ?? '');
  return rfc.length === 0 && email.length === 0 && tel.length < 7;
}

/** Detecta duplicados antes de crear (RFC, correo, teléfono o mismo nombre sin datos que distingan). */
function findDuplicateNewClient(
  existing: Client[],
  input: Pick<Client, 'nombre' | 'rfc' | 'email' | 'telefono'>
): 'rfc' | 'email' | 'telefono' | 'nombre' | null {
  const nom = normalizeNombreCliente(input.nombre || '');
  if (!nom) return null;

  const rfcIn = (input.rfc ?? '').trim().toUpperCase();
  const emailIn = (input.email ?? '').trim().toLowerCase();
  const telIn = digitsOnlyTel(input.telefono ?? '');

  for (const c of existing) {
    if (c.isMostrador) continue;

    if (rfcIn.length > 0) {
      const rfcC = (c.rfc ?? '').trim().toUpperCase();
      if (rfcC.length > 0 && rfcC === rfcIn) return 'rfc';
    }
    if (emailIn.length > 0) {
      const emailC = (c.email ?? '').trim().toLowerCase();
      if (emailC.length > 0 && emailC === emailIn) return 'email';
    }
    if (telIn.length >= 7) {
      const telC = digitsOnlyTel(c.telefono ?? '');
      if (telC.length >= 7 && telC === telIn) return 'telefono';
    }
  }

  if (isSparseClientIdentity(input)) {
    for (const c of existing) {
      if (c.isMostrador) continue;
      if (normalizeNombreCliente(c.nombre || '') !== nom) continue;
      if (isSparseClientIdentity(c)) return 'nombre';
    }
  }

  return null;
}

async function mirrorClientsCloudToDexie(sucursalId: string, rows: Client[]): Promise<void> {
  try {
    await db.transaction('rw', db.clients, async () => {
      const local = await db.clients
        .where('sucursalId')
        .equals(sucursalId)
        .and((c) => !c.isMostrador)
        .toArray();
      const ids = new Set(rows.map((r) => r.id));
      for (const r of rows) {
        if (r.isMostrador) continue;
        await db.clients.put({ ...r, syncStatus: 'synced' });
      }
      for (const c of local) {
        if (!ids.has(c.id)) await db.clients.delete(c.id);
      }
    });
  } catch (e) {
    console.error('mirrorClientsCloudToDexie:', e);
  }
}

// ============================================
// HOOK DE CLIENTES
// ============================================

export function useClients() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [clients, setClients] = useState<Client[]>(() => {
    if (!effectiveSucursalId) return [];
    const snap = getClientsCatalogSnapshot();
    return snap.length > 0 ? clientsWithMostrador(snap, effectiveSucursalId) : [];
  });
  const clientsRef = useRef<Client[]>([]);
  clientsRef.current = clients;
  const [loading, setLoading] = useState(() => {
    if (!effectiveSucursalId) return true;
    return getClientsCatalogSnapshot().length === 0;
  });
  const [error, setError] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getClients(effectiveSucursalId);
      const sid = effectiveSucursalId ?? getDefaultSucursalIdForNewData();
      setClients(clientsWithMostrador(data, sid));
      setError(null);
    } catch (err) {
      setError('Error al cargar clientes');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (effectiveSucursalId) {
      const snap = getClientsCatalogSnapshot();
      if (snap.length === 0) {
        setLoading(true);
      } else {
        setClients(clientsWithMostrador(snap, effectiveSucursalId));
      }
      const mirrorDebounced = createDebouncedAsyncFn(async () => {
        await mirrorClientsCloudToDexie(effectiveSucursalId, getClientsCatalogSnapshot());
      }, 1200);
      const unsub = subscribeClientsCatalog(
        effectiveSucursalId,
        (rows) => {
          setClients(clientsWithMostrador(rows, effectiveSucursalId));
          setError(null);
          setLoading(false);
        },
        () => mirrorDebounced()
      );
      return unsub;
    }

    void loadClients();
    return undefined;
  }, [effectiveSucursalId, loadClients]);

  const addClient = useCallback(
    async (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
      const dup = findDuplicateNewClient(clientsRef.current, {
        nombre: client.nombre,
        rfc: client.rfc,
        email: client.email,
        telefono: client.telefono,
      });
      if (dup) {
        const messages: Record<'rfc' | 'email' | 'telefono' | 'nombre', string> = {
          rfc: 'Ya existe un cliente con ese RFC.',
          email: 'Ya existe un cliente con ese correo electrónico.',
          telefono: 'Ya existe un cliente con ese número de teléfono.',
          nombre:
            'Ya existe un cliente con ese mismo nombre sin RFC, teléfono (7+ dígitos) ni correo. Complete algún dato o edite el registro existente.',
        };
        throw new Error(messages[dup]);
      }

      try {
        const sid = effectiveSucursalId ?? getDefaultSucursalIdForNewData();
        if (effectiveSucursalId) {
          const id = crypto.randomUUID();
          await createClientFirestore(
            effectiveSucursalId,
            {
              ...client,
              sucursalId: client.sucursalId ?? sid,
            },
            id
          );
          return id;
        }
        const id = await createClient({
          ...client,
          sucursalId: client.sucursalId ?? sid,
        });
        await loadClients();
        return id;
      } catch (err) {
        setError('Error al crear cliente');
        if (isRemotePermissionDenied(err)) {
          throw new Error(`No tiene permiso para guardar el cliente en la nube. ${SUPABASE_PERMISSION_HINT}`);
        }
        throw err;
      }
    },
    [effectiveSucursalId, loadClients]
  );

  const editClient = async (id: string, updates: Partial<Client>) => {
    try {
      if (effectiveSucursalId) {
        await updateClientFirestore(effectiveSucursalId, id, updates);
        return;
      }
      await updateClient(id, updates);
      await loadClients();
    } catch (err) {
      setError('Error al actualizar cliente');
      if (isRemotePermissionDenied(err)) {
        throw new Error(`No tiene permiso para actualizar el cliente en la nube. ${SUPABASE_PERMISSION_HINT}`);
      }
      throw err;
    }
  };

  const removeClient = async (id: string) => {
    try {
      if (id === 'mostrador') throw new Error('No se puede eliminar el cliente Mostrador');
      if (effectiveSucursalId) {
        await deleteClientFirestore(effectiveSucursalId, id);
        return;
      }
      await deleteClient(id);
      await loadClients();
    } catch (err) {
      setError('Error al eliminar cliente');
      throw err;
    }
  };

  const refresh = useCallback(async () => {
    if (effectiveSucursalId) {
      const data = await getClients(effectiveSucursalId);
      setClients(clientsWithMostrador(data, effectiveSucursalId));
      return;
    }
    await loadClients();
  }, [effectiveSucursalId, loadClients]);

  const registrarAbonoCuenta = useCallback(
    async (
      clienteId: string,
      monto: number,
      options?: {
        usuarioNombre?: string;
        formaPago: FormaPago;
        cajaSesionId?: string;
      }
    ) => {
      if (!options?.formaPago) throw new Error('Indique cómo se pagó el abono');
      await registrarAbonoACuentaCliente(clienteId, monto, {
        sucursalId: effectiveSucursalId ?? undefined,
        usuarioNombre: options?.usuarioNombre,
        formaPago: options.formaPago,
        cajaSesionId: options?.cajaSesionId,
      });
      await refresh();
    },
    [effectiveSucursalId, refresh]
  );

  const emitirCreditoTienda = useCallback(
    async (
      clienteId: string,
      monto: number,
      options?: {
        usuarioNombre?: string;
        usuarioId?: string;
        motivo?: string;
        referencia?: string;
        notas?: string;
        cajaSesionId?: string;
      }
    ) => {
      const result = await emitirCreditoTiendaCliente(clienteId, monto, {
        sucursalId: effectiveSucursalId ?? undefined,
        usuarioNombre: options?.usuarioNombre,
        usuarioId: options?.usuarioId,
        motivo: options?.motivo,
        referencia: options?.referencia,
        notas: options?.notas,
        cajaSesionId: options?.cajaSesionId,
      });
      await refresh();
      return result;
    },
    [effectiveSucursalId, refresh]
  );

  return {
    clients,
    loading,
    error,
    refresh,
    addClient,
    editClient,
    removeClient,
    registrarAbonoCuenta,
    emitirCreditoTienda,
  };
}

export function useClientSearch() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [results, setResults] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const search = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = query.trim();
      if (!trimmed) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      debounceRef.current = setTimeout(() => {
        if (effectiveSucursalId) {
          setResults(filterClientsByQuery(getClientsCatalogSnapshot(), trimmed));
          setLoading(false);
          return;
        }

        void (async () => {
          try {
            const data = await searchClients(query, effectiveSucursalId);
            setResults(data);
          } catch (err) {
            console.error('Error en búsqueda:', err);
          } finally {
            setLoading(false);
          }
        })();
      }, 180);
    },
    [effectiveSucursalId]
  );

  return { results, loading, search };
}

export function useClientDetails(clientId: string | null) {
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      return;
    }

    const loadClient = async () => {
      try {
        setLoading(true);
        const data = await getClientById(clientId);
        setClient(data || null);
      } catch (err) {
        console.error('Error al cargar cliente:', err);
      } finally {
        setLoading(false);
      }
    };

    void loadClient();
  }, [clientId]);

  return { client, loading };
}
