import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Dinero con formato tipo $10,000.00 (coma miles, punto decimales).
 * Misma presentación en toda la app.
 */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/** @deprecated Usar formatMoney para consistencia visual */
export function formatMxCurrency(value: number): string {
  return formatMoney(value);
}
