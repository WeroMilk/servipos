import { create } from 'zustand';

export type InventarioHeaderBridge = {
  onHistorial: () => void;
  onTicketStockBajo: () => void;
  onDescargar: () => void;
  onDescargarWord: () => void;
  onNuevo: () => void;
  descargarDisabled: boolean;
  exportingInventario: boolean;
};

type InventarioHeaderState = InventarioHeaderBridge & { registered: boolean };

const noop = () => {};

const initial: InventarioHeaderState = {
  registered: false,
  onHistorial: noop,
  onTicketStockBajo: noop,
  onDescargar: noop,
  onDescargarWord: noop,
  onNuevo: noop,
  descargarDisabled: true,
  exportingInventario: false,
};

export const useInventarioHeaderStore = create<InventarioHeaderState>(() => ({ ...initial }));

export function setInventarioHeaderBridge(b: InventarioHeaderBridge) {
  useInventarioHeaderStore.setState({ registered: true, ...b });
}

export function clearInventarioHeaderBridge() {
  useInventarioHeaderStore.setState({ ...initial });
}
