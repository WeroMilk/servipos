import { useEffect, useState } from 'react';
import type { IncomingStoreTransfer } from '@/types';
import {
  subscribePendingIncomingTransfers,
  subscribeOutgoingPendingTransferIds,
} from '@/lib/firestore/storeTransfersFirestore';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';

export function usePendingIncomingTransfers() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [list, setList] = useState<IncomingStoreTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!effectiveSucursalId) {
      setList([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribePendingIncomingTransfers(effectiveSucursalId, (rows) => {
      setList(rows);
      setLoading(false);
    });
  }, [effectiveSucursalId]);

  return { pendingIncoming: list, loading };
}

export function useOutgoingPendingTransferIds() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!effectiveSucursalId) {
      setIds(new Set());
      return;
    }
    return subscribeOutgoingPendingTransferIds(effectiveSucursalId, setIds);
  }, [effectiveSucursalId]);

  return ids;
}
