// ============================================
// EXPORTS DE TODOS LOS HOOKS
// ============================================

export { useProducts, useProductSearch, useLowStockProducts } from './useProducts';
export { useSales, useSalesByDateRange, useTodaySales, useSaleDetails } from './useSales';
export { useClients, useClientSearch, useClientDetails } from './useClients';
export { useQuotations, useQuotationDetails } from './useQuotations';
export { useInvoices, useInvoiceDetails, useNextFolio, useCFDIGenerator } from './useInvoices';
export { useFiscalConfig } from './useConfig';
export { useEffectiveSucursalId } from './useEffectiveSucursalId';
export { usePendingIncomingTransfers, useOutgoingPendingTransferIds } from './useStoreTransfers';
export { useDesktopWheelScrollEnhancer } from './useDesktopWheelScrollEnhancer';
