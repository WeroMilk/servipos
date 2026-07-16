import { useMemo, useState } from 'react';
import { Plus, Stamp, Printer, Users, X } from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEmployees, useNominaRecibos, reportNominaHookError } from '@/hooks/useNominas';
import { useFiscalConfig } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Employee, NominaConceptoLinea } from '@/types';
import { formatMoney, cn } from '@/lib/utils';
import { printNominaTimbradaCfdiLetter } from '@/lib/cfdiRepresentacionImpresa';
import { estimarIsrImssDesdePercepciones } from '@/lib/nominaDeduccionesEstimadas';

const emptyEmp = (): Omit<Employee, 'id' | 'createdAt' | 'updatedAt' | 'sucursalId'> => ({
  numeroEmpleado: '',
  nombre: '',
  rfc: '',
  curp: '',
  nss: '',
  tipoContrato: '01',
  tipoJornada: '01',
  tipoRegimen: '02',
  puesto: '',
  riesgoPuesto: '1',
  periodicidadPago: '04',
  fechaInicioRelLaboral: '',
  departamento: '',
  claveEntFed: 'JAL',
  codigoPostal: '',
  regimenFiscalReceptor: '605',
  banco: '',
  cuentaBancaria: '',
  activo: true,
});

export function Nominas() {
  const { employees, loading: loadingEmp, addEmployee } = useEmployees();
  const { recibos, loading: loadingRec, createBorrador, timbrar, cancelar } = useNominaRecibos();
  const { config: fiscalConfig } = useFiscalConfig();
  const { addToast } = useAppStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCrear = hasPermission('nominas:crear') || hasPermission('facturas:crear');
  const canTimbrar = hasPermission('nominas:timbrar') || hasPermission('facturas:timbrar');

  const [empOpen, setEmpOpen] = useState(false);
  const [empForm, setEmpForm] = useState(emptyEmp);
  const [reciboOpen, setReciboOpen] = useState(false);
  const [empleadoId, setEmpleadoId] = useState('');
  const [fechaPago, setFechaPago] = useState('');
  const [fechaIni, setFechaIni] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [dias, setDias] = useState('15');
  const [sueldo, setSueldo] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const activos = useMemo(() => employees.filter((e) => e.activo), [employees]);

  const saveEmployee = async () => {
    if (!canCrear) return;
    try {
      setBusy(true);
      await addEmployee({
        ...empForm,
        rfc: empForm.rfc.trim().toUpperCase(),
        curp: empForm.curp.trim().toUpperCase(),
        nombre: empForm.nombre.trim().toUpperCase(),
      });
      addToast({ type: 'success', message: 'Empleado guardado' });
      setEmpOpen(false);
      setEmpForm(emptyEmp());
    } catch (e) {
      reportNominaHookError('guardar empleado', e);
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Error al guardar' });
    } finally {
      setBusy(false);
    }
  };

  const crearRecibo = async () => {
    if (!canCrear || !fiscalConfig) return;
    const emp = activos.find((e) => e.id === empleadoId);
    if (!emp) {
      addToast({ type: 'warning', message: 'Seleccione un empleado' });
      return;
    }
    const sueldoN = parseFloat(sueldo.replace(',', '.'));
    if (!Number.isFinite(sueldoN) || sueldoN <= 0) {
      addToast({ type: 'warning', message: 'Sueldo inválido' });
      return;
    }
    const est = estimarIsrImssDesdePercepciones([
      { clave: '001', concepto: 'Sueldo', gravado: sueldoN, exento: 0 },
    ]);
    const percepciones: NominaConceptoLinea[] = [
      {
        tipo: '001',
        clave: '001',
        concepto: 'Sueldo',
        importeGravado: sueldoN,
        importeExento: 0,
      },
    ];
    const deducciones: NominaConceptoLinea[] = [
      {
        tipo: '002',
        clave: '002',
        concepto: 'ISR',
        importe: est.isr,
      },
      {
        tipo: '001',
        clave: '003',
        concepto: 'Seguridad social',
        importe: est.imss,
      },
    ];
    const totalPercepciones = sueldoN;
    const totalDeducciones = Math.round((est.isr + est.imss) * 100) / 100;
    const neto = Math.round((totalPercepciones - totalDeducciones) * 100) / 100;

    try {
      setBusy(true);
      await createBorrador({
        empleadoId: emp.id,
        empleado: emp,
        tipoNomina: 'O',
        fechaPago,
        fechaInicialPago: fechaIni,
        fechaFinalPago: fechaFin,
        numDiasPagados: parseInt(dias, 10) || 15,
        formaPago: '99',
        lugarExpedicion: fiscalConfig.lugarExpedicion,
        percepciones,
        deducciones,
        otrosPagos: [],
        totalPercepciones,
        totalDeducciones,
        totalOtrosPagos: 0,
        neto,
      });
      addToast({ type: 'success', message: 'Recibo creado (borrador). Timbre para validez SAT.' });
      setReciboOpen(false);
    } catch (e) {
      reportNominaHookError('crear recibo', e);
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Error al crear recibo' });
    } finally {
      setBusy(false);
    }
  };

  const handleTimbrar = async (id: string) => {
    if (!canTimbrar) return;
    setBusy(true);
    try {
      const stamped = await timbrar(id);
      addToast({
        type: 'success',
        message: `Nómina timbrada. UUID: ${stamped.uuid}`,
        logToAppEvents: true,
      });
    } catch (e) {
      reportNominaHookError('timbrar', e);
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo timbrar',
        logToAppEvents: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    setBusy(true);
    try {
      await cancelar(cancelId, '02');
      addToast({ type: 'success', message: 'Nómina cancelada ante el SAT', logToAppEvents: true });
      setCancelId(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo cancelar',
        logToAppEvents: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Nómina electrónica">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-1">
        {fiscalConfig?.modoPruebaFiscal ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            Modo prueba fiscal activo: no se puede timbrar nómina. Desactívelo en Configuración.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canCrear ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmpOpen(true)}
                className="border-slate-300 dark:border-slate-700"
              >
                <Users className="mr-2 h-4 w-4" />
                Alta empleado
              </Button>
              <Button
                type="button"
                className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                onClick={() => setReciboOpen(true)}
                disabled={!fiscalConfig || !!fiscalConfig.modoPruebaFiscal}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nuevo recibo
              </Button>
            </>
          ) : null}
        </div>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="py-3">
            <CardTitle className="text-base">Empleados ({activos.length})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {loadingEmp ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : activos.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Sin empleados. Capture el catálogo primero.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No.</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>RFC</TableHead>
                    <TableHead>Puesto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activos.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.numeroEmpleado}</TableCell>
                      <TableCell>{e.nombre}</TableCell>
                      <TableCell className="font-mono text-xs">{e.rfc}</TableCell>
                      <TableCell>{e.puesto}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="py-3">
            <CardTitle className="text-base">Recibos</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {loadingRec ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : recibos.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Sin recibos de nómina.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Folio</TableHead>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Neto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recibos.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.serie}-{r.folio}
                        {r.uuid ? (
                          <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                            {r.uuid.slice(0, 8)}…
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{r.empleado?.nombre ?? r.empleadoId}</TableCell>
                      <TableCell className="text-xs">
                        {r.fechaInicialPago} → {r.fechaFinalPago}
                      </TableCell>
                      <TableCell>{formatMoney(r.neto)}</TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            'border text-[10px]',
                            r.estado === 'timbrada'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                              : r.estado === 'cancelada'
                                ? 'border-red-500/40 bg-red-500/10 text-red-500'
                                : 'border-amber-500/40 bg-amber-500/10'
                          )}
                        >
                          {r.estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {r.estado === 'borrador' && canTimbrar ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void handleTimbrar(r.id)}
                          >
                            <Stamp className="mr-1 h-3.5 w-3.5" />
                            Timbrar
                          </Button>
                        ) : null}
                        {r.estado === 'timbrada' && fiscalConfig ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              printNominaTimbradaCfdiLetter({ config: fiscalConfig, recibo: r })
                            }
                          >
                            <Printer className="mr-1 h-3.5 w-3.5" />
                            Imprimir
                          </Button>
                        ) : null}
                        {r.estado === 'timbrada' && canTimbrar ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500"
                            onClick={() => setCancelId(r.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={empOpen} onOpenChange={setEmpOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Alta de empleado</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2 sm:grid-cols-2">
            {(
              [
                ['numeroEmpleado', 'No. empleado'],
                ['nombre', 'Nombre'],
                ['rfc', 'RFC'],
                ['curp', 'CURP'],
                ['nss', 'NSS'],
                ['puesto', 'Puesto'],
                ['fechaInicioRelLaboral', 'Inicio lab. (AAAA-MM-DD)'],
                ['codigoPostal', 'CP receptor'],
                ['claveEntFed', 'Entidad fed. (c_Estado)'],
                ['cuentaBancaria', 'CLABE / cuenta'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  value={String(empForm[key] ?? '')}
                  onChange={(e) => setEmpForm({ ...empForm, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmpOpen(false)}>
              Cerrar
            </Button>
            <Button disabled={busy} onClick={() => void saveEmployee()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reciboOpen} onOpenChange={setReciboOpen}>
        <DialogContent className="border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo recibo de nómina</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="space-y-1">
              <Label>Empleado</Label>
              <Select value={empleadoId} onValueChange={setEmpleadoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione" />
                </SelectTrigger>
                <SelectContent>
                  {activos.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.numeroEmpleado} — {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Fecha pago</Label>
                <Input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Días pagados</Label>
                <Input value={dias} onChange={(e) => setDias(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Inicio periodo</Label>
                <Input type="date" value={fechaIni} onChange={(e) => setFechaIni(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Fin periodo</Label>
                <Input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Sueldo del periodo (MXN)</Label>
              <Input value={sueldo} onChange={(e) => setSueldo(e.target.value)} inputMode="decimal" />
              <p className="text-[11px] text-slate-500">
                ISR/IMSS se estiman como ayuda; confirme montos antes de timbrar.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReciboOpen(false)}>
              Cerrar
            </Button>
            <Button disabled={busy} onClick={() => void crearRecibo()}>
              Crear borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelId != null} onOpenChange={(o) => !o && setCancelId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar nómina (motivo 02)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">Se enviará la cancelación a Facturama / SAT.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelId(null)}>
              Cerrar
            </Button>
            <Button className="bg-red-600 text-white" disabled={busy} onClick={() => void handleCancel()}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
