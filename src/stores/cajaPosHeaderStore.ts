import { create } from 'zustand';

export type ModificarSaldoKind = 'aporte' | 'retiro';

type CajaPosHeaderState = {
  registered: boolean;
  cajaAbierta: boolean;
  loading: boolean;
  toggleCaja: () => void;
  modificarSaldoVisible: boolean;
  openModificarSaldo: (kind: ModificarSaldoKind) => void;
};

export const useCajaPosHeaderStore = create<CajaPosHeaderState>(() => ({
  registered: false,
  cajaAbierta: false,
  loading: false,
  toggleCaja: () => {},
  modificarSaldoVisible: false,
  openModificarSaldo: () => {},
}));

export function setCajaPosHeaderBridge(input: {
  cajaAbierta: boolean;
  loading: boolean;
  onToggle: () => void;
  /** Mostrar control de modificar saldo (p. ej. caja abierta). */
  modificarSaldoVisible?: boolean;
  onModificarSaldo?: (kind: ModificarSaldoKind) => void;
}) {
  useCajaPosHeaderStore.setState({
    registered: true,
    cajaAbierta: input.cajaAbierta,
    loading: input.loading,
    toggleCaja: input.onToggle,
    modificarSaldoVisible: input.modificarSaldoVisible ?? false,
    openModificarSaldo: input.onModificarSaldo ?? (() => {}),
  });
}

export function clearCajaPosHeaderBridge() {
  useCajaPosHeaderStore.setState({
    registered: false,
    cajaAbierta: false,
    loading: false,
    toggleCaja: () => {},
    modificarSaldoVisible: false,
    openModificarSaldo: () => {},
  });
}
