import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  Wallet,
  Trash2,
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
import { useClients, useClientSearch, useSales } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Client, Sale } from '@/types';
import { REGIMENES_FISCALES, USOS_CFDI } from '@/types';
import { PageShell } from '@/components/ui-custom/PageShell';
import { ClientAddressSonoraFields } from '@/components/ui-custom/ClientAddressSonoraFields';
import { cn } from '@/lib/utils';
import { buildComprasCountByCliente, ticketsHistorialUI } from '@/lib/saleClienteHistorial';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { ESTADO_SONORA, lookupCp } from '@/data/sonoraAddress';
import { type ClientPriceListId } from '@/lib/clientPriceLists';
import { useClientPriceListCatalog } from '@/hooks/useClientPriceListCatalog';

type ClientSortMode = 'nombre' | 'rfc' | 'email' | 'tickets';

const ADEUDOS_BTN_ACTIVE =
  'border-red-600/40 bg-red-500/15 text-red-800 hover:bg-red-500/25 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100 dark:hover:bg-red-500/25';
const ADEUDOS_BTN_EMPTY =
  'border-slate-300/60 bg-slate-100/90 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500';

function buildAdeudosCxCCountByCliente(sales: Sale[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const sale of sales) {
    if (sale.estado !== 'completada') continue;
    if (computeSaleClienteAdeudo(sale) <= 0.005) continue;
    const clientId = (sale.clienteId ?? '').trim();
    if (!clientId || clientId === 'mostrador') continue;
    map.set(clientId, (map.get(clientId) ?? 0) + 1);
  }
  return map;
}

function adeudosCxCUI(clientId: string, counts: ReadonlyMap<string, number>): number {
  return counts.get(clientId) ?? 0;
}

function sortClients(list: Client[], mode: ClientSortMode, comprasPorCliente: ReadonlyMap<string, number>): Client[] {
  const next = [...list];
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  if (mode === 'nombre') {
    next.sort((x, y) => cmp(x.nombre || '', y.nombre || ''));
  } else if (mode === 'tickets') {
    next.sort((x, y) => {
      const a = ticketsHistorialUI(x, comprasPorCliente);
      const b = ticketsHistorialUI(y, comprasPorCliente);
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

export function Clientes() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clients, loading, addClient, editClient, removeClient } = useClients();
  const { sales } = useSales(500);
  const { addToast } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const priceListCatalog = useClientPriceListCatalog();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addClientSubmitting, setAddClientSubmitting] = useState(false);
  const addClientLockRef = useRef(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [sortMode, setSortMode] = useState<ClientSortMode>('nombre');
  const [municipioSonora, setMunicipioSonora] = useState('');
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState(false);

  const adeudosPorCliente = useMemo(() => buildAdeudosCxCCountByCliente(sales), [sales]);
  const comprasPorCliente = useMemo(() => buildComprasCountByCliente(sales), [sales]);

  const openClientProfile = (client: Client, tab?: 'compras' | 'adeudos') => {
    const suffix = tab ? `?tab=${tab}` : '';
    navigate(`/clientes/${client.id}${suffix}`);
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
    notasInternas: '',
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
        notasInternas: formData.notasInternas.trim() || undefined,
        isMostrador: false,
        direccion: {
          calle: formData.calle,
          numeroExterior: formData.numeroExterior,
          numeroInterior: formData.numeroInterior,
          colonia: formData.colonia,
          codigoPostal: formData.codigoPostal,
          ciudad: formData.ciudad,
          estado: formData.estado || ESTADO_SONORA,
          pais: 'MÃ©xico',
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
        notasInternas: formData.notasInternas.trim() || undefined,
        direccion: {
          calle: formData.calle,
          numeroExterior: formData.numeroExterior,
          numeroInterior: formData.numeroInterior,
          colonia: formData.colonia,
          codigoPostal: formData.codigoPostal,
          ciudad: formData.ciudad,
          estado: formData.estado || ESTADO_SONORA,
          pais: 'MÃ©xico',
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
      notasInternas: client.notasInternas ?? '',
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

  useEffect(() => {
    const editId = (location.state as { editClientId?: string } | null)?.editClientId;
    if (!editId || loading) return;
    const target = clients.find((c) => c.id === editId);
    if (!target) return;
    openEditDialog(target);
    navigate(location.pathname, { replace: true, state: null });
  }, [clients, loading, location.pathname, location.state, navigate]);

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
      notasInternas: '',
      colonia: '',
      ciudad: '',
      estado: ESTADO_SONORA,
    });
    setMunicipioSonora('');
  };

  const displayClients = useMemo(() => {
    const base = searchQuery ? searchResults : clients.filter((c) => !c.isMostrador);
    return sortClients(base, sortMode, comprasPorCliente);
  }, [searchQuery, searchResults, clients, sortMode, comprasPorCliente]);

  const countRegistrados = clients.filter((c) => !c.isMostrador).length;
  const countConRfc = clients.filter((c) => c.rfc && !c.isMostrador).length;
  const countConEmail = clients.filter((c) => c.email && !c.isMostrador).length;

  return (
    <>
    <PageShell
      title="Clientes"
      subtitle="Datos para facturaciÃ³n"
      className="min-w-0 max-w-none"
      actionsClassName="md:mt-2"
      actions={
        <Button
          type="button"
          onClick={() => {
            resetForm();
            setShowAddDialog(true);
          }}
          size="lg"
          className="h-11 bg-brand-gradient px-6 text-base font-semibold text-white shadow-sm sm:h-12 sm:px-8 sm:text-lg"
        >
          <Plus className="mr-2 h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          Nuevo
        </Button>
      }
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden max-md:flex-none max-md:min-h-min max-md:overflow-visible sm:gap-3">
      <div className="grid w-full min-w-0 shrink-0 grid-cols-2 gap-1.5 sm:gap-2 md:grid-cols-3 md:gap-2 lg:gap-3">
        <button
          type="button"
          onClick={() => setSortMode('nombre')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'nombre'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3 sm:text-left">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/20 sm:h-10 sm:w-10">
              <User className="h-3.5 w-3.5 text-brand sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 text-center sm:text-left">
              <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-xl">{countRegistrados}</p>
              <p className="text-[9px] leading-tight text-slate-600 dark:text-slate-500 sm:text-xs sm:leading-normal">
                Registrados
              </p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setSortMode('rfc')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'rfc'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3 sm:text-left">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 sm:h-10 sm:w-10">
              <Building2 className="h-3.5 w-3.5 text-emerald-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 text-center sm:text-left">
              <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-xl">{countConRfc}</p>
              <p className="text-[9px] leading-tight text-slate-600 dark:text-slate-500 sm:text-xs sm:leading-normal">Con RFC</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setSortMode('email')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'email'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3 sm:text-left">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 sm:h-10 sm:w-10">
              <Mail className="h-3.5 w-3.5 text-violet-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 text-center sm:text-left">
              <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-xl">{countConEmail}</p>
              <p className="text-[9px] leading-tight text-slate-600 dark:text-slate-500 sm:text-xs sm:leading-normal">
                Con email
              </p>
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

      <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 max-md:flex-none max-md:overflow-visible">
        <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-2">
          <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">Lista</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 shrink-0 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-brand',
              sortMode === 'tickets' && 'text-brand'
            )}
            onClick={() => setSortMode((m) => (m === 'tickets' ? 'nombre' : 'tickets'))}
          >
            <Ticket className="mr-1.5 h-3.5 w-3.5" />
            {sortMode === 'tickets' ? 'MÃ¡s compras primero' : 'Mejores clientes'}
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0 max-md:flex-none max-md:overflow-visible">
          <div className="space-y-2 p-2 md:hidden">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
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
                    <button
                      type="button"
                      className="text-left text-sm font-medium leading-snug text-brand-to hover:underline dark:text-brand/90"
                      onClick={() => openClientProfile(client)}
                    >
                      {client.nombre}
                    </button>
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
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-black transition-colors hover:bg-amber-500/20 dark:text-amber-100 dark:hover:text-amber-50"
                      title="Compras registradas (sin canceladas)"
                      onClick={() => openClientProfile(client, 'compras')}
                    >
                      <Ticket className="h-3 w-3" aria-hidden />
                      {ticketsHistorialUI(client, comprasPorCliente)}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-colors',
                        adeudosCxCUI(client.id, adeudosPorCliente) > 0 ? ADEUDOS_BTN_ACTIVE : ADEUDOS_BTN_EMPTY
                      )}
                      title="Ver adeudos y abonos en perfil del cliente"
                      onClick={() => openClientProfile(client, 'adeudos')}
                    >
                      <Wallet className="h-3 w-3" aria-hidden />
                      {adeudosCxCUI(client.id, adeudosPorCliente)}
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

          <div className="hidden min-h-0 min-w-0 overflow-x-auto md:block">
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
                  <TableHead
                    className="w-[5.5rem] text-center text-slate-600 dark:text-slate-400"
                    title="Tickets con saldo pendiente en Cuentas por cobrar"
                  >
                    Adeudos
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">RFC</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Contacto</TableHead>
                  <TableHead className="hidden text-slate-600 dark:text-slate-400 lg:table-cell">Dirección</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-400">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center">
                      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                    </TableCell>
                  </TableRow>
                ) : displayClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-slate-600 dark:text-slate-500">
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
                          onClick={() => openClientProfile(client)}
                        >
                          <p className="truncate font-medium text-brand-to hover:underline dark:text-brand/90">{client.nombre}</p>
                          {client.razonSocial ? (
                            <p className="truncate text-xs text-slate-600 dark:text-slate-500">{client.razonSocial}</p>
                          ) : null}
                        </button>
                      </TableCell>
                      <TableCell className="align-top text-center">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-black transition-colors hover:bg-amber-500/20 dark:text-amber-100 dark:hover:text-amber-50"
                          title="Compras registradas (sin canceladas)"
                          onClick={() => openClientProfile(client, 'compras')}
                        >
                          <Ticket className="h-3.5 w-3.5" aria-hidden />
                          {ticketsHistorialUI(client, comprasPorCliente)}
                        </button>
                      </TableCell>
                      <TableCell className="align-top text-center">
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors',
                            adeudosCxCUI(client.id, adeudosPorCliente) > 0 ? ADEUDOS_BTN_ACTIVE : ADEUDOS_BTN_EMPTY
                          )}
                          title="Ver adeudos y abonos en perfil del cliente"
                          onClick={() => openClientProfile(client, 'adeudos')}
                        >
                          <Wallet className="h-3.5 w-3.5" aria-hidden />
                          {adeudosCxCUI(client.id, adeudosPorCliente)}
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
                      <TableCell className="hidden max-w-[12rem] align-top lg:table-cell">
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
              <Label className="text-sm lg:text-xs">RazÃ³n Social</Label>
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
              <Label className="text-sm lg:text-xs">TelÃ©fono</Label>
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
                {priceListCatalog.entries.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500 lg:text-[10px] lg:leading-tight">
                Precios que verÃ¡ este cliente al elegirlo en punto de venta (regular, tÃ©cnico, mayoreo, etc.).
              </p>
            </div>

            <div className="min-w-0 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">RÃ©gimen Fiscal</Label>
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
              className="bg-brand-gradient text-white"
            >
              {addClientSubmitting ? 'Guardandoâ€¦' : 'Guardar Cliente'}
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
              <Label>RazÃ³n Social</Label>
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
              <Label>TelÃ©fono</Label>
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
                {priceListCatalog.entries.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-500">
                Precios que verÃ¡ este cliente al elegirlo en punto de venta (regular, tÃ©cnico, mayoreo, etc.).
              </p>
            </div>

            <div className="min-w-0 space-y-2">
              <Label>RÃ©gimen Fiscal</Label>
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
              className="bg-brand-gradient text-white"
            >
              Actualizar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!clientToDelete} onOpenChange={(o) => !o && setClientToDelete(null)}>
        <AlertDialogContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cliente</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              Â¿Eliminar a <strong className="text-slate-800 dark:text-slate-200">{clientToDelete?.nombre}</strong>? Esta acciÃ³n no se
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
              {deletingClient ? 'Eliminandoâ€¦' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
