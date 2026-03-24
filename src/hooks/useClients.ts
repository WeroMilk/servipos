import { useState, useEffect, useCallback } from 'react';
import type { Client } from '@/types';
import {
  db,
  getClients,
  getClientById,
  searchClients,
  createClient,
  updateClient,
  deleteClient,
} from '@/db/database';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { reportHookFailure } from '@/lib/appEventLog';
import { getDefaultSucursalIdForNewData } from '@/lib/sucursales';
import {
  subscribeClientsCatalog,
  createClientFirestore,
  updateClientFirestore,
  deleteClientFirestore,
} from '@/lib/firestore/clientsFirestore';

function mostradorPlaceholder(sucursalId: string): Client {
  return {
    id: 'mostrador',
    nombre: 'Mostrador',
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
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getClients(effectiveSucursalId);
      const sid = effectiveSucursalId ?? getDefaultSucursalIdForNewData();
      setClients(clientsWithMostrador(data, sid));
      setError(null);
    } catch (err) {
      reportHookFailure('hook:useClients', 'Cargar clientes', err);
      setError('Error al cargar clientes');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (effectiveSucursalId) {
      setLoading(true);
      const unsub = subscribeClientsCatalog(
        effectiveSucursalId,
        (rows) => {
          setClients(clientsWithMostrador(rows, effectiveSucursalId));
          setError(null);
          setLoading(false);
        },
        (rows) => mirrorClientsCloudToDexie(effectiveSucursalId, rows)
      );
      return unsub;
    }

    void loadClients();
    return undefined;
  }, [effectiveSucursalId, loadClients]);

  const addClient = async (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
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
      throw err;
    }
  };

  const editClient = async (id: string, updates: Partial<Client>) => {
    try {
      if (effectiveSucursalId) {
        await updateClientFirestore(effectiveSucursalId, id, updates);
        return;
      }
      await updateClient(id, updates);
      await loadClients();
    } catch (err) {
      reportHookFailure('hook:useClients', 'Actualizar cliente', err);
      setError('Error al actualizar cliente');
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
      reportHookFailure('hook:useClients', 'Eliminar cliente', err);
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

  return {
    clients,
    loading,
    error,
    refresh,
    addClient,
    editClient,
    removeClient,
  };
}

export function useClientSearch() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [results, setResults] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      try {
        setLoading(true);
        const data = await searchClients(query, effectiveSucursalId);
        setResults(data);
      } catch (err) {
        reportHookFailure('hook:useClientSearch', 'Búsqueda de clientes', err);
        console.error('Error en búsqueda:', err);
      } finally {
        setLoading(false);
      }
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
        reportHookFailure('hook:useClientDetails', 'Cargar cliente', err);
        console.error('Error al cargar cliente:', err);
      } finally {
        setLoading(false);
      }
    };

    void loadClient();
  }, [clientId]);

  return { client, loading };
}
