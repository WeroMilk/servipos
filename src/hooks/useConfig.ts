import { useState, useEffect, useCallback } from 'react';
import type { FiscalConfig } from '@/types';
import { setCatalogListaPreciosIncluyenIvaFromFiscal } from '@/lib/catalogPricingFlags';
import { getFiscalConfig, saveFiscalConfig } from '@/db/database';
import { reportHookFailure } from '@/lib/appEventLog';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';

// ============================================
// HOOK DE CONFIGURACIÓN FISCAL
// ============================================

export function useFiscalConfig() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFiscalConfig();
      setConfig(data ?? null);
      setCatalogListaPreciosIncluyenIvaFromFiscal(data ?? undefined);
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
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const sid = effectiveSucursalId?.trim();

    if (sid) {
      setLoading(true);
      setError(null);
      void import('@/lib/firestore/fiscalConfigFirestore')
        .then(({ subscribeFiscalConfigForSucursal }) => {
          if (cancelled) return;
          unsub = subscribeFiscalConfigForSucursal(sid, (data) => {
            if (cancelled) return;
            setConfig(data ?? null);
            setCatalogListaPreciosIncluyenIvaFromFiscal(data ?? undefined);
            setIsConfigured(!!data && !!data.rfc && !!data.serie);
            setError(null);
            setLoading(false);
          });
        })
        .catch((err) => {
          if (!cancelled) {
            console.error(err);
            setError('Error al cargar configuración fiscal');
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
        unsub?.();
      };
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [effectiveSucursalId, loadConfig]);

  const saveConfig = async (newConfig: Omit<FiscalConfig, 'id' | 'updatedAt'>) => {
    try {
      const id = await saveFiscalConfig(newConfig);
      if (!effectiveSucursalId?.trim()) {
        await loadConfig();
      }
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
      if (!effectiveSucursalId?.trim()) {
        await loadConfig();
      }
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
