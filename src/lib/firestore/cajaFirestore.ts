import {
  arrayUnion,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CajaRetiroEfectivo, CajaSesion } from '@/types';
import {
  computeCajaEfectivoEsperado,
  efectivoEsperadoMenosRetiros,
  filterVentasCompletadasSesion,
  resumenBrutoSesion,
} from '@/lib/cajaResumen';
import { fetchSalesByCajaSesion } from '@/lib/firestore/salesFirestore';

function cajaEstadoRef(sucursalId: string) {
  return doc(db, 'sucursales', sucursalId, 'cajaEstado', 'current');
}

function cajaSesionRef(sucursalId: string, sesionId: string) {
  return doc(db, 'sucursales', sucursalId, 'cajaSesiones', sesionId);
}

function firestoreTimestampToDate(value: unknown): Date {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date();
}

function parseRetirosEfectivoFirestore(raw: unknown): CajaRetiroEfectivo[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CajaRetiroEfectivo[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? '');
    const monto = Number(o.monto) || 0;
    if (!id || monto <= 0) continue;
    out.push({
      id,
      monto,
      notas: o.notas != null && String(o.notas).trim() ? String(o.notas).trim() : undefined,
      createdAt: firestoreTimestampToDate(o.createdAt),
      usuarioId: String(o.usuarioId ?? ''),
      usuarioNombre: String(o.usuarioNombre ?? ''),
    });
  }
  return out.length > 0 ? out : undefined;
}

function mapCajaSesionDoc(
  sucursalId: string,
  sesionId: string,
  d: Record<string, unknown>
): CajaSesion {
  return {
    id: sesionId,
    estado: d.estado === 'cerrada' ? 'cerrada' : 'abierta',
    fondoInicial: Number(d.fondoInicial) || 0,
    retirosEfectivoTotal:
      d.retirosEfectivoTotal != null ? Number(d.retirosEfectivoTotal) || 0 : undefined,
    retirosEfectivo: parseRetirosEfectivoFirestore(d.retirosEfectivo),
    openedAt: firestoreTimestampToDate(d.openedAt),
    openedByUserId: String(d.openedByUserId ?? ''),
    openedByNombre: String(d.openedByNombre ?? ''),
    closedAt: d.closedAt != null ? firestoreTimestampToDate(d.closedAt) : undefined,
    closedByUserId: d.closedByUserId != null ? String(d.closedByUserId) : undefined,
    closedByNombre: d.closedByNombre != null ? String(d.closedByNombre) : undefined,
    conteoDeclarado: d.conteoDeclarado != null ? Number(d.conteoDeclarado) : undefined,
    efectivoEsperado: d.efectivoEsperado != null ? Number(d.efectivoEsperado) : undefined,
    diferencia: d.diferencia != null ? Number(d.diferencia) : undefined,
    notasCierre: d.notasCierre != null ? String(d.notasCierre) : undefined,
    ticketsCompletados: d.ticketsCompletados != null ? Number(d.ticketsCompletados) : undefined,
    totalVentasBruto: d.totalVentasBruto != null ? Number(d.totalVentasBruto) : undefined,
    sucursalId,
  };
}

/**
 * Suscripción a la sesión de caja abierta (si existe). `null` si la caja está cerrada o sin sesión.
 */
export function subscribeCajaSesionAbierta(
  sucursalId: string,
  cb: (session: CajaSesion | null) => void
): Unsubscribe {
  const estRef = cajaEstadoRef(sucursalId);
  let unsubSesion: Unsubscribe | null = null;

  const unsubEst = onSnapshot(
    estRef,
    (estSnap) => {
      unsubSesion?.();
      unsubSesion = null;

      const openIdRaw = estSnap.data()?.sesionAbiertaId;
      const openId = typeof openIdRaw === 'string' ? openIdRaw.trim() : '';
      if (!openId) {
        cb(null);
        return;
      }

      const sRef = cajaSesionRef(sucursalId, openId);
      unsubSesion = onSnapshot(
        sRef,
        (sSnap) => {
          if (!sSnap.exists()) {
            cb(null);
            return;
          }
          const mapped = mapCajaSesionDoc(sucursalId, openId, sSnap.data() as Record<string, unknown>);
          cb(mapped.estado === 'abierta' ? mapped : null);
        },
        () => {
          cb(null);
        }
      );
    },
    () => {
      unsubSesion?.();
      unsubSesion = null;
      cb(null);
    }
  );

  return () => {
    unsubSesion?.();
    unsubEst();
  };
}

export async function openCajaSessionFirestore(
  sucursalId: string,
  input: {
    fondoInicial: number;
    openedByUserId: string;
    openedByNombre: string;
  }
): Promise<{ id: string }> {
  const estRef = cajaEstadoRef(sucursalId);
  const newSesionRef = doc(db, 'sucursales', sucursalId, 'cajaSesiones', crypto.randomUUID());

  await runTransaction(db, async (transaction) => {
    const estSnap = await transaction.get(estRef);
    const openIdRaw = estSnap.exists() ? (estSnap.data() as Record<string, unknown>).sesionAbiertaId : null;
    const openId = typeof openIdRaw === 'string' ? openIdRaw.trim() : '';

    if (openId) {
      const prevRef = cajaSesionRef(sucursalId, openId);
      const prevSnap = await transaction.get(prevRef);
      if (prevSnap.exists()) {
        const st = (prevSnap.data() as Record<string, unknown>).estado;
        if (st === 'abierta') {
          const nom = String((prevSnap.data() as Record<string, unknown>).openedByNombre ?? 'Otro usuario');
          throw new Error(
            `Ya hay una caja abierta (registrada por ${nom}). Cierre esa sesión antes de abrir otra.`
          );
        }
      }
    }

    transaction.set(newSesionRef, {
      estado: 'abierta',
      fondoInicial: Math.max(0, Number(input.fondoInicial) || 0),
      openedAt: serverTimestamp(),
      openedByUserId: input.openedByUserId,
      openedByNombre: input.openedByNombre.trim() || 'Usuario',
      updatedAt: serverTimestamp(),
    });

    transaction.set(
      estRef,
      {
        sesionAbiertaId: newSesionRef.id,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { id: newSesionRef.id };
}

export async function closeCajaSessionFirestore(
  sucursalId: string,
  sesionId: string,
  input: {
    conteoDeclarado: number;
    notasCierre?: string;
    closedByUserId: string;
    closedByNombre: string;
  }
): Promise<void> {
  const sid = sesionId.trim();
  if (!sid) throw new Error('Sesión inválida');

  const ventas = await fetchSalesByCajaSesion(sucursalId, sid);
  const completadas = filterVentasCompletadasSesion(ventas);
  const { tickets, total } = resumenBrutoSesion(ventas);

  const estRef = cajaEstadoRef(sucursalId);
  const sRef = cajaSesionRef(sucursalId, sid);

  await runTransaction(db, async (transaction) => {
    // Firestore (SDK web/móvil): todas las lecturas deben ir antes de cualquier escritura.
    const sSnap = await transaction.get(sRef);
    const estSnap = await transaction.get(estRef);

    if (!sSnap.exists()) throw new Error('Sesión de caja no encontrada');
    const data = sSnap.data() as Record<string, unknown>;
    if (data.estado !== 'abierta') throw new Error('Esta sesión de caja ya está cerrada');

    const fondo = Number(data.fondoInicial) || 0;
    const retirosTotal = Number(data.retirosEfectivoTotal) || 0;
    const { esperadoEnCaja: esperadoBruto } = computeCajaEfectivoEsperado(fondo, completadas);
    const esperadoEnCaja = efectivoEsperadoMenosRetiros(esperadoBruto, retirosTotal);
    const declarado = Number(input.conteoDeclarado);
    if (!Number.isFinite(declarado) || declarado < 0) {
      throw new Error('Indique un conteo de efectivo válido');
    }
    const diferencia = Math.round((declarado - esperadoEnCaja) * 100) / 100;

    const curOpen = estSnap.exists()
      ? String((estSnap.data() as Record<string, unknown>).sesionAbiertaId ?? '').trim()
      : '';

    transaction.update(sRef, {
      estado: 'cerrada',
      closedAt: serverTimestamp(),
      closedByUserId: input.closedByUserId,
      closedByNombre: input.closedByNombre.trim() || 'Usuario',
      conteoDeclarado: declarado,
      efectivoEsperado: esperadoEnCaja,
      diferencia,
      notasCierre: input.notasCierre?.trim() || null,
      ticketsCompletados: tickets,
      totalVentasBruto: total,
      updatedAt: serverTimestamp(),
    });

    if (curOpen === sid) {
      transaction.set(
        estRef,
        {
          sesionAbiertaId: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  });
}

/** Lectura puntual (p. ej. imprimir último cierre). */
export async function getCajaSesionFirestore(
  sucursalId: string,
  sesionId: string
): Promise<CajaSesion | null> {
  const snap = await getDoc(cajaSesionRef(sucursalId, sesionId.trim()));
  if (!snap.exists()) return null;
  return mapCajaSesionDoc(sucursalId, snap.id, snap.data() as Record<string, unknown>);
}

/** Registra retiro de efectivo del cajón (sesión abierta). Actualiza totales para el cierre de caja. */
export async function registrarRetiroEfectivoFirestore(
  sucursalId: string,
  sesionId: string,
  input: {
    monto: number;
    notas?: string;
    usuarioId: string;
    usuarioNombre: string;
  }
): Promise<void> {
  const sid = sesionId.trim();
  if (!sid) throw new Error('Sesión inválida');
  const monto = Math.round(Math.max(0, Number(input.monto) || 0) * 100) / 100;
  if (monto <= 0) throw new Error('Indique un monto mayor a cero');

  const sRef = cajaSesionRef(sucursalId, sid);
  const item = {
    id: crypto.randomUUID(),
    monto,
    notas: input.notas?.trim() || null,
    createdAt: serverTimestamp(),
    usuarioId: input.usuarioId,
    usuarioNombre: input.usuarioNombre.trim() || 'Usuario',
  };

  await runTransaction(db, async (transaction) => {
    const sSnap = await transaction.get(sRef);
    if (!sSnap.exists()) throw new Error('Sesión de caja no encontrada');
    const d = sSnap.data() as Record<string, unknown>;
    if (d.estado !== 'abierta') throw new Error('La caja no está abierta; no se puede registrar el retiro');

    transaction.update(sRef, {
      retirosEfectivoTotal: increment(monto),
      retirosEfectivo: arrayUnion(item),
      updatedAt: serverTimestamp(),
    });
  });
}
