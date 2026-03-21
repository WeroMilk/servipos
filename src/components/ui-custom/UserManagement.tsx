import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, UserX, Users } from 'lucide-react';
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
  createAuthUserAndProfile,
  subscribeFirestoreDirectoryUsers,
  updateFirestoreDirectoryUser,
} from '@/lib/firestore/usersDirectoryFirestore';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import type { Sucursal } from '@/types';
import { useAuthStore, useAppStore } from '@/stores';
import { normalizeServipartzEmail } from '@/lib/servipartzAuth';
import { cn } from '@/lib/utils';

type FormMode = 'create' | 'edit';

type UmForm = {
  loginEmail: string;
  lockedEmail?: string;
  password: string;
  username: string;
  name: string;
  role: User['role'];
  sucursalId: string;
  isActive: boolean;
};

const emptyForm = (): UmForm => ({
  loginEmail: '',
  lockedEmail: undefined,
  password: '',
  username: '',
  name: '',
  role: 'cashier',
  sucursalId: '',
  isActive: true,
});

type UserManagementProps = {
  embedded?: boolean;
};

export function UserManagement({ embedded = false }: UserManagementProps) {
  const { user: currentUser } = useAuthStore();
  const { addToast } = useAppStore();
  const [users, setUsers] = useState<User[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [sucursalSavingUid, setSucursalSavingUid] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubUsers = subscribeFirestoreDirectoryUsers((list) => {
      setUsers(list);
      setLoading(false);
    });
    const unsubSuc = subscribeSucursales(setSucursales);
    return () => {
      unsubUsers();
      unsubSuc();
    };
  }, []);

  const sucursalLabel = useCallback(
    (id: string | undefined) => {
      if (!id) return '—';
      const s = sucursales.find((x) => x.id === id);
      return s ? s.nombre : id.slice(0, 8) + '…';
    },
    [sucursales]
  );

  const sucursalesActivas = useMemo(() => sucursales.filter((s) => s.activo), [sucursales]);

  const openCreate = () => {
    setMode('create');
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (u: User) => {
    setMode('edit');
    setEditingId(u.id);
    setForm({
      ...emptyForm(),
      lockedEmail: u.email,
      loginEmail: u.email,
      username: u.username,
      name: u.name,
      role: u.role,
      sucursalId: u.sucursalId ?? '',
      isActive: u.isActive,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      addToast({ type: 'error', message: 'El nombre es obligatorio' });
      return;
    }
    if (mode === 'create') {
      const email = normalizeServipartzEmail(form.loginEmail);
      if (!email) {
        addToast({ type: 'error', message: 'Indique usuario o correo para el acceso' });
        return;
      }
      if (!form.password) {
        addToast({ type: 'error', message: 'Defina una contraseña' });
        return;
      }
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        const email = normalizeServipartzEmail(form.loginEmail);
        await createAuthUserAndProfile({
          email: email!,
          password: form.password,
          name: form.name,
          username: form.username.trim() || undefined,
          role: form.role,
          sucursalId: form.sucursalId.trim() || null,
        });
        addToast({ type: 'success', message: 'Usuario creado en Firebase' });
      } else if (editingId) {
        await updateFirestoreDirectoryUser(editingId, {
          name: form.name,
          username: form.username.trim() || undefined,
          role: form.role,
          isActive: form.isActive,
          sucursalId: form.sucursalId.trim() || null,
        });
        addToast({ type: 'success', message: 'Usuario actualizado' });
      }
      setDialogOpen(false);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'Error al guardar',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSucursalQuickAssign = async (uid: string, value: string) => {
    const sucursalId = value === '__none__' ? null : value;
    setSucursalSavingUid(uid);
    try {
      await updateFirestoreDirectoryUser(uid, { sucursalId });
      addToast({ type: 'success', message: 'Tienda asignada al usuario' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo actualizar la tienda',
      });
    } finally {
      setSucursalSavingUid(null);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget || !currentUser) return;
    try {
      await updateFirestoreDirectoryUser(deactivateTarget.id, { isActive: false });
      addToast({ type: 'success', message: 'Usuario desactivado' });
      setDeactivateTarget(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo desactivar',
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
              Usuarios (Firebase)
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
            <p className="mb-2 text-[11px] text-slate-500 sm:text-xs">
              Los accesos se crean con el mismo dominio de correo que en el inicio de sesión. La
              contraseña de usuarios existentes se gestiona desde Firebase o recuperación de
              correo.
            </p>
            <p className="mb-3 rounded-md border border-slate-800/80 bg-slate-800/30 px-2.5 py-2 text-[11px] leading-snug text-slate-400 sm:text-xs">
              <span className="font-medium text-slate-300">Tienda asignada:</span> indica en qué
              sucursal opera el usuario (mismo id que el documento en{' '}
              <code className="text-cyan-500/90">sucursales</code> en Firestore). Los{' '}
              <span className="text-slate-300">administradores</span> pueden además cambiar la tienda
              activa en la barra superior; si no eligen una, se usa la del perfil o la predeterminada
              del entorno.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-800/60">
              <Table className={embedded ? 'text-sm' : undefined}>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className={cn('text-slate-400', embedded && 'h-8 py-1.5')}>
                      Acceso
                    </TableHead>
                    <TableHead className={cn('text-slate-400', embedded && 'h-8 py-1.5')}>
                      Nombre
                    </TableHead>
                    <TableHead className={cn('min-w-[11rem] text-slate-400', embedded && 'h-8 py-1.5')}>
                      Tienda / sucursal
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
                        No hay perfiles en <code className="text-slate-400">users</code>. Cree uno
                        o revise reglas de Firestore.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((u) => (
                      <TableRow
                        key={u.id}
                        className={cn('border-slate-800/80', embedded && 'h-9')}
                      >
                        <TableCell
                          className={cn('max-w-[160px] truncate font-mono text-xs text-slate-200', embedded && 'py-1.5')}
                          title={u.email}
                        >
                          {u.email || u.username}
                        </TableCell>
                        <TableCell className={cn('text-slate-300', embedded && 'py-1.5')}>
                          {u.name}
                        </TableCell>
                        <TableCell className={cn('py-1.5 align-middle', embedded && 'py-1.5')}>
                          <Select
                            value={u.sucursalId ?? '__none__'}
                            disabled={!u.isActive || sucursalSavingUid === u.id}
                            onValueChange={(v) => void handleSucursalQuickAssign(u.id, v)}
                          >
                            <SelectTrigger
                              className={cn(
                                'h-8 w-[min(100%,11rem)] border-slate-700 bg-slate-800/90 text-xs text-slate-100',
                                embedded && 'h-7 text-[11px]'
                              )}
                              aria-label={`Tienda de ${u.name}`}
                            >
                              <SelectValue placeholder="Sin asignar" />
                            </SelectTrigger>
                            <SelectContent className="border-slate-800 bg-slate-900">
                              <SelectItem value="__none__" className="text-slate-100">
                                Sin asignar
                              </SelectItem>
                              {u.sucursalId &&
                                !sucursalesActivas.some((s) => s.id === u.sucursalId) && (
                                  <SelectItem value={u.sucursalId} className="text-slate-100">
                                    {sucursalLabel(u.sucursalId)} (id actual)
                                  </SelectItem>
                                )}
                              {sucursalesActivas.map((s) => (
                                <SelectItem key={s.id} value={s.id} className="text-slate-100">
                                  {s.nombre}
                                  {s.codigo ? ` (${s.codigo})` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                                'text-slate-400 hover:text-amber-400',
                                embedded ? 'h-7 w-7' : 'h-8 w-8'
                              )}
                              disabled={u.id === currentUser?.id || !u.isActive}
                              onClick={() => setDeactivateTarget(u)}
                              aria-label="Desactivar"
                            >
                              <UserX className="h-4 w-4" />
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
            {mode === 'create' ? (
              <div className="space-y-2">
                <Label htmlFor="um-login">Usuario o correo (acceso)</Label>
                <Input
                  id="um-login"
                  value={form.loginEmail}
                  onChange={(e) => setForm((f) => ({ ...f, loginEmail: e.target.value }))}
                  className="border-slate-700 bg-slate-800 text-slate-100"
                  placeholder="ej. maria o maria@dominio.com"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Correo de acceso</Label>
                <Input
                  value={form.lockedEmail ?? form.loginEmail}
                  readOnly
                  className="border-slate-800 bg-slate-900/80 text-slate-400"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="um-username">Alias mostrado (opcional)</Label>
              <Input
                id="um-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-slate-100"
                autoComplete="off"
              />
            </div>
            {mode === 'create' && (
              <div className="space-y-2">
                <Label htmlFor="um-password">Contraseña inicial</Label>
                <Input
                  id="um-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="border-slate-700 bg-slate-800 text-slate-100"
                  autoComplete="new-password"
                />
              </div>
            )}
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
              <Label>Tienda / sucursal asignada</Label>
              <p className="text-[11px] leading-snug text-slate-500">
                Debe coincidir con el id del documento en Firestore{' '}
                <code className="text-slate-400">sucursales</code> (ej. Olivares).
              </p>
              <Select
                value={form.sucursalId || '__none__'}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, sucursalId: v === '__none__' ? '' : v }))
                }
              >
                <SelectTrigger className="border-slate-700 bg-slate-800 text-slate-100">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-900">
                  <SelectItem value="__none__" className="text-slate-100">
                    Sin asignar
                  </SelectItem>
                  {sucursalesActivas.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-slate-100">
                      {s.nombre}
                      {s.codigo ? ` (${s.codigo})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar usuario?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              <strong className="text-slate-200">{deactivateTarget?.name}</strong> no podrá iniciar
              sesión. El perfil permanece en Firestore y puede reactivarse editando la cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700">
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
    </>
  );
}
