import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { useAuthStore, useSucursalContextStore } from '@/stores';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createSucursalMeta,
  subscribeSucursalesCatalog,
} from '@/lib/firestore/sucursalesMetaFirestore';
import type { Sucursal } from '@/types';
import { cn } from '@/lib/utils';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useAppStore } from '@/stores';

function labelForSucursal(s: Sucursal): string {
  return s.codigo ? `${s.nombre} (${s.codigo})` : s.nombre;
}

/**
 * Selector de sucursal de trabajo para administradores (persistido en `sucursalContextStore`).
 * Lista solo tiendas definidas en Firestore; permite crear otra sin ir a Configuración.
 */
export function AdminSucursalSwitcher() {
  const user = useAuthStore((s) => s.user);
  const { addToast } = useAppStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const activeSucursalId = useSucursalContextStore((s) => s.activeSucursalId);
  const setActiveSucursalId = useSucursalContextStore((s) => s.setActiveSucursalId);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ docId: '', nombre: '', codigo: '' });
  const [saving, setSaving] = useState(false);

  const canSwitch = Boolean(user?.isActive && user.role === 'admin');

  useEffect(() => {
    if (!canSwitch) return;
    return subscribeSucursalesCatalog(setSucursales);
  }, [canSwitch]);

  const options = useMemo(() => {
    const active = sucursales.filter((s) => s.activo);
    const selected = activeSucursalId
      ? sucursales.find((s) => s.id === activeSucursalId)
      : null;
    if (activeSucursalId && selected && !selected.activo) {
      return [selected, ...active.filter((s) => s.id !== selected.id)];
    }
    return active;
  }, [sucursales, activeSucursalId]);

  /** Sin opción "automático": al cargar, fijar tienda explícita desde perfil o primera del catálogo. */
  useEffect(() => {
    if (!canSwitch || options.length === 0) return;
    if (activeSucursalId) return;
    const pick = effectiveSucursalId && options.some((s) => s.id === effectiveSucursalId)
      ? effectiveSucursalId
      : options[0]!.id;
    setActiveSucursalId(pick);
  }, [canSwitch, options, activeSucursalId, effectiveSucursalId, setActiveSucursalId]);

  const orphanOverride =
    activeSucursalId && !sucursales.some((s) => s.id === activeSucursalId);

  const resolvedSucursalId = useMemo(() => {
    if (activeSucursalId) return activeSucursalId;
    if (effectiveSucursalId) return effectiveSucursalId;
    const first = options[0]?.id;
    return first ?? '';
  }, [activeSucursalId, effectiveSucursalId, options]);

  const triggerLabel = useMemo(() => {
    const id = resolvedSucursalId;
    if (!id) return 'Elija tienda';
    const s = sucursales.find((x) => x.id === id);
    if (s) return labelForSucursal(s);
    return id.length > 18 ? `${id.slice(0, 12)}…` : id;
  }, [resolvedSucursalId, sucursales]);

  const openCreateDialog = useCallback(() => {
    setForm({ docId: '', nombre: '', codigo: '' });
    setDialogOpen(true);
  }, []);

  const handleCreateSucursal = async () => {
    if (!form.nombre.trim()) {
      addToast({ type: 'error', message: 'El nombre de la tienda es obligatorio' });
      return;
    }
    setSaving(true);
    try {
      const id = await createSucursalMeta({
        nombre: form.nombre,
        codigo: form.codigo.trim() || undefined,
        id: form.docId.trim() || undefined,
      });
      addToast({ type: 'success', message: 'Tienda creada' });
      setActiveSucursalId(id);
      setDialogOpen(false);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo crear la tienda',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!canSwitch) return null;

  return (
    <>
      <div className="flex min-w-0 max-w-full flex-1 items-center gap-0.5 sm:max-w-[20rem] sm:flex-none sm:gap-1 md:max-w-[min(24rem,100%)]">
        <MapPin className="hidden h-4 w-4 shrink-0 text-cyan-500/90 sm:block" aria-hidden />
        <Select
          value={resolvedSucursalId || (options[0]?.id ?? '')}
          onValueChange={(v) => setActiveSucursalId(v)}
        >
          <SelectTrigger
            className={cn(
              'h-9 min-w-0 flex-1 border-slate-300 bg-white text-xs text-slate-900 sm:text-sm dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100'
            )}
            aria-label="Tienda de trabajo"
          >
            <SelectValue placeholder="Elegir tienda">{triggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent
            position="popper"
            side="bottom"
            sideOffset={6}
            align="start"
            className="z-[140] max-h-[min(85dvh,22rem)] w-[var(--radix-select-trigger-width)] border-slate-200 bg-white data-[side=top]:max-h-[min(85dvh,22rem)] dark:border-slate-800 dark:bg-slate-900"
          >
            {orphanOverride && activeSucursalId ? (
              <SelectItem value={activeSucursalId} className="text-slate-900 dark:text-slate-100">
                Guardada: {activeSucursalId.slice(0, 10)}…
              </SelectItem>
            ) : null}
            {options.length === 0 && !orphanOverride ? (
              <div className="px-2 py-2 text-xs text-slate-600 dark:text-slate-500">
                No hay tiendas en el catálogo. Use + para crear la primera.
              </div>
            ) : (
              options.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-slate-900 dark:text-slate-100">
                  {labelForSucursal(s)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0 border-slate-300 bg-white text-cyan-600 hover:bg-slate-100 hover:text-cyan-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-cyan-400 dark:hover:bg-slate-800 dark:hover:text-cyan-300"
          aria-label="Nueva tienda"
          title="Nueva tienda"
          onClick={openCreateDialog}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-slate-100">Nueva tienda</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="asw-nombre" className="text-slate-700 dark:text-slate-300">
                Nombre <span className="text-red-400">*</span>
              </Label>
              <Input
                id="asw-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej. Matriz"
                className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800/80"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="asw-codigo" className="text-slate-700 dark:text-slate-300">
                Código (opcional)
              </Label>
              <Input
                id="asw-codigo"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                placeholder="Ej. MTZ-01"
                className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800/80"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="asw-id" className="text-slate-700 dark:text-slate-300">
                Id del documento (opcional)
              </Label>
              <Input
                id="asw-id"
                value={form.docId}
                onChange={(e) => setForm((f) => ({ ...f, docId: e.target.value }))}
                placeholder="Se genera a partir del nombre si lo deja vacío"
                className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800/80"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              className="text-slate-600 dark:text-slate-400"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
              onClick={() => void handleCreateSucursal()}
              disabled={saving}
            >
              {saving ? 'Guardando…' : 'Crear tienda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
