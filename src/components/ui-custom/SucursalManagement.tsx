import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Sucursal } from '@/types';
import {
  createSucursalMeta,
  hardDeleteSucursal,
  reactivateSucursal,
  softDeleteSucursal,
  subscribeSucursalesCatalog,
  updateSucursalMeta,
} from '@/lib/firestore/sucursalesMetaFirestore';
import { useAppStore, useSucursalContextStore } from '@/stores';
import { cn } from '@/lib/utils';

type FormMode = 'create' | 'edit';

const emptyForm = { docId: '', nombre: '', codigo: '' };

type SucursalManagementProps = {
  embedded?: boolean;
};

export function SucursalManagement({ embedded = false }: SucursalManagementProps) {
  const { addToast } = useAppStore();
  const setActiveSucursalId = useSucursalContextStore((s) => s.setActiveSucursalId);
  const activeSucursalId = useSucursalContextStore((s) => s.activeSucursalId);
  const [list, setList] = useState<Sucursal[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [editing, setEditing] = useState<Sucursal | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deactivateTarget, setDeactivateTarget] = useState<Sucursal | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<Sucursal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sucursal | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    return subscribeSucursalesCatalog(setList);
  }, []);

  const visible = useMemo(
    () => (showInactive ? list : list.filter((s) => s.activo)),
    [list, showInactive]
  );

  const openCreate = () => {
    setMode('create');
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (s: Sucursal) => {
    setMode('edit');
    setEditing(s);
    setForm({ docId: '', nombre: s.nombre, codigo: s.codigo ?? '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) {
      addToast({ type: 'error', message: 'El nombre es obligatorio' });
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') {
        await createSucursalMeta({
          nombre: form.nombre,
          codigo: form.codigo.trim() || undefined,
          id: form.docId.trim() || undefined,
        });
        addToast({ type: 'success', message: 'Sucursal creada' });
      } else if (editing) {
        await updateSucursalMeta(editing.id, {
          nombre: form.nombre,
          codigo: form.codigo.trim() || null,
        });
        addToast({ type: 'success', message: 'Sucursal actualizada' });
      }
      setDialogOpen(false);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar',
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeactivate = useCallback(async () => {
    if (!deactivateTarget) return;
    try {
      await softDeleteSucursal(deactivateTarget.id);
      addToast({ type: 'success', message: 'Sucursal desactivada (los datos se conservan)' });
      setDeactivateTarget(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo desactivar',
      });
    }
  }, [addToast, deactivateTarget]);

  const confirmReactivate = useCallback(async () => {
    if (!reactivateTarget) return;
    try {
      await reactivateSucursal(reactivateTarget.id);
      addToast({ type: 'success', message: 'Sucursal reactivada' });
      setReactivateTarget(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo reactivar',
      });
    }
  }, [addToast, reactivateTarget]);

  const confirmHardDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await hardDeleteSucursal(deleteTarget.id);
      if (activeSucursalId === deleteTarget.id) setActiveSucursalId(null);
      addToast({ type: 'success', message: 'Sucursal eliminada por completo' });
      setDeleteTarget(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo eliminar',
      });
    } finally {
      setDeleting(false);
    }
  }, [addToast, deleteTarget, activeSucursalId, setActiveSucursalId]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
          <CardHeader
            className={cn(
              'flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0',
              embedded ? 'py-2' : 'gap-3 py-3'
            )}
          >
            <CardTitle
              className={cn(
                'flex items-center gap-2 text-slate-900 dark:text-slate-100',
                embedded && 'text-sm sm:text-base'
              )}
            >
              <Store className={cn('text-cyan-400', embedded ? 'h-4 w-4 sm:h-5 sm:w-5' : 'h-5 w-5')} />
              Sucursales
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-200/70 dark:bg-slate-800/40 px-2 py-1">
                <Label htmlFor="sm-inactive" className="cursor-pointer text-xs text-slate-600 dark:text-slate-400">
                  Ver inactivas
                </Label>
                <Switch
                  id="sm-inactive"
                  checked={showInactive}
                  onCheckedChange={setShowInactive}
                />
              </div>
              <Button
                type="button"
                size={embedded ? 'sm' : 'default'}
                onClick={openCreate}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
              >
                <Plus className="mr-2 h-4 w-4" />
                Nueva sucursal
              </Button>
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              'min-h-0 flex-1 overflow-auto pt-0',
              embedded ? 'p-2 sm:p-3 sm:pt-0' : 'p-3 sm:p-4 sm:pt-0'
            )}
          >
            <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200/80 dark:border-slate-800/60 [-webkit-overflow-scrolling:touch] touch-pan-x">
              <Table className={embedded ? 'text-sm' : undefined}>
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                    <TableHead className="text-slate-600 dark:text-slate-400">Nombre</TableHead>
                    <TableHead className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">Código</TableHead>
                    <TableHead className="text-slate-600 dark:text-slate-400">Id</TableHead>
                    <TableHead className="text-slate-600 dark:text-slate-400">Estado</TableHead>
                    <TableHead className="w-[168px] text-right text-slate-600 dark:text-slate-400">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-600 dark:text-slate-500">
                        No hay sucursales. Cree una para asignar empleados y datos por tienda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((s) => (
                      <TableRow key={s.id} className="border-slate-200 dark:border-slate-800/80">
                        <TableCell className="font-medium text-slate-800 dark:text-slate-200">{s.nombre}</TableCell>
                        <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                          {s.codigo || '—'}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate font-mono text-xs text-slate-600 dark:text-slate-500">
                          {s.id}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'text-xs font-medium',
                              s.activo ? 'text-emerald-400' : 'text-slate-600 dark:text-slate-500'
                            )}
                          >
                            {s.activo ? 'Activa' : 'Inactiva'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-600 dark:text-slate-400 hover:text-cyan-400"
                              onClick={() => openEdit(s)}
                              aria-label="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-600 dark:text-slate-400 hover:text-amber-400"
                              disabled={!s.activo}
                              onClick={() => setDeactivateTarget(s)}
                              aria-label="Desactivar"
                            >
                              <Ban className="h-4 w-4 opacity-70" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-600 dark:text-slate-400 hover:text-emerald-400"
                              disabled={s.activo}
                              onClick={() => setReactivateTarget(s)}
                              aria-label="Reactivar"
                              title="Volver a activar"
                            >
                              <CheckCircle2 className="h-4 w-4 opacity-70" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-600 dark:text-slate-400 hover:text-red-400"
                              disabled={s.activo}
                              title={
                                s.activo
                                  ? 'Desactive la sucursal antes de borrarla'
                                  : 'Eliminar definitivamente'
                              }
                              onClick={() => setDeleteTarget(s)}
                              aria-label="Eliminar definitivamente"
                            >
                              <Trash2 className="h-4 w-4 opacity-70" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">
              Desactivar solo oculta la tienda en listas habituales. Para borrar todo (productos, ventas,
              contadores, checador y documento de la sucursal), desactívela y use el ícono de papelera.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 md:max-w-[min(92vw,48rem)] lg:max-w-[min(92vw,56rem)]">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Nueva sucursal' : 'Editar sucursal'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {mode === 'create' ? (
              <div className="space-y-2">
                <Label htmlFor="sm-docid">Id en Firestore (opcional)</Label>
                <Input
                  id="sm-docid"
                  value={form.docId}
                  onChange={(e) => setForm((f) => ({ ...f, docId: e.target.value }))}
                  placeholder="ej. hermosillo — mismo id que productos/ventas"
                  className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100"
                />
                <p className="text-[11px] text-slate-600 dark:text-slate-500">
                  Si lo deja vacío, el id se genera a partir del nombre (letras, números, guiones).
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="sm-nombre">Nombre</Label>
              <Input
                id="sm-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sm-codigo">Código (opcional)</Label>
              <Input
                id="sm-codigo"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                placeholder="ej. HMO-01"
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar sucursal?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              <strong className="text-slate-800 dark:text-slate-200">{deactivateTarget?.nombre}</strong> dejará de
              mostrarse como activa. Los datos en Firestore bajo su id no se eliminan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-700">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDeactivate()}
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivateTarget} onOpenChange={(o) => !o && setReactivateTarget(null)}>
        <AlertDialogContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reactivar sucursal?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              <strong className="text-slate-800 dark:text-slate-200">{reactivateTarget?.nombre}</strong> volverá a
              mostrarse como activa en listas y selectores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-700">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmReactivate()}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              Reactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar sucursal por completo?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <p>
                  Se borrará <strong className="text-slate-800 dark:text-slate-200">{deleteTarget?.nombre}</strong>{' '}
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-500">({deleteTarget?.id})</span> y{' '}
                  <strong className="text-red-300">todos</strong> los datos de esa tienda en Firestore:
                  productos, ventas, movimientos de inventario, contadores y fichajes del checador
                  asociados.
                </p>
                <p>
                  Los usuarios que tenían esta sucursal asignada quedarán sin tienda hasta que les asigne
                  otra.
                </p>
                <p className="text-slate-600 dark:text-slate-500">Esta acción no se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-700"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmHardDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {deleting ? 'Eliminando…' : 'Eliminar todo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
