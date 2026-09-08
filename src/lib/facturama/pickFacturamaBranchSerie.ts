/** Elige sucursal y serie Facturama según CP de expedición. */

export type FacturamaBranchLite = {
  Id?: string;
  IsDefault?: boolean;
  Address?: { ZipCode?: string | number };
};

export type FacturamaSerieLite = {
  Name?: string;
};

export function normalizeFacturamaSerieName(raw: string | undefined | null): string {
  const t = String(raw ?? '').trim();
  if (!/^[a-zA-Z0-9]{1,10}$/.test(t)) return '';
  return t;
}

export function pickFacturamaBranchByZip(
  branches: FacturamaBranchLite[],
  zip: string
): FacturamaBranchLite | null {
  const z = String(zip ?? '').trim();
  if (!branches.length) return null;
  const byZip = branches.find((b) => String(b.Address?.ZipCode ?? '').trim() === z && b.Id);
  if (byZip) return byZip;
  const def = branches.find((b) => b.IsDefault && b.Id);
  if (def) return def;
  return branches.find((b) => b.Id) ?? null;
}

export function pickFacturamaSerieName(
  series: FacturamaSerieLite[],
  preferred?: string | null
): string | null {
  const names = series
    .map((s) => normalizeFacturamaSerieName(s.Name))
    .filter(Boolean);
  if (!names.length) return null;
  const pref = normalizeFacturamaSerieName(preferred);
  if (pref) {
    const hit = names.find((n) => n.toUpperCase() === pref.toUpperCase());
    if (hit) return hit;
  }
  return names.find((n) => n.toUpperCase() === 'A') ?? names[0] ?? null;
}
