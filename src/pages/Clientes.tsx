import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Search,
  Edit2,
  User,
  Building2,
  MapPin,
  Mail,
  Phone,
  MoreHorizontal,
  Ticket,
  Trash2,
  BadgeCheck,
  FileQuestion,
  Printer,
  Loader2,
  ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useClients, useClientSearch, useEffectiveSucursalId } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Client, Sale } from '@/types';
import { REGIMENES_FISCALES, USOS_CFDI } from '@/types';
import { PageShell } from '@/components/ui-custom/PageShell';
import { ClientAddressSonoraFields } from '@/components/ui-custom/ClientAddressSonoraFields';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { getSalesByClienteId } from '@/db/database';
import { printThermalTicketFromSale } from '@/lib/printTicket';
import { saleIsInvoiced } from '@/lib/saleInvoiced';
import { saleListaCancelacionEtiqueta } from '@/lib/saleCancelacion';
import { ESTADO_SONORA, lookupCp } from '@/data/sonoraAddress';
import {
  CLIENT_PRICE_LABELS,
  CLIENT_PRICE_LIST_ORDER,
  type ClientPriceListId,
} from '@/lib/clientPriceLists';

type ClientSortMode = 'nombre' | 'rfc' | 'email' | 'tickets';

/** Número para el ícono de ticket: historial completo si existe contador; si no, solo compras completadas netas. */
function ticketsHistorialUI(c: Client): number {
  const v = c.ventasHistorial;
  if (v != null && Number.isFinite(v)) return Math.max(0, Math.floor(Number(v)));
  return c.ticketsComprados ?? 0;
}

function sortClients(list: Client[], mode: ClientSortMode): Client[] {
  const next = [...list];
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  if (mode === 'nombre') {
    next.sort((x, y) => cmp(x.nombre || '', y.nombre || ''));
  } else if (mode === 'tickets') {
    next.sort((x, y) => {
      const a = ticketsHistorialUI(x);
      const b = ticketsHistorialUI(y);
      if (b !== a) return b - a;
      return cmp(x.nombre || '', y.nombre || '');
    });
  } else if (mode === 'rfc') {
    next.sort((x, y) => {
      const xr = (x.rfc || '').trim();
      const yr = (y.rfc || '').trim();
      if (!xr && !yr) return 0;
      if (!xr) return 1;
      if (!yr) return -1;
      return cmp(xr, yr);
    });
  } else {
    next.sort((x, y) => {
      const xe = (x.email || '').trim().toLowerCase();
      const ye = (y.email || '').trim().toLowerCase();
      if (!xe && !ye) return 0;
      if (!xe) return 1;
      if (!ye) return -1;
      return cmp(xe, ye);
    });
  }
  return next;
}

function saleEstadoEtiqueta(s: Sale): string {
  if (s.estado === 'pendiente') return 'Pendiente de cobro';
  if (s.estado === 'cancelada') return 'Cancelada';
  if (s.estado === 'facturada') return 'Facturada';
  return 'Completada';
}

export function Clientes() {
  const { clients, loading, addClient, editClient, removeClient, refresh } = useClients();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const { addToast } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addClientSubmitting, setAddClientSubmitting] = useState(false);
  const addClientLockRef = useRef(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [sortMode, setSortMode] = useState<ClientSortMode>('nombre');
  const [municipioSonora, setMunicipioSonora] = useState('');
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState(false);

  const [clientVentasCliente, setClientVentasCliente] = useState<Client | null>(null);
  const [clientVentasSale, setClientVentasSale] = useState<Sale | null>(null);
  const [clientVentasList, setClientVentasList] = useState<Sale[]>([]);
  const [clientVentasLoading, setClientVentasLoading] = useState(false);
  const ventasHistorialSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clientVentasCliente) {
      setClientVentasList([]);
      return;
    }
    let cancelled = false;
    setClientVentasLoading(true);
    void getSalesByClienteId(clientVentasCliente.id, { sucursalId: effectiveSucursalId })
      .then((rows) => {
        if (!cancelled) setClientVentasList(rows);
      })
      .catch(() => {
        if (!cancelled) setClientVentasList([]);
      })
      .finally(() => {
        if (!cancelled) setClientVentasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientVentasCliente, effectiveSucursalId]);

  useEffect(() => {
    if (!clientVentasCliente || clientVentasCliente.isMostrador || clientVentasLoading) return;
    const correctCount = clientVentasList.length;
    const fresh = clients.find((x) => x.id === clientVentasCliente.id);
    if (fresh?.ventasHistorial === correctCount) return;

    const syncKey = `${clientVentasCliente.id}:${correctCount}`;
    if (ventasHistorialSyncKeyRef.current === syncKey) return;
    ventasHistorialSyncKeyRef.current = syncKey;

    void (async () => {
      try {
        await editClient(clientVentasCliente.id, { ventasHistorial: correctCount });
        if (!effectiveSucursalId) await refresh();
      } catch {
        ventasHistorialSyncKeyRef.current = null;
      }
    })();
  }, [
    clientVentasCliente,
    clientVentasLoading,
    clientVentasList,
    clients,
    editClient,
    refresh,
    effectiveSucursalId,
  ]);

  const openClientVentasDialog = (client: Client) => {
    setClientVentasSale(null);
    setClientVentasCliente(client);
  };

  const closeClientVentasDialog = () => {
    ventasHistorialSyncKeyRef.current = null;
    setClientVentasCliente(null);
    setClientVentasSale(null);
    setClientVentasList([]);
  };

  // Form state
  const [formData, setFormData] = useState({
    rfc: '',
    nombre: '',
    razonSocial: '',
    codigoPostal: '',
    regimenFiscal: '',
    usoCfdi: 'G03',
    email: '',
    telefono: '',
    listaPreciosId: 'regular' as ClientPriceListId,
    calle: '',
    numeroExterior: '',
    numeroInterior: '',
    colonia: '',
    ciudad: '',
    estado: ESTADO_SONORA,
  });

  const { results: searchResults, search } = useClientSearch();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    search(query);
  };

  const handleAddClient = async () => {
    if (addClientLockRef.current || addClientSubmitting) return;
    if (!formData.nombre.trim()) return;
    addClientLockRef.current = true;
    setAddClientSubmitting(true);
    try {
      await addClient({
        ...formData,
        isMostrador: false,
        direccion: {
          calle: formData.calle,
          numeroExterior: formData.numeroExterior,
          numeroInterior: formData.numeroInterior,
          colonia: formData.colonia,
          codigoPostal: formData.codigoPostal,
          ciudad: formData.ciudad,
          estado: formData.estado || ESTADO_SONORA,
          pais: 'México',
        },
      } as any);

      setShowAddDialog(false);
      resetForm();
      addToast({ type: 'success', message: 'Cliente agregado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    } finally {
      addClientLockRef.current = false;
      setAddClientSubmitting(false);
    }
  };

  const confirmDeleteClient = async () => {
    if (!clientToDelete) return;
    setDeletingClient(true);
    try {
      await removeClient(clientToDelete.id);
      if (detailClient?.id === clientToDelete.id) setDetailClient(null);
      addToast({ type: 'success', message: 'Cliente eliminado' });
      setClientToDelete(null);
    } catch (error: unknown) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'No se pudo eliminar el cliente',
      });
    } finally {
      setDeletingClient(false);
    }
  };

  const handleEditClient = async () => {
    if (!selectedClient) return;
    
    try {
      await editClient(selectedClient.id, {
        ...formData,
        direccion: {
          calle: formData.calle,
          numeroExterior: formData.numeroExterior,
          numeroInterior: formData.numeroInterior,
          colonia: formData.colonia,
          codigoPostal: formData.codigoPostal,
          ciudad: formData.ciudad,
          estado: formData.estado || ESTADO_SONORA,
          pais: 'México',
        },
      });
      
      setShowEditDialog(false);
      setSelectedClient(null);
      addToast({ type: 'success', message: 'Cliente actualizado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const openEditDialog = (client: Client) => {
    setSelectedClient(client);
    const cp = client.codigoPostal || client.direccion?.codigoPostal || '';
    const hit = lookupCp(cp);
    const est = client.direccion?.estado?.trim() || ESTADO_SONORA;
    setFormData({
      rfc: client.rfc || '',
      nombre: client.nombre,
      razonSocial: client.razonSocial || '',
      codigoPostal: cp,
      regimenFiscal: client.regimenFiscal || '',
      usoCfdi: client.usoCfdi || 'G03',
      email: client.email || '',
      telefono: client.telefono || '',
      listaPreciosId: client.listaPreciosId ?? 'regular',
      calle: client.direccion?.calle || '',
      numeroExterior: client.direccion?.numeroExterior || '',
      numeroInterior: client.direccion?.numeroInterior || '',
      colonia: client.direccion?.colonia || '',
      ciudad: client.direccion?.ciudad || '',
      estado: est,
    });
    setMunicipioSonora(
      est === ESTADO_SONORA
        ? hit?.municipio || client.direccion?.ciudad || ''
        : client.direccion?.ciudad || ''
    );
    setShowEditDialog(true);
  };

  const resetForm = () => {
    setFormData({
      rfc: '',
      nombre: '',
      razonSocial: '',
      codigoPostal: '',
      regimenFiscal: '',
      usoCfdi: 'G03',
      email: '',
      telefono: '',
      listaPreciosId: 'regular',
      calle: '',
      numeroExterior: '',
      numeroInterior: '',
      colonia: '',
      ciudad: '',
      estado: ESTADO_SONORA,
    });
    setMunicipioSonora('');
  };

  const displayClients = useMemo(() => {
    const base = searchQuery ? searchResults : clients.filter((c) => !c.isMostrador);
    return sortClients(base, sortMode);
  }, [searchQuery, searchResults, clients, sortMode]);

  const countRegistrados = clients.filter((c) => !c.isMostrador).length;
  const countConRfc = clients.filter((c) => c.rfc && !c.isMostrador).length;
  const countConEmail = clients.filter((c) => c.email && !c.isMostrador).length;

  return (
    <>
    <PageShell
      title="Clientes"
      subtitle="Datos para facturación"
      className="min-w-0 max-w-none"
      actionsClassName="md:mt-2"
      actions={
        <Button
          type="button"
          onClick={() => {
            resetForm();
            setShowAddDialog(true);
          }}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          size="sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo
        </Button>
      }
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
      <div className="grid w-full min-w-0 shrink-0 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <button
          type="button"
          onClick={() => setSortMode('nombre')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'nombre'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 sm:h-10 sm:w-10">
              <User className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">{countRegistrados}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Registrados</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setSortMode('rfc')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'rfc'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 sm:h-10 sm:w-10">
              <Building2 className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">{countConRfc}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Con RFC</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setSortMode('email')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'email'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 sm:h-10 sm:w-10">
              <Mail className="h-4 w-4 text-violet-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">{countConEmail}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Con email</p>
            </div>
          </CardContent>
        </button>
      </div>

      <div className="relative w-full min-w-0 shrink-0">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
        <Input
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Nombre o RFC..."
          className="h-9 w-full border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50 pl-9 text-sm text-slate-900 dark:text-slate-100 sm:h-10 sm:pl-10"
        />
      </div>

      <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
        <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-2">
          <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">Lista</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 shrink-0 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-cyan-400',
              sortMode === 'tickets' && 'text-cyan-400'
            )}
            onClick={() => setSortMode((m) => (m === 'tickets' ? 'nombre' : 'tickets'))}
          >
            <Ticket className="mr-1.5 h-3.5 w-3.5" />
            {sortMode === 'tickets' ? 'Más compras primero' : 'Mejores clientes'}
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <div className="space-y-2 p-2 md:hidden">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
              </div>
            ) : displayClients.length === 0 ? (
              <p className="py-8 text-center text-slate-600 dark:text-slate-500">No se encontraron clientes</p>
            ) : (
              displayClients.map((client) => (
                <div
                  key={client.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-snug text-slate-900 dark:text-slate-100">{client.nombre}</p>
                    {client.rfc ? (
                      <p className="truncate text-xs text-emerald-400">{client.rfc}</p>
                    ) : null}
                    <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-500">
                      {client.email || client.telefono || 'Sin contacto'}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-200/80 dark:border-slate-800/60 pt-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-xs font-medium text-cyan-500/90 hover:text-cyan-400"
                      onClick={() => setDetailClient(client)}
                    >
                      Ver ficha completa…
                    </button>
                    <button
                      type="button"
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
                      title="Ventas en historial (incluye pendientes, completadas y canceladas)"
                      onClick={() => openClientVentasDialog(client)}
                    >
                      <Ticket className="h-3 w-3" aria-hidden />
                      {ticketsHistorialUI(client)}
                    </button>
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                        aria-label={`Eliminar cliente ${client.nombre}`}
                        onClick={() => setClientToDelete(client)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0 text-slate-600 dark:text-slate-400">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                        <DropdownMenuItem
                          onClick={() => openEditDialog(client)}
                          className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                        >
                          <Edit2 className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden min-h-0 min-w-0 md:block">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-800">
                  <TableHead className="text-slate-600 dark:text-slate-400">Cliente</TableHead>
                  <TableHead
                    className="w-[5.5rem] text-center text-slate-600 dark:text-slate-400"
                    title="Ventas en historial (incluye canceladas y pendientes de cobro)"
                  >
                    Compras
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">RFC</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Contacto</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Dirección</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-400">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
                    </TableCell>
                  </TableRow>
                ) : displayClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-600 dark:text-slate-500">
                      No se encontraron clientes
                    </TableCell>
                  </TableRow>
                ) : (
                  displayClients.map((client) => (
                    <TableRow key={client.id} className="border-slate-200/80 dark:border-slate-800/50">
                      <TableCell className="max-w-[14rem] align-top">
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => setDetailClient(client)}
                        >
                          <p className="truncate font-medium text-cyan-800 hover:underline dark:text-cyan-300/90">{client.nombre}</p>
                          {client.razonSocial ? (
                            <p className="truncate text-xs text-slate-600 dark:text-slate-500">{client.razonSocial}</p>
                          ) : null}
                        </button>
                      </TableCell>
                      <TableCell className="align-top text-center">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
                          title="Ventas en historial (incluye pendientes, completadas y canceladas)"
                          onClick={() => openClientVentasDialog(client)}
                        >
                          <Ticket className="h-3.5 w-3.5" aria-hidden />
                          {ticketsHistorialUI(client)}
                        </button>
                      </TableCell>
                      <TableCell className="align-top">
                        {client.rfc ? (
                          <Badge
                            variant="secondary"
                            className="max-w-[8rem] truncate bg-emerald-500/10 text-emerald-400"
                          >
                            {client.rfc}
                          </Badge>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[12rem] align-top">
                        <div className="min-w-0 text-sm">
                          {client.email ? (
                            <p className="truncate text-slate-600 dark:text-slate-400">
                              <Mail className="mr-1 inline h-3 w-3" />
                              {client.email}
                            </p>
                          ) : null}
                          {client.telefono ? (
                            <p className="truncate text-slate-600 dark:text-slate-400">
                              <Phone className="mr-1 inline h-3 w-3" />
                              {client.telefono}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[12rem] align-top">
                        {client.direccion ? (
                          <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                            <MapPin className="mr-1 inline h-3 w-3 shrink-0" />
                            {client.direccion.colonia}, {client.direccion.ciudad}
                          </p>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {isAdmin ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:bg-red-500/10 hover:text-red-400"
                              aria-label={`Eliminar cliente ${client.nombre}`}
                              onClick={() => setClientToDelete(client)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-slate-600 dark:text-slate-400">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                              <DropdownMenuItem
                                onClick={() => openEditDialog(client)}
                                className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                              >
                                <Edit2 className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
    </PageShell>

      {/* Add Client Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-none flex-col gap-0 overflow-y-auto border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:w-full md:max-h-[min(96dvh,56rem)] md:max-w-[min(94vw,80rem)] lg:max-h-none lg:max-w-[min(96vw,90rem)] lg:overflow-visible xl:max-w-[min(98vw,104rem)]">
          <div className="shrink-0 border-b border-slate-200 px-4 pb-2 pt-3 pr-14 dark:border-slate-800/80 lg:pb-1.5 lg:pt-2.5">
            <DialogHeader className="space-y-0 p-0 text-left">
              <DialogTitle className="text-lg lg:text-base">Nuevo Cliente</DialogTitle>
            </DialogHeader>
          </div>

          <form
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:overflow-visible"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAddClient();
            }}
          >
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-5 lg:flex-none lg:overflow-visible lg:py-2.5">
          <div className="grid min-w-0 grid-cols-1 gap-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-2">
            <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-4 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>

            <div className="min-w-0 space-y-1.5 lg:space-y-1">
              <Label className="text-sm lg:text-xs">RFC</Label>
              <Input
                value={formData.rfc}
                onChange={(e) => setFormData({ ...formData, rfc: e.target.value.toUpperCase() })}
                placeholder="XAXX010101000"
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>

            <div className="min-w-0 space-y-1.5 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Razón Social</Label>
              <Input
                value={formData.razonSocial}
                onChange={(e) => setFormData({ ...formData, razonSocial: e.target.value })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>

            <div className="min-w-0 space-y-1.5 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>

            <div className="min-w-0 space-y-1.5 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Teléfono</Label>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>

            <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Lista de precios (POS)</Label>
              <select
                value={formData.listaPreciosId}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    listaPreciosId: e.target.value as ClientPriceListId,
                  })
                }
                className="h-10 w-full rounded-md border border-slate-300 bg-slate-200 px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              >
                {CLIENT_PRICE_LIST_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {CLIENT_PRICE_LABELS[id]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500 lg:text-[10px] lg:leading-tight">
                Precios que verá este cliente al elegirlo en punto de venta (regular, técnico, mayoreo, etc.).
              </p>
            </div>

            <div className="min-w-0 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Régimen Fiscal</Label>
              <select
                value={formData.regimenFiscal}
                onChange={(e) => setFormData({ ...formData, regimenFiscal: e.target.value })}
                className="h-10 w-full rounded-md border border-slate-300 bg-slate-200 px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              >
                <option value="">Seleccione...</option>
                {REGIMENES_FISCALES.map((r) => (
                  <option key={r.clave} value={r.clave}>
                    {r.clave} - {r.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-4 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Uso CFDI Predeterminado</Label>
              <select
                value={formData.usoCfdi}
                onChange={(e) => setFormData({ ...formData, usoCfdi: e.target.value })}
                className="h-10 w-full rounded-md border border-slate-300 bg-slate-200 px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              >
                {USOS_CFDI.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.clave} - {u.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <ClientAddressSonoraFields
              formData={formData}
              setFormData={setFormData}
              municipio={municipioSonora}
              setMunicipio={setMunicipioSonora}
              dense
            />
          </div>
          </div>

          <DialogFooter className="flex shrink-0 gap-2 border-t border-slate-200/80 px-4 py-2.5 dark:border-slate-800/80 sm:justify-end lg:py-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddDialog(false)}
              disabled={addClientSubmitting}
              className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!formData.nombre.trim() || addClientSubmitting}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              {addClientSubmitting ? 'Guardando…' : 'Guardar Cliente'}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog - Similar structure */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-none flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 sm:w-full md:max-w-[min(92vw,72rem)] lg:max-w-[min(92vw,80rem)]">
          <div className="shrink-0 border-b border-slate-200 dark:border-slate-800/80 px-4 pb-3 pt-4 pr-14">
            <DialogHeader className="space-y-0 p-0 text-left">
              <DialogTitle>Editar Cliente</DialogTitle>
            </DialogHeader>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
          <div className="grid min-w-0 grid-cols-1 gap-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-4">
            <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label>RFC</Label>
              <Input
                value={formData.rfc}
                onChange={(e) => setFormData({ ...formData, rfc: e.target.value.toUpperCase() })}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label>Razón Social</Label>
              <Input
                value={formData.razonSocial}
                onChange={(e) => setFormData({ ...formData, razonSocial: e.target.value })}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label>Teléfono</Label>
              <Input
                type="tel"
                inputMode="tel"
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-1">
              <Label>Lista de precios (POS)</Label>
              <select
                value={formData.listaPreciosId}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    listaPreciosId: e.target.value as ClientPriceListId,
                  })
                }
                className="h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 text-slate-900 dark:text-slate-100"
              >
                {CLIENT_PRICE_LIST_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {CLIENT_PRICE_LABELS[id]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-500">
                Precios que verá este cliente al elegirlo en punto de venta (regular, técnico, mayoreo, etc.).
              </p>
            </div>

            <div className="min-w-0 space-y-2">
              <Label>Régimen Fiscal</Label>
              <select
                value={formData.regimenFiscal}
                onChange={(e) => setFormData({ ...formData, regimenFiscal: e.target.value })}
                className="h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 text-slate-900 dark:text-slate-100"
              >
                <option value="">Seleccione...</option>
                {REGIMENES_FISCALES.map((r) => (
                  <option key={r.clave} value={r.clave}>
                    {r.clave} - {r.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Uso CFDI Predeterminado</Label>
              <select
                value={formData.usoCfdi}
                onChange={(e) => setFormData({ ...formData, usoCfdi: e.target.value })}
                className="h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 text-slate-900 dark:text-slate-100"
              >
                {USOS_CFDI.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.clave} - {u.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <ClientAddressSonoraFields
              formData={formData}
              setFormData={setFormData}
              municipio={municipioSonora}
              setMunicipio={setMunicipioSonora}
            />
          </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-slate-200 dark:border-slate-800/80 px-4 py-3 sm:justify-end">
            <Button variant="outline" onClick={() => setShowEditDialog(false)} className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400">
              Cancelar
            </Button>
            <Button 
              onClick={handleEditClient}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Actualizar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailClient} onOpenChange={(o) => !o && setDetailClient(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 md:max-w-[min(92vw,44rem)] lg:max-w-[min(92vw,52rem)]">
          <DialogHeader>
            <DialogTitle>Ficha de cliente</DialogTitle>
          </DialogHeader>
          {detailClient && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-600 dark:text-slate-500">Nombre</p>
                <p className="text-slate-900 dark:text-slate-100">{detailClient.nombre}</p>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-500">Lista de precios (POS)</p>
                <p className="text-slate-900 dark:text-slate-100">
                  {CLIENT_PRICE_LABELS[detailClient.listaPreciosId ?? 'regular']}
                </p>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-500">Ventas en historial</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="group inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-left text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
                    title="Historial de ventas (incluye canceladas) y reimprimir tickets"
                    onClick={() => {
                      const c = detailClient;
                      setDetailClient(null);
                      openClientVentasDialog(c);
                    }}
                  >
                    <Ticket className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="text-lg font-semibold tabular-nums">
                      {ticketsHistorialUI(detailClient)}
                    </span>
                    <span className="text-xs font-normal text-slate-600 group-hover:text-slate-500 dark:text-slate-500">
                      (pulse para ver ventas)
                    </span>
                  </button>
                  {isAdmin && !detailClient.isMostrador && detailClient.id !== 'mostrador' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-red-600 hover:bg-red-500/15 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
                      title="Eliminar cliente"
                      aria-label={`Eliminar cliente ${detailClient.nombre}`}
                      onClick={() => setClientToDelete(detailClient)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              {detailClient.rfc ? (
                <div>
                  <p className="text-slate-600 dark:text-slate-500">RFC</p>
                  <p className="text-emerald-400">{detailClient.rfc}</p>
                </div>
              ) : null}
              {detailClient.email ? (
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Email</p>
                  <p className="break-all text-slate-700 dark:text-slate-300">{detailClient.email}</p>
                </div>
              ) : null}
              {detailClient.telefono ? (
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Teléfono</p>
                  <p className="text-slate-700 dark:text-slate-300">{detailClient.telefono}</p>
                </div>
              ) : null}
              {detailClient.direccion ? (
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Dirección</p>
                  <p className="text-slate-700 dark:text-slate-300">
                    {detailClient.direccion.calle} {detailClient.direccion.numeroExterior}{' '}
                    {detailClient.direccion.colonia}, {detailClient.direccion.ciudad},{' '}
                    {detailClient.direccion.estado} CP {detailClient.direccion.codigoPostal}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  onClick={() => setDetailClient(null)}
                >
                  Cerrar
                </Button>
                <Button
                  type="button"
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                  onClick={() => {
                    const c = detailClient;
                    setDetailClient(null);
                    openEditDialog(c);
                  }}
                >
                  Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!clientVentasCliente}
        onOpenChange={(o) => {
          if (!o) closeClientVentasDialog();
        }}
      >
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-none flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 sm:w-full md:max-w-[min(92vw,32rem)] lg:max-w-[min(92vw,36rem)]">
          <DialogHeader className="shrink-0 space-y-0 border-b border-slate-200 dark:border-slate-800/80 px-4 pb-3 pt-4 pr-14 text-left">
            {clientVentasSale ? (
              <div className="flex items-start gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-slate-600 dark:text-slate-400"
                  aria-label="Volver al listado"
                  onClick={() => setClientVentasSale(null)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                  <DialogTitle className="truncate">Ticket {clientVentasSale.folio}</DialogTitle>
                  <p className="mt-1 text-sm font-normal text-slate-600 dark:text-slate-500">
                    {clientVentasCliente?.nombre}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <DialogTitle>Ventas del cliente</DialogTitle>
                <p className="mt-1 text-sm font-normal text-slate-600 dark:text-slate-500">
                  {clientVentasCliente?.nombre}
                </p>
              </>
            )}
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {clientVentasSale ? (
              <div className="space-y-4">
                <div
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-sm',
                    saleIsInvoiced(clientVentasSale)
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                      : 'border-slate-300/80 bg-slate-200/80 text-slate-800 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-200'
                  )}
                >
                  <p className="flex items-center gap-2 font-medium">
                    {saleIsInvoiced(clientVentasSale) ? (
                      <>
                        <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                        Facturada
                      </>
                    ) : (
                      <>
                        <FileQuestion className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                        Sin facturar
                      </>
                    )}
                  </p>
                  {saleIsInvoiced(clientVentasSale) && clientVentasSale.facturaId ? (
                    <p className="mt-1 text-xs opacity-90">
                      Vinculada a factura (id: {clientVentasSale.facturaId.slice(0, 8)}…)
                    </p>
                  ) : null}
                </div>
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Fecha</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {formatInAppTimezone(
                        clientVentasSale.createdAt instanceof Date
                          ? clientVentasSale.createdAt
                          : new Date(clientVentasSale.createdAt),
                        { dateStyle: 'medium', timeStyle: 'short' }
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Estado</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {saleEstadoEtiqueta(clientVentasSale)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-slate-600 dark:text-slate-500">Total</dt>
                    <dd className="text-lg font-semibold tabular-nums text-cyan-600 dark:text-cyan-400">
                      {formatMoney(clientVentasSale.total)}
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white sm:w-auto"
                  onClick={() => void printThermalTicketFromSale(clientVentasSale)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Abrir ticket para imprimir
                </Button>
              </div>
            ) : clientVentasLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-600 dark:text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500" aria-hidden />
                <p className="text-sm">Cargando ventas…</p>
              </div>
            ) : clientVentasList.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-600 dark:text-slate-500">
                <p>
                  {effectiveSucursalId
                    ? 'No hay ventas registradas para este cliente en esta sucursal.'
                    : 'No hay ventas guardadas en este dispositivo para este cliente.'}
                </p>
                {!effectiveSucursalId ? (
                  <p className="mt-2 text-xs">
                    Si usa otra sucursal o recién sincronizó, espere a que las ventas bajen al historial local.
                  </p>
                ) : null}
              </div>
            ) : (
              <ul className="space-y-2">
                {clientVentasList.map((sale) => (
                  <li key={sale.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-1 rounded-lg border border-slate-200/80 p-3 text-left transition-colors hover:bg-slate-200/80 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                      onClick={() => setClientVentasSale(sale)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                          <span
                            className="shrink-0"
                            title={saleIsInvoiced(sale) ? 'Facturada' : 'Sin facturar'}
                          >
                            {saleIsInvoiced(sale) ? (
                              <BadgeCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                            ) : (
                              <FileQuestion className="h-4 w-4 text-slate-500" aria-hidden />
                            )}
                          </span>
                          <span className="truncate">{sale.folio}</span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-cyan-600 dark:text-cyan-400">
                          {formatMoney(sale.total)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-500">
                        {formatInAppTimezone(
                          sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt),
                          { dateStyle: 'short', timeStyle: 'short' }
                        )}
                        {saleListaCancelacionEtiqueta(sale) ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {' '}
                            · {saleListaCancelacionEtiqueta(sale)}
                          </span>
                        ) : null}
                        {sale.estado === 'pendiente' ? (
                          <span className="text-amber-600 dark:text-amber-400"> · Fiado</span>
                        ) : null}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-200 dark:border-slate-800/80 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-slate-300 dark:border-slate-700 sm:w-auto"
              onClick={closeClientVentasDialog}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!clientToDelete} onOpenChange={(o) => !o && setClientToDelete(null)}>
        <AlertDialogContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cliente</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              ¿Eliminar a <strong className="text-slate-800 dark:text-slate-200">{clientToDelete?.nombre}</strong>? Esta acción no se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-700">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingClient}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteClient();
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {deletingClient ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
