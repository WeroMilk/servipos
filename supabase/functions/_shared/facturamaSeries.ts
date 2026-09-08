import type { FacturamaClientConfig } from './facturamaClient.ts';
import { facturamaRequest } from './facturamaClient.ts';

type BranchLite = {
  Id?: string;
  IsDefault?: boolean;
  Address?: { ZipCode?: string | number };
};

type SerieLite = {
  Name?: string;
};

function normalizeSerieName(raw: string | undefined | null): string {
  const t = String(raw ?? '').trim();
  if (!/^[a-zA-Z0-9]{1,10}$/.test(t)) return '';
  return t;
}

function pickBranchByZip(branches: BranchLite[], zip: string): BranchLite | null {
  const z = String(zip ?? '').trim();
  if (!branches.length) return null;
  const byZip = branches.find((b) => String(b.Address?.ZipCode ?? '').trim() === z && b.Id);
  if (byZip) return byZip;
  const def = branches.find((b) => b.IsDefault && b.Id);
  if (def) return def;
  return branches.find((b) => b.Id) ?? null;
}

function pickSerieName(series: SerieLite[], preferred?: string | null): string | null {
  const names = series.map((s) => normalizeSerieName(s.Name)).filter(Boolean);
  if (!names.length) return null;
  const pref = normalizeSerieName(preferred);
  if (pref) {
    const hit = names.find((n) => n.toUpperCase() === pref.toUpperCase());
    if (hit) return hit;
  }
  return names.find((n) => n.toUpperCase() === 'A') ?? names[0] ?? null;
}

async function listBranches(cfg: FacturamaClientConfig): Promise<BranchLite[]> {
  const { data } = await facturamaRequest(cfg, 'GET', '/BranchOffice');
  return Array.isArray(data) ? (data as BranchLite[]) : [];
}

async function listSeries(cfg: FacturamaClientConfig, branchId: string): Promise<SerieLite[]> {
  const { data } = await facturamaRequest(cfg, 'GET', `/serie/${encodeURIComponent(branchId)}`);
  return Array.isArray(data) ? (data as SerieLite[]) : [];
}

async function createSerie(
  cfg: FacturamaClientConfig,
  branchId: string,
  name: string
): Promise<void> {
  await facturamaRequest(cfg, 'POST', `/serie/${encodeURIComponent(branchId)}`, {
    IdBranchOffice: branchId,
    Name: name,
    Description: `SERIE ${name}`,
    Folio: 1,
  });
}

/**
 * Facturama exige que `Serie` exista en la sucursal del CP de expedición.
 * Si no hay serie, se crea `A` (o la preferida) en esa sucursal.
 * No se envía Folio: lo asigna Facturama.
 */
export async function ensureCfdiSerieOnBranch(
  cfg: FacturamaClientConfig,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const next = { ...payload };
  delete next.Folio;
  delete next.folio;

  const cp = String(next.ExpeditionPlace ?? '').trim();
  if (!/^\d{5}$/.test(cp)) return next;

  const branches = await listBranches(cfg);
  const branch = pickBranchByZip(branches, cp);
  const branchId = typeof branch?.Id === 'string' ? branch.Id.trim() : '';
  if (!branchId) {
    throw new Error(
      `No hay sucursal en Facturama para el CP ${cp}. Créela en Facturama → Lugares de expedición.`
    );
  }

  const preferred = normalizeSerieName(String(next.Serie ?? next.serie ?? '')) || 'A';
  delete next.serie;

  let series = await listSeries(cfg, branchId);
  let name = pickSerieName(series, preferred);
  if (!name) {
    await createSerie(cfg, branchId, preferred);
    series = await listSeries(cfg, branchId);
    name = pickSerieName(series, preferred) || preferred;
  } else if (
    preferred &&
    !series.some((s) => normalizeSerieName(s.Name).toUpperCase() === preferred.toUpperCase())
  ) {
    try {
      await createSerie(cfg, branchId, preferred);
      name = preferred;
    } catch {
      /* usar la serie que sí existe en la sucursal */
    }
  }

  next.Serie = name;
  return next;
}
