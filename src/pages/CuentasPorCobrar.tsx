import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useClients } from '@/hooks/useClients';
import { useAppStore } from '@/stores';
import type { Client } from '@/types';
import { formatMoney } from '@/lib/utils';

function saldoCliente(c: Client): number {
  const v = Number(c.saldoAdeudado);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

export function CuentasPorCobrar() {
  const { clients, loading, registrarAbonoCuenta } = useClients();
  const { addToast } = useAppStore();

  const deudores = useMemo(() => {
    const rows = clients.filter((c) => !c.isMostrador && saldoCliente(c) > 0.005);
    rows.sort((a, b) => saldoCliente(b) - saldoCliente(a));
    return rows;
  }, [clients]);

  const totalAdeudado = useMemo(
    () => deudores.reduce((s, c) => s + saldoCliente(c), 0),
    [deudores]
  );

  const [abonoCliente, setAbonoCliente] = useState<Client | null>(null);
  const [abonoMonto, setAbonoMonto] = useState('');
  const [abonoBusy, setAbonoBusy] = useState(false);

  const cerrarAbono = () => {
    setAbonoCliente(null);
    setAbonoMonto('');
  };

  const confirmarAbono = async () => {
    if (!abonoCliente) return;
    const norm = abonoMonto.replace(',', '.').trim();
    const m = parseFloat(norm);
    if (!Number.isFinite(m) || m <= 0) {
      addToast({ type: 'warning', message: 'Ingrese un monto válido mayor a cero.' });
      return;
    }
    setAbonoBusy(true);
    try {
      await registrarAbonoCuenta(abonoCliente.id, m);
      addToast({ type: 'success', message: `Abono registrado: ${formatMoney(m)}` });
      cerrarAbono();
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo registrar el abono',
      });
    } finally {
      setAbonoBusy(false);
    }
  };

  return (
    <PageShell
      title="Cuentas por cobrar"
      subtitle="Clientes con saldo pendiente por ventas en parcialidades (PPD). Los abonos ajustan la cuenta sin generar ticket de venta."
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5 dark:border-slate-800/50 dark:bg-slate-900/50 sm:px-4">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <Wallet className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400">Total por cobrar</p>
              <p className="text-lg font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                {formatMoney(totalAdeudado)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">
            {deudores.length} cliente{deudores.length === 1 ? '' : 's'} con saldo
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200/80 dark:border-slate-800/50">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">Cargando…</p>
          ) : deudores.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">
              No hay clientes con saldo pendiente. En el POS use{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Parcialidades (PPD)
              </span>{' '}
              y un cliente registrado para cobrar menos del total.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-700 dark:text-slate-300">Cliente</TableHead>
                  <TableHead className="text-right text-slate-700 dark:text-slate-300">Saldo</TableHead>
                  <TableHead className="w-[1%] text-slate-700 dark:text-slate-300">Abono</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deudores.map((c) => (
                  <TableRow
                    key={c.id}
                    className="border-slate-200 dark:border-slate-800"
                  >
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                      <span className="block truncate max-w-[min(100%,14rem)] sm:max-w-md">
                        {c.nombre}
                      </span>
                      {c.telefono?.trim() ? (
                        <span className="block text-xs font-normal text-slate-600 dark:text-slate-400">
                          {c.telefono.trim()}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-base font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {formatMoney(saldoCliente(c))}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="whitespace-nowrap border-slate-300 dark:border-slate-600"
                        onClick={() => {
                          setAbonoCliente(c);
                          setAbonoMonto('');
                        }}
                      >
                        Abonar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={abonoCliente != null} onOpenChange={(o) => !o && cerrarAbono()}>
        <DialogContent className="border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar abono</DialogTitle>
            <p className="text-left text-sm font-normal text-slate-600 dark:text-slate-400">
              {abonoCliente?.nombre}
              {abonoCliente ?
                <>
                  {' '}
                  · Saldo actual{' '}
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {formatMoney(saldoCliente(abonoCliente))}
                  </span>
                </>
              : null}
            </p>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="abono-monto">Monto del abono</Label>
            <Input
              id="abono-monto"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={abonoMonto}
              onChange={(e) => setAbonoMonto(e.target.value)}
              className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
              autoComplete="off"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={cerrarAbono} disabled={abonoBusy}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
              disabled={abonoBusy}
              onClick={() => void confirmarAbono()}
            >
              {abonoBusy ? 'Guardando…' : 'Guardar abono'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
