import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import type { User } from '@/types';
import {
  getAllUsers,
  createUserRecord,
  updateUserRecord,
  deleteUserRecord,
} from '@/db/database';
import { useAuthStore, useAppStore } from '@/stores';
import { cn } from '@/lib/utils';

type FormMode = 'create' | 'edit';

const emptyForm = {
  username: '',
  password: '',
  name: '',
  email: '',
  role: 'cashier' as User['role'],
  isActive: true,
};

type UserManagementProps = {
  /** Layout compacto para pestaña Configuración (sin scroll de página). */
  embedded?: boolean;
};

export function UserManagement({ embedded = false }: UserManagementProps) {
  const { user: currentUser } = useAuthStore();
  const { addToast } = useAppStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const list = await getAllUsers();
      setUsers(list);
    } catch (e) {
      console.error(e);
      addToast({ type: 'error', message: 'No se pudieron cargar los usuarios' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setMode('create');
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (u: User) => {
    setMode('edit');
    setEditingId(u.id);
    setForm({
      username: u.username,
      password: '',
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.username.trim() || !form.name.trim()) {
      addToast({ type: 'error', message: 'Usuario y nombre son obligatorios' });
      return;
    }
    if (mode === 'create' && !form.password) {
      addToast({ type: 'error', message: 'Defina una contraseña' });
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        await createUserRecord({
          username: form.username,
          password: form.password,
          name: form.name,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
        });
        addToast({ type: 'success', message: 'Usuario creado' });
      } else if (editingId) {
        await updateUserRecord(editingId, {
          username: form.username,
          password: form.password || undefined,
          name: form.name,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
        });
        addToast({ type: 'success', message: 'Usuario actualizado' });
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'Error al guardar',
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !currentUser) return;
    try {
      await deleteUserRecord(deleteTarget.id, currentUser.id);
      addToast({ type: 'success', message: 'Usuario eliminado' });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo eliminar',
      });
    }
  };

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
        <CardHeader
          className={cn(
            'flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0',
            embedded ? 'py-2' : 'gap-3 py-3'
          )}
        >
          <CardTitle
            className={cn(
              'flex items-center gap-2 text-slate-100',
              embedded && 'text-sm sm:text-base'
            )}
          >
            <Users className={cn('text-cyan-400', embedded ? 'h-4 w-4 sm:h-5 sm:w-5' : 'h-5 w-5')} />
            Usuarios del sistema
          </CardTitle>
          <Button
            type="button"
            size={embedded ? 'sm' : 'default'}
            onClick={openCreate}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nuevo usuario
          </Button>
        </CardHeader>
        <CardContent
          className={cn(
            'min-h-0 flex-1 overflow-auto pt-0',
            embedded ? 'p-2 sm:p-3 sm:pt-0' : 'p-3 sm:p-4 sm:pt-0'
          )}
        >
          <div className="overflow-x-auto rounded-lg border border-slate-800/60">
            <Table className={embedded ? 'text-sm' : undefined}>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className={cn('text-slate-400', embedded && 'h-8 py-1.5')}>
                    Usuario
                  </TableHead>
                  <TableHead className={cn('text-slate-400', embedded && 'h-8 py-1.5')}>
                    Nombre
                  </TableHead>
                  <TableHead
                    className={cn(
                      'hidden text-slate-400 sm:table-cell',
                      embedded && 'h-8 py-1.5'
                    )}
                  >
                    Email
                  </TableHead>
                  <TableHead className={cn('text-slate-400', embedded && 'h-8 py-1.5')}>
                    Rol
                  </TableHead>
                  <TableHead className={cn('text-slate-400', embedded && 'h-8 py-1.5')}>
                    Activo
                  </TableHead>
                  <TableHead
                    className={cn(
                      'w-[100px] text-right text-slate-400',
                      embedded && 'h-8 py-1.5'
                    )}
                  >
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      Cargando…
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      No hay usuarios
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow
                      key={u.id}
                      className={cn('border-slate-800/80', embedded && 'h-9')}
                    >
                      <TableCell
                        className={cn('font-medium text-slate-200', embedded && 'py-1.5')}
                      >
                        {u.username}
                      </TableCell>
                      <TableCell className={cn('text-slate-300', embedded && 'py-1.5')}>
                        {u.name}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'hidden max-w-[200px] truncate text-slate-400 sm:table-cell',
                          embedded && 'py-1.5'
                        )}
                      >
                        {u.email}
                      </TableCell>
                      <TableCell className={cn('text-slate-400', embedded && 'py-1.5')}>
                        {u.role === 'admin' ? 'Administrador' : 'Cajero'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'text-xs font-medium',
                            u.isActive ? 'text-emerald-400' : 'text-slate-500'
                          )}
                        >
                          {u.isActive ? 'Sí' : 'No'}
                        </span>
                      </TableCell>
                      <TableCell className={cn('text-right', embedded && 'py-1.5')}>
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'text-slate-400 hover:text-cyan-400',
                              embedded ? 'h-7 w-7' : 'h-8 w-8'
                            )}
                            onClick={() => openEdit(u)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'text-slate-400 hover:text-red-400',
                              embedded ? 'h-7 w-7' : 'h-8 w-8'
                            )}
                            disabled={u.id === currentUser?.id}
                            onClick={() => setDeleteTarget(u)}
                            aria-label="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-slate-800 bg-slate-900 text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Nuevo usuario' : 'Editar usuario'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="um-username">Usuario</Label>
              <Input
                id="um-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-slate-100"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="um-password">
                Contraseña {mode === 'edit' ? '(dejar vacío para no cambiar)' : ''}
              </Label>
              <Input
                id="um-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-slate-100"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="um-name">Nombre completo</Label>
              <Input
                id="um-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="um-email">Email</Label>
              <Input
                id="um-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as User['role'] }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-800 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-900">
                  <SelectItem value="admin" className="text-slate-100">
                    Administrador
                  </SelectItem>
                  <SelectItem value="cashier" className="text-slate-100">
                    Cajero
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2">
              <Label htmlFor="um-active" className="cursor-pointer">
                Cuenta activa
              </Label>
              <Switch
                id="um-active"
                checked={form.isActive}
                onCheckedChange={(c) => setForm((f) => ({ ...f, isActive: c }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-slate-700 text-slate-300"
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Se eliminará permanentemente la cuenta{' '}
              <strong className="text-slate-200">{deleteTarget?.username}</strong>. Esta acción no
              se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
