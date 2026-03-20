import { useMemo, useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit2, 
  User, 
  Building2,
  MapPin,
  Mail,
  Phone,
  MoreHorizontal
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useClients, useClientSearch } from '@/hooks';
import { useAppStore } from '@/stores';
import type { Client } from '@/types';
import { REGIMENES_FISCALES, USOS_CFDI } from '@/types';
import { PageShell } from '@/components/ui-custom/PageShell';
import { cn } from '@/lib/utils';

type ClientSortMode = 'nombre' | 'rfc' | 'email';

function sortClients(list: Client[], mode: ClientSortMode): Client[] {
  const next = [...list];
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  if (mode === 'nombre') {
    next.sort((x, y) => cmp(x.nombre || '', y.nombre || ''));
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
  const { clients, loading, addClient, editClient } = useClients();
  const { addToast } = useAppStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [sortMode, setSortMode] = useState<ClientSortMode>('nombre');

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
    calle: '',
    numeroExterior: '',
    numeroInterior: '',
    colonia: '',
    ciudad: '',
    estado: '',
  });

  const { results: searchResults, search } = useClientSearch();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    search(query);
  };

  const handleAddClient = async () => {
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
          estado: formData.estado,
          pais: 'México',
        },
      } as any);
      
      setShowAddDialog(false);
      resetForm();
      addToast({ type: 'success', message: 'Cliente agregado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
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
          estado: formData.estado,
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
    setFormData({
      rfc: client.rfc || '',
      nombre: client.nombre,
      razonSocial: client.razonSocial || '',
      codigoPostal: client.codigoPostal || '',
      regimenFiscal: client.regimenFiscal || '',
      usoCfdi: client.usoCfdi || 'G03',
      email: client.email || '',
      telefono: client.telefono || '',
      calle: client.direccion?.calle || '',
      numeroExterior: client.direccion?.numeroExterior || '',
      numeroInterior: client.direccion?.numeroInterior || '',
      colonia: client.direccion?.colonia || '',
      ciudad: client.direccion?.ciudad || '',
      estado: client.direccion?.estado || '',
    });
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
      calle: '',
      numeroExterior: '',
      numeroInterior: '',
      colonia: '',
      ciudad: '',
      estado: '',
    });
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
      actions={
        <Button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          size="sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo
        </Button>
      }
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
      <div className="grid w-full min-w-0 shrink-0 grid-cols-3 gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setSortMode('nombre')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'nombre'
              ? 'border-cyan-500/50 bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-800/50 bg-slate-900/50 hover:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 sm:h-10 sm:w-10">
              <User className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-100 sm:text-xl">{countRegistrados}</p>
              <p className="text-[10px] text-slate-500 sm:text-xs">Registrados</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setSortMode('rfc')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'rfc'
              ? 'border-cyan-500/50 bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-800/50 bg-slate-900/50 hover:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 sm:h-10 sm:w-10">
              <Building2 className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-100 sm:text-xl">{countConRfc}</p>
              <p className="text-[10px] text-slate-500 sm:text-xs">Con RFC</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setSortMode('email')}
          className={cn(
            'rounded-xl border text-left transition-all',
            sortMode === 'email'
              ? 'border-cyan-500/50 bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-800/50 bg-slate-900/50 hover:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 sm:h-10 sm:w-10">
              <Mail className="h-4 w-4 text-violet-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-100 sm:text-xl">{countConEmail}</p>
              <p className="text-[10px] text-slate-500 sm:text-xs">Con email</p>
            </div>
          </CardContent>
        </button>
      </div>

      <div className="relative w-full min-w-0 shrink-0">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
        <Input
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Nombre o RFC..."
          className="h-9 w-full border-slate-800 bg-slate-900/50 pl-9 text-sm text-slate-100 sm:h-10 sm:pl-10"
        />
      </div>

      <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
        <CardHeader className="shrink-0 space-y-0 py-2">
          <CardTitle className="text-sm text-slate-100 sm:text-base">Lista</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <div className="min-h-0 min-w-0">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="w-[26%] text-slate-400">Cliente</TableHead>
                  <TableHead className="w-[14%] text-slate-400">RFC</TableHead>
                  <TableHead className="w-[26%] text-slate-400">Contacto</TableHead>
                  <TableHead className="w-[26%] text-slate-400">Dirección</TableHead>
                  <TableHead className="w-[8%] text-right text-slate-400">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : displayClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                      No se encontraron clientes
                    </TableCell>
                  </TableRow>
                ) : (
                  displayClients.map((client) => (
                    <TableRow key={client.id} className="border-slate-800/50">
                      <TableCell className="max-w-0 align-top">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-200">{client.nombre}</p>
                          {client.razonSocial && (
                            <p className="truncate text-xs text-slate-500">{client.razonSocial}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {client.rfc ? (
                          <Badge variant="secondary" className="max-w-full truncate bg-emerald-500/10 text-emerald-400">
                            {client.rfc}
                          </Badge>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-0 align-top">
                        <div className="min-w-0 text-sm">
                          {client.email && (
                            <p className="flex items-center gap-1 truncate text-slate-400">
                              <Mail className="h-3 w-3 shrink-0" />{' '}
                              <span className="min-w-0 truncate">{client.email}</span>
                            </p>
                          )}
                          {client.telefono && (
                            <p className="flex items-center gap-1 truncate text-slate-400">
                              <Phone className="h-3 w-3 shrink-0" />{' '}
                              <span className="min-w-0 truncate">{client.telefono}</span>
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-0 align-top">
                        {client.direccion ? (
                          <p className="flex min-w-0 items-center gap-1 truncate text-sm text-slate-400">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="min-w-0 truncate">
                              {client.direccion.colonia}, {client.direccion.ciudad}
                            </span>
                          </p>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-slate-400">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-slate-900 border-slate-800">
                            <DropdownMenuItem 
                              onClick={() => openEditDialog(client)}
                              className="text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                            >
                              <Edit2 className="w-4 h-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Nuevo Cliente</DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>
            
            <div className="space-y-2">
              <Label>RFC</Label>
              <Input
                value={formData.rfc}
                onChange={(e) => setFormData({ ...formData, rfc: e.target.value.toUpperCase() })}
                placeholder="XAXX010101000"
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Razón Social</Label>
              <Input
                value={formData.razonSocial}
                onChange={(e) => setFormData({ ...formData, razonSocial: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Código Postal</Label>
              <Input
                value={formData.codigoPostal}
                onChange={(e) => setFormData({ ...formData, codigoPostal: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Régimen Fiscal</Label>
              <select
                value={formData.regimenFiscal}
                onChange={(e) => setFormData({ ...formData, regimenFiscal: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
              >
                <option value="">Seleccione...</option>
                {REGIMENES_FISCALES.map(r => (
                  <option key={r.clave} value={r.clave}>{r.clave} - {r.descripcion}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Uso CFDI Predeterminado</Label>
              <select
                value={formData.usoCfdi}
                onChange={(e) => setFormData({ ...formData, usoCfdi: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
              >
                {USOS_CFDI.map(u => (
                  <option key={u.clave} value={u.clave}>{u.clave} - {u.descripcion}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2 border-t border-slate-800 pt-4">
              <p className="text-sm text-slate-500 mb-4">Dirección</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Calle</Label>
                  <Input
                    value={formData.calle}
                    onChange={(e) => setFormData({ ...formData, calle: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Número Exterior</Label>
                  <Input
                    value={formData.numeroExterior}
                    onChange={(e) => setFormData({ ...formData, numeroExterior: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Número Interior</Label>
                  <Input
                    value={formData.numeroInterior}
                    onChange={(e) => setFormData({ ...formData, numeroInterior: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Colonia</Label>
                  <Input
                    value={formData.colonia}
                    onChange={(e) => setFormData({ ...formData, colonia: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Ciudad</Label>
                  <Input
                    value={formData.ciudad}
                    onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Input
                    value={formData.estado}
                    onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-slate-700 text-slate-400">
              Cancelar
            </Button>
            <Button 
              onClick={handleAddClient}
              disabled={!formData.nombre}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Guardar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog - Similar structure */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
          </DialogHeader>
          
          {/* Same form fields as Add Dialog */}
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>
            
            <div className="space-y-2">
              <Label>RFC</Label>
              <Input
                value={formData.rfc}
                onChange={(e) => setFormData({ ...formData, rfc: e.target.value.toUpperCase() })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Razón Social</Label>
              <Input
                value={formData.razonSocial}
                onChange={(e) => setFormData({ ...formData, razonSocial: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Código Postal</Label>
              <Input
                value={formData.codigoPostal}
                onChange={(e) => setFormData({ ...formData, codigoPostal: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Régimen Fiscal</Label>
              <select
                value={formData.regimenFiscal}
                onChange={(e) => setFormData({ ...formData, regimenFiscal: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
              >
                <option value="">Seleccione...</option>
                {REGIMENES_FISCALES.map(r => (
                  <option key={r.clave} value={r.clave}>{r.clave} - {r.descripcion}</option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} className="border-slate-700 text-slate-400">
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
    </>
  );
}
