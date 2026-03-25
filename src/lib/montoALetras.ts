/** Convierte entero 1–999 a letra (mayúsculas, estilo recibo MX). Vacío si n === 0. */
function menoresMil(n: number): string {
  if (n <= 0) return '';
  if (n === 100) return 'CIEN';

  const u = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const diez = [
    'DIEZ',
    'ONCE',
    'DOCE',
    'TRECE',
    'CATORCE',
    'QUINCE',
    'DIECISÉIS',
    'DIECISIETE',
    'DIECIOCHO',
    'DIECINUEVE',
  ];
  const dec = [
    '',
    '',
    'VEINTE',
    'TREINTA',
    'CUARENTA',
    'CINCUENTA',
    'SESENTA',
    'SETENTA',
    'OCHENTA',
    'NOVENTA',
  ];
  const veinti = [
    '',
    'VEINTIUNO',
    'VEINTIDÓS',
    'VEINTITRÉS',
    'VEINTICUATRO',
    'VEINTICINCO',
    'VEINTISÉIS',
    'VEINTISIETE',
    'VEINTIOCHO',
    'VEINTINUEVE',
  ];
  const cen = [
    '',
    'CIENTO',
    'DOSCIENTOS',
    'TRESCIENTOS',
    'CUATROCIENTOS',
    'QUINIENTOS',
    'SEISCIENTOS',
    'SETECIENTOS',
    'OCHOCIENTOS',
    'NOVECIENTOS',
  ];

  const c = Math.floor(n / 100);
  const r = n % 100;
  const d = Math.floor(r / 10);
  const un = r % 10;
  const parts: string[] = [];
  if (c > 0) parts.push(cen[c]);
  if (r > 0) {
    if (r < 10) parts.push(u[un]);
    else if (r < 20) parts.push(diez[un]);
    else if (d === 2 && un > 0) parts.push(veinti[un]);
    else if (un === 0) parts.push(dec[d]);
    else parts.push(`${dec[d]} Y ${u[un]}`);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function enteroALetra(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'CERO';
  if (n === 0) return 'CERO';
  const max = 999_999_999;
  const ent = Math.min(Math.floor(n), max);
  const mill = Math.floor(ent / 1_000_000);
  const mil = Math.floor((ent % 1_000_000) / 1000);
  const u = ent % 1000;
  const chunks: string[] = [];
  if (mill > 0) {
    if (mill === 1) chunks.push('UN MILLÓN');
    else chunks.push(`${menoresMil(mill)} MILLONES`);
  }
  if (mil > 0) {
    if (mil === 1) chunks.push('MIL');
    else chunks.push(`${menoresMil(mil)} MIL`);
  }
  if (u > 0) chunks.push(menoresMil(u));
  return chunks.join(' ').replace(/\s+/g, ' ').trim() || 'CERO';
}

/**
 * Importe en letra para leyenda "TOTAL CON LETRA" en CFDI (pesos mexicanos).
 */
export function montoALetrasMXN(amount: number): string {
  if (!Number.isFinite(amount)) return 'CERO PESOS 00/100 M.N.';
  const sign = amount < 0 ? 'MENOS ' : '';
  const abs = Math.abs(amount);
  const centavos = Math.min(99, Math.round((abs % 1) * 100 + Number.EPSILON));
  const entero = Math.floor(abs + 1e-9);
  const letras = enteroALetra(entero);
  const c = String(centavos).padStart(2, '0');
  return `${sign}${letras} PESOS ${c}/100 M.N.`;
}
