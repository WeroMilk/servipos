import { useState, useEffect, useCallback } from 'react';
import type { FiscalConfig } from '@/types';
import { getFiscalConfig, saveFiscalConfig } from '@/db/database';
import { reportHookFailure } from '@/lib/appEventLog';

// ============================================
// HOOK DE CONFIGURACIÓN FISCAL
// ============================================

export function useFiscalConfig() {
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFiscalConfig();
      setConfig(data || null);
      setIsConfigured(!!data && !!data.rfc && !!data.serie);
      setError(null);
    } catch (err) {
      setError('Error al cargar configuración fiscal');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const saveConfig = async (newConfig: Omit<FiscalConfig, 'id' | 'updatedAt'>) => {
    try {
      const id = await saveFiscalConfig(newConfig);
      await loadConfig();
      return id;
    } catch (err) {
      reportHookFailure('hook:useFiscalConfig', 'Guardar configuración fiscal', err);
      setError('Error al guardar configuración fiscal');
      throw err;
    }
  };

  const updateConfig = async (updates: Partial<FiscalConfig>) => {
    try {
      if (!config) {
        throw new Error('No hay configuración para actualizar');
      }
      const id = await saveFiscalConfig({ ...config, ...updates });
      await loadConfig();
      return id;
    } catch (err) {
      reportHookFailure('hook:useFiscalConfig', 'Actualizar configuración fiscal', err);
      setError('Error al actualizar configuración fiscal');
      throw err;
    }
  };

  return {
    config,
    loading,
    error,
    isConfigured,
    refresh: loadConfig,
    saveConfig,
    updateConfig,
  };
}
