import { useState, useEffect, useCallback } from 'react';
import type { Quotation } from '@/types';
import { 
  getQuotations, 
  getQuotationById, 
  createQuotation,
  updateQuotation,
  convertQuotationToSale,
  generateQuotationFolio
} from '@/db/database';
import { useAuthStore } from '@/stores';

// ============================================
// HOOK DE COTIZACIONES
// ============================================

export function useQuotations() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getQuotations();
      setQuotations(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar cotizaciones');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuotations();
  }, [loadQuotations]);

  const addQuotation = async (quotation: Omit<Quotation, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    try {
      const folio = await generateQuotationFolio();
      const id = await createQuotation({ ...quotation, folio });
      await loadQuotations();
      return id;
    } catch (err) {
      setError('Error al crear cotización');
      throw err;
    }
  };

  const editQuotation = async (id: string, updates: Partial<Quotation>) => {
    try {
      await updateQuotation(id, updates);
      await loadQuotations();
    } catch (err) {
      setError('Error al actualizar cotización');
      throw err;
    }
  };

  const convertToSale = async (quotationId: string, usuarioId: string) => {
    try {
      const sucursalId = useAuthStore.getState().user?.sucursalId;
      const saleId = await convertQuotationToSale(quotationId, usuarioId, sucursalId);
      await loadQuotations();
      return saleId;
    } catch (err) {
      setError('Error al convertir cotización');
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
        console.error('Error al cargar cotización:', err);
      } finally {
        setLoading(false);
      }
    };

    loadQuotation();
  }, [quotationId]);

  return { quotation, loading };
}
