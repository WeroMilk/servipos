import { create } from 'zustand';

type VentasAbiertasPosHeaderState = {
  registered: boolean;
  count: number;
  openVentasAbiertasDialog: () => void;
};

export const useVentasAbiertasPosHeaderStore = create<VentasAbiertasPosHeaderState>(() => ({
  registered: false,
  count: 0,
  openVentasAbiertasDialog: () => {},
}));

export function setVentasAbiertasPosHeaderBridge(input: { count: number; onOpen: () => void }) {
  useVentasAbiertasPosHeaderStore.setState({
    registered: true,
    count: input.count,
    openVentasAbiertasDialog: input.onOpen,
  });
}

export function clearVentasAbiertasPosHeaderBridge() {
  useVentasAbiertasPosHeaderStore.setState({
    registered: false,
    count: 0,
    openVentasAbiertasDialog: () => {},
  });
}
