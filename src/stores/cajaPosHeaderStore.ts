import { create } from 'zustand';

type CajaPosHeaderState = {
  registered: boolean;
  cajaAbierta: boolean;
  loading: boolean;
  toggleCaja: () => void;
  retiroEfectivoVisible: boolean;
  openRetiroEfectivo: () => void;
};

export const useCajaPosHeaderStore = create<CajaPosHeaderState>(() => ({
  registered: false,
  cajaAbierta: false,
  loading: false,
  toggleCaja: () => {},
  retiroEfectivoVisible: false,
  openRetiroEfectivo: () => {},
}));

export function setCajaPosHeaderBridge(input: {
  cajaAbierta: boolean;
  loading: boolean;
  onToggle: () => void;
  /** Mostrar icono de retiro de efectivo (p. ej. caja abierta). */
  retiroEfectivoVisible?: boolean;
  onRetiroEfectivo?: () => void;
}) {
  useCajaPosHeaderStore.setState({
    registered: true,
    cajaAbierta: input.cajaAbierta,
    loading: input.loading,
    toggleCaja: input.onToggle,
    retiroEfectivoVisible: input.retiroEfectivoVisible ?? false,
    openRetiroEfectivo: input.onRetiroEfectivo ?? (() => {}),
  });
}

export function clearCajaPosHeaderBridge() {
  useCajaPosHeaderStore.setState({
    registered: false,
    cajaAbierta: false,
    loading: false,
    toggleCaja: () => {},
    retiroEfectivoVisible: false,
    openRetiroEfectivo: () => {},
  });
}
