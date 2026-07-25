import type { CartItem, Promotion } from '@/types';
import { formatMoney } from '@/lib/utils';

/** Fecha local YYYY-MM-DD (zona del navegador / caja). */
export function todayYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isPromotionActiveOnDate(p: Promotion, ymd: string): boolean {
  if (!p.activa) return false;
  if (!p.fechaInicio || !p.fechaFin) return false;
  return p.fechaInicio <= ymd && ymd <= p.fechaFin;
}

export function promoLabel(p: Promotion): string {
  if (p.kind === 'fixed_price') {
    const v = Number(p.fixedPrice);
    if (Number.isFinite(v) && v >= 0) return formatMoney(v);
    return 'Precio fijo';
  }
  if (p.kind === 'percent') return `−${Math.round(Number(p.percent) || 0)}%`;
  if (p.kind === 'nxm') {
    const b = Number(p.buyQty) || 0;
    const pay = Number(p.payQty) || 0;
    return `${b}x${pay}`;
  }
  if (p.kind === 'nth_half') return '2.º ½';
  return p.nombre || 'Promo';
}

/**
 * Descuento % efectivo sobre el subtotal de la línea (todas las unidades al mismo unitario).
 * - fixed_price: 0 (el precio se aplica con `precioUnitarioOverride`)
 * - percent: el % directo
 * - nxm buy/pay: por cada buyQty unidades, se pagan payQty → % = 100 * (1 - pay/buy) sobre grupos completos + resto sin descuento
 * - nth_half everyNth=2: en cada par, la 2.ª al 50% → 25% sobre el par completo; resto 1 sin descuento
 */
export function effectiveDiscountPercentForQty(p: Promotion, quantity: number): number {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (qty <= 0) return 0;

  if (p.kind === 'fixed_price') return 0;

  if (p.kind === 'percent') {
    const pct = Number(p.percent) || 0;
    return Math.min(100, Math.max(0, pct));
  }

  if (p.kind === 'nxm') {
    const buy = Math.max(1, Math.floor(Number(p.buyQty) || 2));
    const pay = Math.max(0, Math.min(buy, Math.floor(Number(p.payQty) || 1)));
    const groups = Math.floor(qty / buy);
    const rem = qty % buy;
    const paidUnits = groups * pay + rem;
    if (qty <= 0) return 0;
    return Math.round((1 - paidUnits / qty) * 10000) / 100;
  }

  if (p.kind === 'nth_half') {
    const every = Math.max(2, Math.floor(Number(p.everyNth) || 2));
    const halfCount = Math.floor(qty / every);
    if (qty <= 0 || halfCount <= 0) return 0;
    const discountFraction = (halfCount * 0.5) / qty;
    return Math.round(discountFraction * 10000) / 100;
  }

  return 0;
}

/** Mapa productId → promo vigente (primera / única por exclusividad). */
export function buildActivePromoByProductId(
  promotions: Promotion[],
  ymd: string = todayYmd()
): Map<string, Promotion> {
  const map = new Map<string, Promotion>();
  for (const p of promotions) {
    if (!isPromotionActiveOnDate(p, ymd)) continue;
    for (const pid of p.productIds) {
      if (!map.has(pid)) map.set(pid, p);
    }
  }
  return map;
}

function clearAutoPromoFields(item: CartItem): CartItem {
  const next: CartItem = {
    ...item,
    discount: 0,
    promoId: undefined,
    promoLabel: undefined,
  };
  // Si la promo anterior fijaba precio, quitar el override automático.
  if (item.promoId) {
    next.precioUnitarioOverride = undefined;
  }
  return next;
}

/**
 * Aplica promociones a líneas del carrito.
 * No pisa líneas con `discountManual`.
 * Limpia promo si el producto ya no tiene promo vigente.
 */
export function applyPromotionsToCartItems(
  items: CartItem[],
  promotions: Promotion[],
  ymd: string = todayYmd()
): CartItem[] {
  const byProduct = buildActivePromoByProductId(promotions, ymd);

  return items.map((item) => {
    if (item.discountManual) {
      return {
        ...item,
        promoId: undefined,
        promoLabel: undefined,
      };
    }

    const promo = byProduct.get(item.product.id);
    if (!promo) {
      if (!item.promoId && !(Number(item.discount) > 0)) return item;
      if (item.promoId) return clearAutoPromoFields(item);
      return item;
    }

    const label = promoLabel(promo);

    if (promo.kind === 'fixed_price') {
      const fixed = Number(promo.fixedPrice);
      if (!Number.isFinite(fixed) || fixed < 0) {
        if (item.promoId) return clearAutoPromoFields(item);
        return item;
      }
      const rounded = Math.round(fixed * 100) / 100;
      if (
        item.promoId === promo.id &&
        item.promoLabel === label &&
        !(Number(item.discount) > 0) &&
        item.precioUnitarioOverride != null &&
        Math.abs(Number(item.precioUnitarioOverride) - rounded) < 0.001
      ) {
        return item;
      }
      return {
        ...item,
        discount: 0,
        precioUnitarioOverride: rounded,
        precioListaId: undefined,
        promoId: promo.id,
        promoLabel: label,
        discountManual: false,
      };
    }

    const pct = effectiveDiscountPercentForQty(promo, item.quantity);
    if (
      item.promoId === promo.id &&
      item.promoLabel === label &&
      Math.abs((Number(item.discount) || 0) - pct) < 0.001 &&
      item.precioUnitarioOverride == null
    ) {
      return item;
    }
    return {
      ...item,
      discount: pct,
      // Quitar override si venía de una promo de precio fijo anterior.
      precioUnitarioOverride: item.promoId ? undefined : item.precioUnitarioOverride,
      promoId: promo.id,
      promoLabel: label,
      discountManual: false,
    };
  });
}
