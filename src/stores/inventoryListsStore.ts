import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_INVENTORY_CATEGORIAS,
  DEFAULT_INVENTORY_PROVEEDORES,
} from '@/lib/defaultInventoryLists';

interface InventoryListsState {
  categorias: string[];
  proveedores: string[];
  setCategorias: (lines: string[]) => void;
  setProveedores: (lines: string[]) => void;
}

function normalizeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export const useInventoryListsStore = create<InventoryListsState>()(
  persist(
    (set) => ({
      categorias: [...DEFAULT_INVENTORY_CATEGORIAS],
      proveedores: [...DEFAULT_INVENTORY_PROVEEDORES],
      setCategorias: (lines) => set({ categorias: normalizeLines(lines) }),
      setProveedores: (lines) => set({ proveedores: normalizeLines(lines) }),
    }),
    {
      name: 'servipos-inventory-lists',
      partialize: (s) => ({ categorias: s.categorias, proveedores: s.proveedores }),
    }
  )
);
