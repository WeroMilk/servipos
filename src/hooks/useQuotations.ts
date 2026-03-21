import { useState, useEffect, useCallback } from 'react';
import type { Quotation } from '@/types';
import {
  getQuotations,
  getQuotationById,
  createQuotation,
  updateQuotation,
  convertQuotationToSale,
  generateQuotationFolio,
  deleteQuotation,
} from '@/db/database';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { reportHookFailure } from '@/lib/appEventLog';

// ============================================
// HOOK DE COTIZACIONES
// ============================================

export function useQuotations() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getQuotations(effectiveSucursalId);
      setQuotations(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar cotizaciones');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    loadQuotations();
  }, [loadQuotations]);

  const addQuotation = async (quotation: Omit<Quotation, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    try {
      const sid = getEffectiveSucursalId();
      const folio = await generateQuotationFolio(sid);
      const id = await createQuotation({ ...quotation, folio, sucursalId: sid });
      await loadQuotations();
      return id;
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Crear cotización', err);
      setError('Error al crear cotización');
      throw err;
    }
  };

  const editQuotation = async (id: string, updates: Partial<Quotation>) => {
    try {
      await updateQuotation(id, updates);
      await loadQuotations();
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Actualizar cotización', err);
      setError('Error al actualizar cotización');
      throw err;
    }
  };

  const convertToSale = async (quotationId: string, usuarioId: string) => {
    try {
      const sucursalId = getEffectiveSucursalId();
      const saleId = await convertQuotationToSale(quotationId, usuarioId, sucursalId);
      await loadQuotations();
      return saleId;
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Convertir cotización a venta', err);
      setError('Error al convertir cotización');
      throw err;
    }
  };

  const removeQuotation = async (id: string) => {
    try {
      await deleteQuotation(id);
      await loadQuotations();
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Eliminar cotización', err);
      setError('Error al eliminar cotización');
      throw err;
    }
  };

  return {
    quotations,
    loading,
    error,
    refresh: loadQuotations,
    addQuotation,
    editQuotation,
    convertToSale,
    removeQuotation,
  };
}

export function useQuotationDetails(quotationId: string | null) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!quotationId) {
      setQuotation(null);
      return;
    }

    const loadQuotation = async () => {
      try {
        setLoading(true);
        const data = await getQuotationById(quotationId);
        setQuotation(data || null);
      } catch (err) {
        reportHookFailure('hook:useQuotationDetails', 'Cargar cotización', err);
        console.error('Error al cargar cotización:', err);
      } finally {
        setLoading(false);
      }
    };

    loadQuotation();
  }, [quotationId]);

  return { quotation, loading };
}
