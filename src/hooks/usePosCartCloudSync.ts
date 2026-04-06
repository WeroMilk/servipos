import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCartStore } from '@/stores';
import type { CartDraftSnapshot } from '@/stores/cartStore';
import {
  getPosCartDraftOnce,
  savePosCartDraft,
  subscribePosCartDraft,
} from '@/lib/firestore/posCartDraftFirestore';

const WRITE_DEBOUNCE_MS = 300;

function snapshotSignature(s: CartDraftSnapshot): string {
  return JSON.stringify(s);
}

function localBackupKey(userId: string, sucursalId: string): string {
  return `servipos:poscart:${sucursalId}:${userId}`;
}

export function usePosCartCloudSync(params: { userId?: string | null; sucursalId?: string | null }): void {
  const userId = params.userId?.trim() || '';
  const sucursalId = params.sucursalId?.trim() || '';
  const replaceCartDraft = useCartStore((s) => s.replaceCartDraft);
  const snapshot = useCartStore(
    useShallow((s) => ({
      items: s.items,
      client: s.client,
      discount: s.discount,
      formaPago: s.formaPago,
      metodoPago: s.metodoPago,
      pagos: s.pagos,
      notas: s.notas,
      transferenciaDestinoSucursalId: s.transferenciaDestinoSucursalId,
      precioClienteListaId: s.precioClienteListaId,
    }))
  );

  const currentSnapshot = useMemo<CartDraftSnapshot>(
    () => ({
      items: snapshot.items,
      client: snapshot.client,
      discount: snapshot.discount,
      formaPago: snapshot.formaPago,
      metodoPago: snapshot.metodoPago,
      pagos: snapshot.pagos,
      notas: snapshot.notas,
      transferenciaDestinoSucursalId: snapshot.transferenciaDestinoSucursalId,
      precioClienteListaId: snapshot.precioClienteListaId,
    }),
    [snapshot]
  );

  const readyRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const lastSignatureRef = useRef<string>('');

  useEffect(() => {
    readyRef.current = false;
    lastSignatureRef.current = '';
    if (!userId || !sucursalId) {
      replaceCartDraft(null);
      return;
    }

    let cancelled = false;
    const key = localBackupKey(userId, sucursalId);
    replaceCartDraft(null);

    const applyRemote = (draft: CartDraftSnapshot | null) => {
      if (cancelled) return;
      applyingRemoteRef.current = true;
      replaceCartDraft(draft);
      const sig = snapshotSignature(draft ?? {
        items: [],
        client: null,
        discount: 0,
        formaPago: '01',
        metodoPago: 'PUE',
        pagos: [],
        notas: '',
        transferenciaDestinoSucursalId: '',
        precioClienteListaId: 'regular',
      });
      lastSignatureRef.current = sig;
      applyingRemoteRef.current = false;
      readyRef.current = true;
    };

    const loadInitial = async () => {
      const cloud = await getPosCartDraftOnce(sucursalId, userId);
      if (cloud?.cart) {
        applyRemote(cloud.cart);
        try {
          localStorage.setItem(key, JSON.stringify(cloud.cart));
        } catch {
          /* noop */
        }
        return;
      }
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          applyRemote(JSON.parse(raw) as CartDraftSnapshot);
          return;
        }
      } catch {
        /* noop */
      }
      applyRemote(null);
    };

    void loadInitial();

    const unsub = subscribePosCartDraft(sucursalId, userId, (doc) => {
      if (!doc?.cart) return;
      const incomingSig = snapshotSignature(doc.cart);
      if (incomingSig === lastSignatureRef.current) return;
      applyRemote(doc.cart);
      try {
        localStorage.setItem(key, JSON.stringify(doc.cart));
      } catch {
        /* noop */
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, sucursalId, replaceCartDraft]);

  useEffect(() => {
    if (!userId || !sucursalId) return;
    if (!readyRef.current) return;
    if (applyingRemoteRef.current) return;
    const key = localBackupKey(userId, sucursalId);
    const sig = snapshotSignature(currentSnapshot);
    if (sig === lastSignatureRef.current) return;

    const t = window.setTimeout(() => {
      void savePosCartDraft(sucursalId, userId, currentSnapshot)
        .then(() => {
          lastSignatureRef.current = sig;
          try {
            localStorage.setItem(key, JSON.stringify(currentSnapshot));
          } catch {
            /* noop */
          }
        })
        .catch(() => {
          // Mantener UX fluida: el respaldo local ya conserva el borrador.
          try {
            localStorage.setItem(key, JSON.stringify(currentSnapshot));
          } catch {
            /* noop */
          }
        });
    }, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [currentSnapshot, userId, sucursalId]);
}
