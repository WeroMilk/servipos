import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
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

function emptyDraftSignature(): string {
  return snapshotSignature({
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
}

function localBackupKey(userId: string, sucursalId: string): string {
  return `servipos:poscart:${sucursalId}:${userId}`;
}

function bumpRemoteClock(ref: MutableRefObject<number>, ts: number): void {
  ref.current = Math.max(ref.current, ts);
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
  /** Última versión de borrador remoto que ya aplicamos o persistimos (evita pisar cambios locales con lecturas viejas). */
  const lastRemoteUpdatedAtMsRef = useRef(0);
  /** Tras cobrar: carrito vacío debe guardarse ya; si no, Realtime puede devolver el borrador con ítems y “revivir” el carrito. */
  const hadCartItemsRef = useRef(false);

  useEffect(() => {
    readyRef.current = false;
    lastSignatureRef.current = '';
    lastRemoteUpdatedAtMsRef.current = 0;
    if (!userId || !sucursalId) {
      replaceCartDraft(null);
      hadCartItemsRef.current = false;
      return;
    }

    let cancelled = false;
    const key = localBackupKey(userId, sucursalId);
    replaceCartDraft(null);

    const applyRemote = (draft: CartDraftSnapshot | null, remoteClockMs: number) => {
      if (cancelled) return;
      applyingRemoteRef.current = true;
      replaceCartDraft(draft);
      const sig = draft == null ? emptyDraftSignature() : snapshotSignature(draft);
      lastSignatureRef.current = sig;
      bumpRemoteClock(lastRemoteUpdatedAtMsRef, remoteClockMs);
      applyingRemoteRef.current = false;
      readyRef.current = true;
      hadCartItemsRef.current = (draft?.items?.length ?? 0) > 0;
    };

    const loadInitial = async () => {
      const cloud = await getPosCartDraftOnce(sucursalId, userId);
      if (cancelled) return;
      if (cloud?.cart) {
        applyRemote(cloud.cart, cloud.updatedAtMs);
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
          const parsed = JSON.parse(raw) as CartDraftSnapshot;
          applyRemote(parsed, Date.now());
          return;
        }
      } catch {
        /* noop */
      }
      applyRemote(null, Date.now());
    };

    void loadInitial();

    const unsub = subscribePosCartDraft(sucursalId, userId, (doc) => {
      if (!doc?.cart) return;
      const ts = doc.updatedAtMs;
      if (!Number.isFinite(ts)) return;
      if (ts <= lastRemoteUpdatedAtMsRef.current) return;
      const incomingSig = snapshotSignature(doc.cart);
      if (incomingSig === lastSignatureRef.current) {
        bumpRemoteClock(lastRemoteUpdatedAtMsRef, ts);
        return;
      }
      applyRemote(doc.cart, ts);
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
    if (sig === lastSignatureRef.current) {
      hadCartItemsRef.current = currentSnapshot.items.length > 0;
      return;
    }

    const hasItems = currentSnapshot.items.length > 0;
    const flushNow = hadCartItemsRef.current && !hasItems;
    hadCartItemsRef.current = hasItems;

    const persist = () => {
      void savePosCartDraft(sucursalId, userId, currentSnapshot)
        .then((wroteAt) => {
          lastSignatureRef.current = sig;
          bumpRemoteClock(lastRemoteUpdatedAtMsRef, wroteAt);
          try {
            localStorage.setItem(key, JSON.stringify(currentSnapshot));
          } catch {
            /* noop */
          }
        })
        .catch(() => {
          try {
            localStorage.setItem(key, JSON.stringify(currentSnapshot));
          } catch {
            /* noop */
          }
        });
    };

    if (flushNow) {
      persist();
      return;
    }

    const t = window.setTimeout(persist, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [currentSnapshot, userId, sucursalId]);
}
