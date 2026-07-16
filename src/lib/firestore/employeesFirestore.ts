import type { Employee } from '@/types';
import { createDebouncedAsyncFn } from '@/lib/debouncedAsync';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (v instanceof Date) return v;
  return new Date();
}

function mapEmployee(sucursalId: string, id: string, doc: Record<string, unknown>): Employee {
  return {
    id,
    numeroEmpleado: String(doc.numeroEmpleado ?? ''),
    nombre: String(doc.nombre ?? ''),
    rfc: String(doc.rfc ?? ''),
    curp: String(doc.curp ?? ''),
    nss: typeof doc.nss === 'string' ? doc.nss : undefined,
    tipoContrato: String(doc.tipoContrato ?? '01'),
    tipoJornada: typeof doc.tipoJornada === 'string' ? doc.tipoJornada : undefined,
    tipoRegimen: String(doc.tipoRegimen ?? '02'),
    puesto: String(doc.puesto ?? ''),
    riesgoPuesto: typeof doc.riesgoPuesto === 'string' ? doc.riesgoPuesto : undefined,
    periodicidadPago: String(doc.periodicidadPago ?? '04'),
    fechaInicioRelLaboral: String(doc.fechaInicioRelLaboral ?? ''),
    departamento: typeof doc.departamento === 'string' ? doc.departamento : undefined,
    claveEntFed: String(doc.claveEntFed ?? ''),
    codigoPostal: String(doc.codigoPostal ?? ''),
    regimenFiscalReceptor: typeof doc.regimenFiscalReceptor === 'string' ? doc.regimenFiscalReceptor : '605',
    banco: typeof doc.banco === 'string' ? doc.banco : undefined,
    cuentaBancaria: typeof doc.cuentaBancaria === 'string' ? doc.cuentaBancaria : undefined,
    salarioBaseCotApor: doc.salarioBaseCotApor != null ? Number(doc.salarioBaseCotApor) : undefined,
    salarioDiarioIntegrado: doc.salarioDiarioIntegrado != null ? Number(doc.salarioDiarioIntegrado) : undefined,
    email: typeof doc.email === 'string' ? doc.email : undefined,
    activo: doc.activo !== false,
    sucursalId,
    createdAt: tsToDate(doc.createdAt),
    updatedAt: tsToDate(doc.updatedAt),
  };
}

export async function createEmployeeFirestore(
  sucursalId: string,
  employee: Omit<Employee, 'id' | 'createdAt' | 'updatedAt' | 'sucursalId'>
): Promise<string> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc: Record<string, unknown> = { ...employee, createdAt: now, updatedAt: now };
  const { error } = await supabase.from('employees').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function updateEmployeeFirestore(
  sucursalId: string,
  employeeId: string,
  updates: Partial<Employee>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('employees')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', employeeId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Empleado no encontrado');
  const now = new Date().toISOString();
  const doc = { ...(row.doc as Record<string, unknown>), ...updates, updatedAt: now };
  const { error } = await supabase
    .from('employees')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', employeeId);
  if (error) throw new Error(error.message);
}

export async function deleteEmployeeFirestore(sucursalId: string, employeeId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('employees')
    .delete()
    .eq('sucursal_id', sucursalId)
    .eq('id', employeeId);
  if (error) throw new Error(error.message);
}

let lastEmployees: Employee[] = [];
const employeesListeners = new Set<(rows: Employee[]) => void>();
let employeesChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let employeesSucursalId: string | null = null;
let employeesReloadDebounced: (() => void) | null = null;

export function getEmployeesCatalogSnapshot(): Employee[] {
  return lastEmployees;
}

export function subscribeEmployeesCatalog(
  sucursalId: string,
  onData: (rows: Employee[]) => void
): () => void {
  onData([...lastEmployees]);
  employeesListeners.add(onData);
  const supabase = getSupabase();

  const load = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Employees:', error);
      return;
    }
    lastEmployees = (data ?? [])
      .map((r) => mapEmployee(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    employeesListeners.forEach((l) => {
      try {
        l([...lastEmployees]);
      } catch (e) {
        console.error(e);
      }
    });
  };

  if (employeesSucursalId !== sucursalId) {
    if (employeesChannel) void supabase.removeChannel(employeesChannel);
    employeesSucursalId = sucursalId;
    employeesReloadDebounced = createDebouncedAsyncFn(load, 500);
    lastEmployees = [];
    void load();
    employeesChannel = supabase
      .channel(`employees-${sucursalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employees', filter: `sucursal_id=eq.${sucursalId}` },
        () => employeesReloadDebounced?.()
      )
      .subscribe();
  } else {
    onData([...lastEmployees]);
  }

  return () => {
    employeesListeners.delete(onData);
  };
}
