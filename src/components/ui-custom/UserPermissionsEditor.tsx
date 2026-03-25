import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Permission, User, UserRole } from '@/types';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  getEffectivePermissions,
  permissionsFromRoleTemplate,
} from '@/lib/userPermissions';
import {
  subscribeFirestoreDirectoryUsers,
  updateFirestoreDirectoryUser,
} from '@/lib/firestore/usersDirectoryFirestore';
import { useAuthStore, useAppStore } from '@/stores';
import { cn } from '@/lib/utils';

const PERMISSION_GROUPS: { title: string; items: Permission[] }[] = [
  {
    title: 'Ventas y panel',
    items: ['ventas:ver', 'ventas:crear', 'reportes:ver'],
  },
  {
    title: 'Inventario',
    items: ['inventario:ver', 'inventario:crear', 'inventario:editar', 'inventario:eliminar'],
  },
  {
    title: 'Cotizaciones y facturación',
    items: ['cotizaciones:ver', 'cotizaciones:crear', 'facturas:ver', 'facturas:crear'],
  },
  {
    title: 'Configuración y administración',
    items: [
      'configuracion:ver',
      'configuracion:editar',
      'usuarios:gestionar',
      'sucursales:gestionar',
    ],
  },
  {
    title: 'Checador',
    items: ['checador:registrar', 'checador:reporte'],
  },
];

function groupContains(perm: Permission): boolean {
  return PERMISSION_GROUPS.some((g) => g.items.includes(perm));
}

const UNGROUPED: Permission[] = ALL_PERMISSIONS.filter((p) => !groupContains(p));

type UserPermissionsEditorProps = {
  embedded?: boolean;
};

export function UserPermissionsEditor({ embedded = false }: UserPermissionsEditorProps) {
  const { user: currentUser, refreshUserProfile } = useAuthStore();
  const { addToast } = useAppStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<UserRole>('cashier');
  const [customMode, setCustomMode] = useState(false);
  const [draftPerms, setDraftPerms] = useState<Set<Permission>>(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoadingList(true);
    const unsub = subscribeFirestoreDirectoryUsers((list) => {
      setUsers(list);
      setLoadingList(false);
    });
    return unsub;
  }, []);

  const selected = useMemo(
    () => (selectedId ? users.find((u) => u.id === selectedId) ?? null : null),
    [users, selectedId]
  );

  const syncDraftFromUser = useCallback((u: User) => {
    setDraftRole(u.role);
    const custom = u.useCustomPermissions === true;
    setCustomMode(custom);
    setDraftPerms(new Set(getEffectivePermissions(u)));
  }, []);

  useEffect(() => {
    if (selected) syncDraftFromUser(selected);
  }, [selected, syncDraftFromUser]);

  const applyTemplate = (role: UserRole) => {
    setDraftPerms(new Set(permissionsFromRoleTemplate(role)));
    setDraftRole(role);
  };

  const togglePerm = (p: Permission, on: boolean) => {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateFirestoreDirectoryUser(selected.id, {
        role: draftRole,
        useCustomPermissions: customMode,
        customPermissions: customMode ? Array.from(draftPerms) : null,
      });
      addToast({
        type: 'success',
        message: customMode
          ? 'Permisos personalizados guardados'
          : 'Rol y permisos por plantilla guardados',
      });
      if (selected.id === currentUser?.id) {
        await refreshUserProfile();
      }
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar',
      });
    } finally {
      setSaving(false);
    }
  };

  const groupsToRender =
    UNGROUPED.length > 0
      ? [...PERMISSION_GROUPS, { title: 'Otros', items: UNGROUPED }]
      : PERMISSION_GROUPS;

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-hidden',
        embedded ? 'p-0' : ''
      )}
    >
      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
        <CardHeader className="shrink-0 space-y-1 px-3 py-2 sm:px-4">
          <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-100 sm:text-base">
            <Shield className="h-4 w-4 shrink-0 text-cyan-500 sm:h-5 sm:w-5" />
            Permisos por usuario
          </CardTitle>
          <p className="text-sm font-normal text-slate-600 dark:text-slate-400 sm:text-xs">
            Elija un usuario, asigne rol (Administrador, Gerente o Cajero) y, si lo necesita, active permisos
            personalizados para marcar pantallas y acciones una a una. Dos cajeros pueden tener listas distintas.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 pt-0 sm:p-4 sm:pt-0">
          <div className="grid shrink-0 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Usuario</Label>
              <Select
                value={selectedId ?? ''}
                onValueChange={(v) => setSelectedId(v || null)}
                disabled={loadingList}
              >
                <SelectTrigger className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder={loadingList ? 'Cargando…' : 'Seleccione…'} />
                </SelectTrigger>
                <SelectContent className="max-h-[min(60dvh,20rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-slate-900 dark:text-slate-100">
                      {u.name} ({u.email || u.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Rol base</Label>
              <Select
                value={draftRole}
                onValueChange={(v) => {
                  const r = v as UserRole;
                  setDraftRole(r);
                  if (!customMode) {
                    setDraftPerms(new Set(permissionsFromRoleTemplate(r)));
                  }
                }}
                disabled={!selected}
              >
                <SelectTrigger className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                  <SelectItem value="admin" className="text-slate-900 dark:text-slate-100">
                    {ROLE_LABELS.admin}
                  </SelectItem>
                  <SelectItem value="gerente" className="text-slate-900 dark:text-slate-100">
                    {ROLE_LABELS.gerente}
                  </SelectItem>
                  <SelectItem value="cashier" className="text-slate-900 dark:text-slate-100">
                    {ROLE_LABELS.cashier}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!selected ? (
            <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-500">
              Seleccione un usuario para ver y editar permisos.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200/80 bg-slate-200/40 p-3 dark:border-slate-800/60 dark:bg-slate-800/30 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center justify-between gap-3 sm:justify-start">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Permisos personalizados
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-500">
                      {customMode
                        ? 'Solo cuentan las casillas marcadas (ignora la plantilla del rol).'
                        : 'Se usa la plantilla del rol; puede cambiar el rol arriba.'}
                    </p>
                  </div>
                  <Switch
                    checked={customMode}
                    onCheckedChange={(on) => {
                      setCustomMode(on);
                      if (on) {
                        setDraftPerms(new Set(getEffectivePermissions(selected)));
                      } else {
                        setDraftPerms(new Set(permissionsFromRoleTemplate(draftRole)));
                      }
                    }}
                    aria-label="Permisos personalizados"
                  />
                </div>
                {customMode ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-slate-300 text-xs dark:border-slate-600"
                      onClick={() => applyTemplate('cashier')}
                    >
                      Copiar plantilla cajero
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-slate-300 text-xs dark:border-slate-600"
                      onClick={() => applyTemplate('gerente')}
                    >
                      Copiar plantilla gerente
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-slate-300 text-xs dark:border-slate-600"
                      onClick={() => applyTemplate('admin')}
                    >
                      Copiar plantilla admin
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
                {groupsToRender.map((group) => (
                  <div key={group.title}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
                      {group.title}
                    </p>
                    <ul className="space-y-2">
                      {group.items.map((p) => (
                        <li
                          key={p}
                          className="flex items-start gap-3 rounded-md border border-slate-200/70 bg-slate-100/80 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-900/40"
                        >
                          <Switch
                            checked={draftPerms.has(p)}
                            disabled={!customMode}
                            onCheckedChange={(c) => togglePerm(p, c)}
                            aria-label={PERMISSION_LABELS[p]}
                          />
                          <div className="min-w-0">
                            <p className="font-mono text-[11px] text-cyan-700 dark:text-cyan-400">{p}</p>
                            <p className="text-sm text-slate-800 dark:text-slate-200">{PERMISSION_LABELS[p]}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="shrink-0 border-t border-slate-200/80 pt-3 dark:border-slate-800/60">
                <p className="mb-2 text-[11px] text-slate-600 dark:text-slate-500">
                  Tras guardar, el usuario debe <strong className="text-slate-700 dark:text-slate-300">cerrar sesión y volver a entrar</strong> si
                  no es usted (su sesión se actualiza al instante si edita su propia cuenta).
                </p>
                <Button
                  type="button"
                  disabled={saving}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                  onClick={() => void handleSave()}
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Guardar cambios
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
