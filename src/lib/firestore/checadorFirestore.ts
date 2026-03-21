import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ChecadorDiaRegistro, User } from '@/types';
import { getMexicoDateKey, quincenaIdFromDateKey } from '@/lib/quincenaMx';

const COL = 'checadorRegistros';

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (
    v &&
    typeof v === 'object' &&
    'toDate' in v &&
    typeof (v as { toDate: () => Date }).toDate === 'function'
  ) {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return null;
}

export function checadorDocId(userId: string, dateKey: string): string {
  return `${userId}_${dateKey}`;
}

/** Tienda que debe quedar en el registro: contexto de trabajo (p. ej. selector admin) o perfil. */
export function resolveRegistroSucursalId(user: User, effectiveSucursalId?: string): string | null {
  const ctx = effectiveSucursalId?.trim();
  if (ctx) return ctx;
  const p = user.sucursalId?.trim();
  return p || null;
}

/** Filtra fichajes de la quincena a la tienda indicada (campo en doc o perfil en `users` si es legado sin tienda). */
export function filterChecadorRowsBySucursal(
  rows: ChecadorDiaRegistro[],
  sucursalId: string,
  userSucursalByUid: ReadonlyMap<string, string | undefined>
): ChecadorDiaRegistro[] {
  const sid = sucursalId.trim();
  if (!sid) return rows;
  return rows.filter((row) => {
    const onRecord = row.sucursalId?.trim();
    if (onRecord) return onRecord === sid;
    const fromProfile = userSucursalByUid.get(row.userId)?.trim();
    return !!fromProfile && fromProfile === sid;
  });
}

export function docToChecadorDia(id: string, d: Record<string, unknown>): ChecadorDiaRegistro {
  return {
    id,
    userId: String(d.userId ?? ''),
    userName: String(d.userName ?? ''),
    userEmail: String(d.userEmail ?? ''),
    dateKey: String(d.dateKey ?? ''),
    quincenaId: String(d.quincenaId ?? ''),
    sucursalId: typeof d.sucursalId === 'string' ? d.sucursalId : undefined,
    entrada: tsToDate(d.entrada),
    salidaComer: tsToDate(d.salidaComer),
    regresoComer: tsToDate(d.regresoComer),
    cierre: tsToDate(d.cierre),
  };
}

export function subscribeChecadorDia(
  userId: string,
  dateKey: string,
  onData: (row: ChecadorDiaRegistro | null) => void
): Unsubscribe {
  const id = checadorDocId(userId, dateKey);
  const ref = doc(db, COL, id);
  let unsubscribe: Unsubscribe = () => {};
  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(docToChecadorDia(snap.id, snap.data() as Record<string, unknown>));
    },
    (err) => {
      const code = (err as { code?: string })?.code;
      if (code !== 'permission-denied') {
        console.error('checador día:', err);
      }
      onData(null);
      unsubscribe();
    }
  );
  return unsubscribe;
}

export async function punchEntrada(user: User, effectiveSucursalId?: string): Promise<void> {
  const dateKey = getMexicoDateKey();
  const quincenaId = quincenaIdFromDateKey(dateKey);
  const id = checadorDocId(user.id, dateKey);
  const ref = doc(db, COL, id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data();
    if (d?.entrada && !d?.cierre) {
      throw new Error('Ya registró su entrada hoy');
    }
    if (d?.cierre) {
      throw new Error(
        'La jornada está cerrada. Use «Iniciar jornada de nuevo» para registrar otro turno el mismo día.'
      );
    }
  }
  await setDoc(
    ref,
    {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      dateKey,
      quincenaId,
      sucursalId: resolveRegistroSucursalId(user, effectiveSucursalId),
      entrada: serverTimestamp(),
      salidaComer: null,
      regresoComer: null,
      cierre: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function punchSalidaComer(user: User): Promise<void> {
  const dateKey = getMexicoDateKey();
  const id = checadorDocId(user.id, dateKey);
  const ref = doc(db, COL, id);
  const snap = await getDoc(ref);
  const data = snap.data();
  if (!snap.exists() || !data?.entrada) {
    throw new Error('Registre su entrada primero');
  }
  if (data.cierre) {
    throw new Error('El día ya está cerrado');
  }
  if (data.salidaComer) {
    throw new Error('Ya registró salida a comer');
  }
  await updateDoc(ref, {
    salidaComer: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function punchRegresoComer(user: User): Promise<void> {
  const dateKey = getMexicoDateKey();
  const id = checadorDocId(user.id, dateKey);
  const ref = doc(db, COL, id);
  const snap = await getDoc(ref);
  const data = snap.data();
  if (!snap.exists() || !data?.salidaComer) {
    throw new Error('Registre salida a comer primero');
  }
  if (data.regresoComer) {
    throw new Error('Ya registró su regreso de comer');
  }
  if (data.cierre) {
    throw new Error('El día ya está cerrado');
  }
  await updateDoc(ref, {
    regresoComer: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Borra los registros del día para volver a fichar (misma fecha, tras haber cerrado). */
export async function reiniciarJornadaMismoDia(user: User, effectiveSucursalId?: string): Promise<void> {
  const dateKey = getMexicoDateKey();
  const quincenaId = quincenaIdFromDateKey(dateKey);
  const id = checadorDocId(user.id, dateKey);
  const ref = doc(db, COL, id);
  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data()?.cierre) {
    throw new Error('Solo puede reiniciar después de cerrar la jornada');
  }
  const prev = snap.data() as Record<string, unknown>;
  const bloque = {
    entrada: prev.entrada ?? null,
    salidaComer: prev.salidaComer ?? null,
    regresoComer: prev.regresoComer ?? null,
    cierre: prev.cierre ?? null,
  };
  await setDoc(
    ref,
    {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      dateKey,
      quincenaId,
      sucursalId: resolveRegistroSucursalId(user, effectiveSucursalId),
      jornadasCompletadas: arrayUnion(bloque),
      entrada: null,
      salidaComer: null,
      regresoComer: null,
      cierre: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function punchCierre(user: User): Promise<void> {
  const dateKey = getMexicoDateKey();
  const id = checadorDocId(user.id, dateKey);
  const ref = doc(db, COL, id);
  const snap = await getDoc(ref);
  const data = snap.data();
  if (!snap.exists() || !data?.entrada) {
    throw new Error('Registre su entrada primero');
  }
  if (data.salidaComer && !data.regresoComer) {
    throw new Error('Regrese de comer antes de cerrar el día');
  }
  if (data.cierre) {
    throw new Error('El día ya está cerrado');
  }
  await updateDoc(ref, {
    cierre: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function fetchChecadorByQuincena(quincenaId: string): Promise<ChecadorDiaRegistro[]> {
  const q = query(
    collection(db, COL),
    where('quincenaId', '==', quincenaId),
    orderBy('dateKey', 'desc'),
    limit(500)
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((s) => docToChecadorDia(s.id, s.data() as Record<string, unknown>));
  list.sort((a, b) => {
    const dc = b.dateKey.localeCompare(a.dateKey);
    if (dc !== 0) return dc;
    return a.userName.localeCompare(b.userName, 'es', { sensitivity: 'base' });
  });
  return list;
}
