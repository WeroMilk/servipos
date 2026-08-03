// ============================================
// EXPORTS DE TODOS LOS STORES
// ============================================

export { useAuthStore, subscribeSupabaseAuth } from './authStore';
export { useSucursalContextStore } from './sucursalContextStore';
export { useAppStore, getResolvedIsDark, ACCENT_COLORS, isAccentColor, applyDomAccent } from './appStore';
export { useSyncStore } from './syncStore';
export { useCartStore } from './cartStore';
export { useClientPriceListStore } from './clientPriceListStore';
export { useInventoryListsStore } from './inventoryListsStore';
export {
  useLowStockAlertStore,
  lowStockAlertSucursalKey,
  selectLowStockBucket,
} from './lowStockAlertStore';
export type { LowStockAlertBucket } from './lowStockAlertStore';
