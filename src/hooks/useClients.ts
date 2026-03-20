import { useState, useEffect, useCallback } from 'react';
import type { Client } from '@/types';
import { 
  getClients, 
  getClientById, 
  searchClients,
  createClient,
  updateClient
} from '@/db/database';

// ============================================
// HOOK DE CLIENTES
// ============================================

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getClients();
      setClients(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar clientes');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const addClient = async (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    try {
      const id = await createClient(client);
      await loadClients();
      return id;
    } catch (err) {
      setError('Error al crear cliente');
      throw err;
    }
  };

  const editClient = async (id: string, updates: Partial<Client>) => {
    try {
      await updateClient(id, updates);
      await loadClients();
    } catch (err) {
      setError('Error al actualizar cliente');
      throw err;
    }
  };

  return {
    clients,
    loading,
    error,
    refresh: loadClients,
    addClient,
    editClient,
  };
}

export function useClientSearch() {
  const [results, setResults] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    try {
      setLoading(true);
      const data = await searchClients(query);
      setResults(data);
    } catch (err) {
      console.error('Error en búsqueda:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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

    loadClient();
  }, [clientId]);

  return { client, loading };
}
