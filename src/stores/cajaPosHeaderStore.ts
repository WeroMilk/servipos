import { create } from 'zustand';

type CajaPosHeaderState = {
  registered: boolean;
  cajaAbierta: boolean;
  loading: boolean;
  toggleCaja: () => void;
};

export const useCajaPosHeaderStore = create<CajaPosHeaderState>(() => ({
  registered: false,
  cajaAbierta: false,
  loading: false,
  toggleCaja: () => {},
}));

export function setCajaPosHeaderBridge(input: {
  cajaAbierta: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  useCajaPosHeaderStore.setState({
    registered: true,
    cajaAbierta: input.cajaAbierta,
    loading: input.loading,
    toggleCaja: input.onToggle,
  });
}

export function clearCajaPosHeaderBridge() {
  useCajaPosHeaderStore.setState({
    registered: false,
    cajaAbierta: false,
    loading: false,
    toggleCaja: () => {},
  });
}
