import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Building2,
  Receipt,
  Save,
  AlertTriangle,
  Check,
  Key,
  FileKey,
  Lock,
  Users,
  MapPin,
  Wallet,
  Package,
  Truck,
  Shield,
  Printer,
  Plus,
  Minus,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFiscalConfig, useEffectiveSucursalId } from '@/hooks';
import { reservePruebaNominaFolio } from '@/db/database';
import { printNominaPruebaLetter } from '@/lib/printTicket';
import { useAppStore, useAuthStore, useInventoryListsStore } from '@/stores';
import { UserManagement } from '@/components/ui-custom/UserManagement';
import { UserPermissionsEditor } from '@/components/ui-custom/UserPermissionsEditor';
import { SucursalManagement } from '@/components/ui-custom/SucursalManagement';
import { PageShell } from '@/components/ui-custom/PageShell';
import { HistorialAbastoConfig } from '@/components/ui-custom/HistorialAbastoConfig';
import { REGIMENES_FISCALES, USOS_CFDI } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import {
  getNominaPruebaDraftDefaults,
  type NominaPruebaDraftForm,
} from '@/lib/cfdiRepresentacionImpresa';
import {
  estimarIsrImssDesdePercepciones,
  normClaveNomina,
  parseNominaMoneyInput,
} from '@/lib/nominaDeduccionesEstimadas';

const NOMINA_STORAGE_KEY = 'servipartz-nomina-prueba-draft';

function loadNominaDraftFromStorage(): NominaPruebaDraftForm {
  try {
    const raw = localStorage.getItem(NOMINA_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<NominaPruebaDraftForm>;
      const d = getNominaPruebaDraftDefaults();
      return {
        receptor: { ...d.receptor, ...p.receptor },
        periodo: { ...d.periodo, ...p.periodo },
        percepciones:
          Array.isArray(p.percepciones) && p.percepciones.length > 0
            ? p.percepciones.map((r) => ({
                clave: String(r.clave ?? ''),
                concepto: String(r.concepto ?? ''),
                gravado: Number(r.gravado) || 0,
                exento: Number(r.exento) || 0,
              }))
            : d.percepciones,
        deducciones:
          Array.isArray(p.deducciones) && p.deducciones.length > 0
            ? p.deducciones.map((r) => ({
                clave: String(r.clave ?? ''),
                concepto: String(r.concepto ?? ''),
                importe: Number(r.importe) || 0,
              }))
            : d.deducciones,
      };
    }
  } catch {
    /* noop */
  }
  return getNominaPruebaDraftDefaults();
}

export function Configuracion() {
  const { config, isConfigured, saveConfig, updateConfig, refresh } = useFiscalConfig();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const { addToast } = useAppStore();
  const { hasPermission, user } = useAuthStore();
  const normalizedUsername = (user?.username ?? '').trim().toLowerCase();
  const normalizedName = (user?.name ?? '').trim().toLowerCase();
  const emailLocalPart = (user?.email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  const isGabrielCashierBlocked =
    user?.role === 'cashier' &&
    (normalizedUsername === 'gabriel' ||
      normalizedName === 'gabriel' ||
      emailLocalPart === 'gabriel');
  const canManageUsers = hasPermission('usuarios:gestionar');
  const canManageSucursales = hasPermission('sucursales:gestionar');
  const canEditListaPreciosCliente = hasPermission('configuracion:editar');
  const canVerHistorialAbasto = hasPermission('configuracion:ver');
  const categoriasInventario = useInventoryListsStore((s) => s.categorias);
  const proveedoresInventario = useInventoryListsStore((s) => s.proveedores);
  const setCategoriasInventario = useInventoryListsStore((s) => s.setCategorias);
  const setProveedoresInventario = useInventoryListsStore((s) => s.setProveedores);
  const [draftCategorias, setDraftCategorias] = useState('');
  const [draftProveedores, setDraftProveedores] = useState('');
  const adminExtraTabs =
    (canManageUsers ? 2 : 0) +
    (canManageSucursales ? 1 : 0) +
    (canEditListaPreciosCliente ? 1 : 0) +
    (canVerHistorialAbasto ? 1 : 0);
  const totalTabs = 4 + adminExtraTabs;

  const allowedConfigTabs = useMemo(() => {
    const t: string[] = ['fiscal', 'empresa', 'certificados', 'nominas'];
    if (canManageSucursales) t.push('sucursales');
    if (canManageUsers) {
      t.push('usuarios');
      t.push('permisos');
    }
    if (canEditListaPreciosCliente) t.push('inventario-listas');
    if (canVerHistorialAbasto) t.push('historial-abasto');
    return t;
  }, [canManageSucursales, canManageUsers, canEditListaPreciosCliente, canVerHistorialAbasto]);

  const [activeTab, setActiveTab] = useState('fiscal');

  useEffect(() => {
    if (!allowedConfigTabs.includes(activeTab)) {
      setActiveTab('fiscal');
    }
  }, [allowedConfigTabs, activeTab]);

  const [nominaPruebaForm, setNominaPruebaForm] = useState<NominaPruebaDraftForm>(() =>
    loadNominaDraftFromStorage()
  );

  /** Texto en edición para Gravado/Exento (evita que el 0 bloquee borrar y escribir). */
  const [nominaPercDraft, setNominaPercDraft] = useState<Record<string, string>>({});

  // Fiscal form state
  const [fiscalForm, setFiscalForm] = useState({
    rfc: '',
    razonSocial: '',
    nombreComercial: '',
    regimenFiscal: '',
    codigoUsoCfdi: 'G03',
    serie: 'A',
    folioActual: 1,
    serieNomina: 'N',
    folioNominaActual: 1,
    modoPruebaFiscal: false,
    lugarExpedicion: '',
    telefono: '',
    email: '',
    calle: '',
    numeroExterior: '',
    numeroInterior: '',
    colonia: '',
    codigoPostal: '',
    ciudad: '',
    municipio: '',
    estado: '',
  });

  // Load config into form
  useEffect(() => {
    if (config) {
      setFiscalForm({
        rfc: config.rfc || '',
        razonSocial: config.razonSocial || '',
        nombreComercial: config.nombreComercial || '',
        regimenFiscal: config.regimenFiscal || '',
        codigoUsoCfdi: config.codigoUsoCfdi || 'G03',
        serie: config.serie || 'A',
        folioActual: config.folioActual || 1,
        serieNomina: config.serieNomina ?? 'N',
        folioNominaActual: config.folioNominaActual ?? 1,
        modoPruebaFiscal: config.modoPruebaFiscal ?? false,
        lugarExpedicion: config.lugarExpedicion || '',
        telefono: config.telefono || '',
        email: config.email || '',
        calle: config.direccion?.calle || '',
        numeroExterior: config.direccion?.numeroExterior || '',
        numeroInterior: config.direccion?.numeroInterior || '',
        colonia: config.direccion?.colonia || '',
        codigoPostal: config.direccion?.codigoPostal || '',
        ciudad: config.direccion?.ciudad || '',
        municipio: config.direccion?.municipio || '',
        estado: config.direccion?.estado || '',
      });
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(NOMINA_STORAGE_KEY, JSON.stringify(nominaPruebaForm));
    } catch {
      /* noop */
    }
  }, [nominaPruebaForm]);

  useEffect(() => {
    setNominaPruebaForm((f) => {
      const { isr, imss } = estimarIsrImssDesdePercepciones(f.percepciones);
      let changed = false;
      const nextDed = f.deducciones.map((row) => {
        const k = normClaveNomina(row.clave);
        if (k === '002') {
          if (row.importe !== isr) changed = true;
          return { ...row, importe: isr };
        }
        if (k === '021') {
          if (row.importe !== imss) changed = true;
          return { ...row, importe: imss };
        }
        return row;
      });
      if (!changed) return f;
      return { ...f, deducciones: nextDed };
    });
  }, [nominaPruebaForm.percepciones]);

  useEffect(() => {
    setNominaPercDraft({});
  }, [nominaPruebaForm.percepciones.length]);

  const handleSaveFiscal = async () => {
    try {
      await saveConfig({
        ...fiscalForm,
        direccion: {
          calle: fiscalForm.calle,
          numeroExterior: fiscalForm.numeroExterior,
          numeroInterior: fiscalForm.numeroInterior,
          colonia: fiscalForm.colonia,
          codigoPostal: fiscalForm.codigoPostal,
          ciudad: fiscalForm.ciudad,
          municipio: fiscalForm.municipio,
          estado: fiscalForm.estado,
          pais: 'México',
        },
      } as any);
      
      addToast({ type: 'success', message: 'Configuración fiscal guardada exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const isFormValid = () => {
    return (
      fiscalForm.rfc &&
      fiscalForm.razonSocial &&
      fiscalForm.regimenFiscal &&
      fiscalForm.serie &&
      fiscalForm.lugarExpedicion
    );
  };

  useEffect(() => {
    if (activeTab !== 'inventario-listas') return;
    setDraftCategorias(categoriasInventario.join('\n'));
    setDraftProveedores(proveedoresInventario.join('\n'));
  }, [activeTab, categoriasInventario, proveedoresInventario]);

  const handleSaveInventarioListas = () => {
    setCategoriasInventario(draftCategorias.split('\n'));
    setProveedoresInventario(draftProveedores.split('\n'));
    addToast({ type: 'success', message: 'Listas de inventario guardadas en este equipo.' });
  };

  const handlePrintNominaPrueba = async () => {
    if (!config?.rfc?.trim() || !config.razonSocial?.trim()) {
      addToast({
        type: 'error',
        message: 'Complete y guarde los datos fiscales (RFC, razón social, régimen, CP) en «Datos fiscales».',
      });
      return;
    }
    try {
      const { serie, folio } = await reservePruebaNominaFolio();
      printNominaPruebaLetter({
        config,
        serie,
        folio,
        sucursalId: effectiveSucursalId,
        receptor: nominaPruebaForm.receptor,
        periodo: nominaPruebaForm.periodo,
        percepciones: nominaPruebaForm.percepciones,
        deducciones: nominaPruebaForm.deducciones,
      });
      await refresh();
      addToast({ type: 'success', message: 'Vista de impresión del recibo de prueba abierta.' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo abrir la impresión',
      });
    }
  };

  const handleSaveNominaFolios = async () => {
    const serie = fiscalForm.serieNomina?.trim();
    if (!serie || !fiscalForm.folioNominaActual) return;
    try {
      if (!config) {
        addToast({
          type: 'error',
          message: 'Guarde primero los datos fiscales en la pestaña «Datos fiscales».',
        });
        return;
      }
      await updateConfig({
        serieNomina: serie,
        folioNominaActual: fiscalForm.folioNominaActual,
      });
      addToast({ type: 'success', message: 'Folios de nómina guardados' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al guardar';
      addToast({ type: 'error', message });
    }
  };

  const fieldClass =
    'h-11 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 text-base leading-normal text-slate-900 dark:text-slate-100 sm:h-8 sm:text-sm lg:h-7 lg:py-1 lg:text-xs';
  const selectClass =
    'h-11 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 px-3 py-2 text-base leading-normal text-slate-900 dark:text-slate-100 sm:h-8 sm:py-1 sm:text-sm lg:h-7 lg:py-1 lg:text-xs';
  const csdFileInputClass = cn(
    'h-11 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 px-2 text-base leading-normal text-slate-900 dark:text-slate-100 sm:h-10 sm:text-sm',
    'file:mr-2 file:h-9 sm:file:h-8 file:rounded-full file:border-0 file:bg-gradient-to-r file:from-cyan-500 file:to-blue-600 file:px-3.5 file:text-sm file:font-semibold file:text-white',
    'hover:file:from-cyan-400 hover:file:to-blue-500 dark:hover:file:from-cyan-400 dark:hover:file:to-blue-500'
  );

  /** Pestañas tipo subrayado (activa = borde inferior cyan), sin bloque de fondo. */
  const configuracionTabTriggerClass = cn(
    'h-auto min-h-11 shrink-0 flex-none justify-center rounded-none border-0 border-b-2 border-transparent bg-transparent px-2.5 py-2.5 text-center text-sm leading-snug text-slate-600 shadow-none ring-offset-0 sm:min-h-11 sm:px-3',
    'whitespace-normal [text-wrap:balance]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 dark:focus-visible:ring-offset-slate-950',
    'data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent data-[state=active]:text-cyan-700 data-[state=active]:shadow-none',
    'dark:text-slate-400 dark:data-[state=active]:text-cyan-400 xl:w-full xl:flex-1'
  );

  /** Un solo scroll vertical por pestaña para que en escritorio se vea todo el formulario (incl. datos fiscales). */
  const configuracionTabsPanelClass =
    'mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] outline-none data-[state=inactive]:hidden';

  /**
   * Pestañas con componentes embebidos (lista + panel interno con scroll): el panel NO debe hacer scroll
   * completo; si no, el flex interno no recibe alto acotado y el contenido queda recortado en móvil.
   */
  const configuracionTabsPanelFillClass =
    'mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden';

  const totalPercepcionesNomina = nominaPruebaForm.percepciones.reduce(
    (s, p) => s + (Number(p.gravado) || 0) + (Number(p.exento) || 0),
    0
  );
  const totalDeduccionesNomina = nominaPruebaForm.deducciones.reduce(
    (s, d) => s + (Number(d.importe) || 0),
    0
  );
  const netoNominaPreview = totalPercepcionesNomina - totalDeduccionesNomina;

  if (isGabrielCashierBlocked) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Configuración"
      subtitle="Sistema y datos fiscales"
      className="min-w-0 max-w-none"
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 overflow-hidden sm:gap-2">
        {!isConfigured ? (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 sm:px-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 sm:h-5 sm:w-5" />
            <p className="min-w-0 text-xs leading-snug text-amber-400/90 sm:text-sm">
              <span className="font-medium text-amber-400">Incompleta.</span>{' '}
              Complete datos fiscales para facturar.
            </p>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 sm:px-3">
            <Check className="h-4 w-4 shrink-0 text-emerald-400 sm:h-5 sm:w-5" />
            <p className="min-w-0 text-xs leading-snug text-emerald-400/90 sm:text-sm">
              <span className="font-medium text-emerald-400">Listo</span> para generar facturas.
            </p>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 overflow-hidden sm:gap-2"
        >
        {/*
          Scroll horizontal en un wrapper dedicado + touch-pan-x: en varios móviles el swipe en la fila de pestañas
          no funcionaba bien con overflow solo en TabsList (Radix/shrink). En xl la rejilla ocupa todo el ancho.
        */}
        <div
          data-wheel-scroll-x="strip"
          className="min-w-0 w-full shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] touch-pan-x xl:overflow-x-visible"
        >
          <TabsList
            className={cn(
              'flex h-auto w-max min-w-full flex-nowrap items-center justify-start gap-0 border-b border-slate-200/80 bg-transparent p-0 dark:border-slate-800/60 dark:bg-transparent',
              'xl:grid xl:w-full xl:min-w-0 xl:justify-normal',
              totalTabs <= 4 && 'xl:grid-cols-4',
              totalTabs === 5 && 'xl:grid-cols-5',
              totalTabs === 6 && 'xl:grid-cols-6',
              totalTabs === 7 && 'xl:grid-cols-7',
              totalTabs === 8 && 'xl:grid-cols-8',
              totalTabs >= 9 && 'xl:grid-cols-9'
            )}
          >
          <TabsTrigger value="fiscal" className={configuracionTabTriggerClass}>
            <Receipt className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Datos fiscales
          </TabsTrigger>
          <TabsTrigger value="empresa" className={configuracionTabTriggerClass}>
            <Building2 className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Empresa
          </TabsTrigger>
          <TabsTrigger value="certificados" className={configuracionTabTriggerClass}>
            <FileKey className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Certificados
          </TabsTrigger>
          <TabsTrigger value="nominas" className={configuracionTabTriggerClass}>
            <Wallet className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Nominas
          </TabsTrigger>
          {canManageSucursales && (
            <TabsTrigger value="sucursales" className={configuracionTabTriggerClass}>
              <MapPin className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Sucursales
            </TabsTrigger>
          )}
          {canManageUsers && (
            <TabsTrigger value="usuarios" className={configuracionTabTriggerClass}>
              <Users className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Usuarios
            </TabsTrigger>
          )}
          {canManageUsers && (
            <TabsTrigger value="permisos" className={configuracionTabTriggerClass}>
              <Shield className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Permisos
            </TabsTrigger>
          )}
          {canEditListaPreciosCliente && (
            <TabsTrigger value="inventario-listas" className={configuracionTabTriggerClass}>
              <Package className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Inventario
            </TabsTrigger>
          )}
          {canVerHistorialAbasto && (
            <TabsTrigger value="historial-abasto" className={configuracionTabTriggerClass}>
              <Truck className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Abasto
            </TabsTrigger>
          )}
          </TabsList>
        </div>

        <TabsContent value="fiscal" className={configuracionTabsPanelClass}>
          <Card className="w-full min-w-0 shrink-0 border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-1 px-3 py-2 sm:px-4 lg:px-3 lg:py-1.5">
              <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-100 sm:text-base lg:text-sm">
                <Receipt className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5 lg:h-4 lg:w-4" />
                Datos fiscales CFDI 4.0
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-3 pt-0 sm:p-4 sm:pt-0 sm:pb-4 lg:gap-1.5 lg:p-2 lg:pt-0 lg:pb-3">
              <div className="min-w-0 w-full">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:gap-4 xl:gap-6">
                  {/* Columna principal (CFDI); en lg+ comparte fila con dirección */}
                  <div className="min-w-0 flex-1 space-y-2 lg:space-y-1">
                    <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-2 lg:gap-y-1">
                      <div className="space-y-1">
                        <Label htmlFor="rfc" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                          RFC *
                        </Label>
                        <Input
                          id="rfc"
                          value={fiscalForm.rfc}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, rfc: e.target.value.toUpperCase() })
                          }
                          placeholder="XAXX010101000"
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                        <Label htmlFor="razonSocial" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                          Razón social *
                        </Label>
                        <Input
                          id="razonSocial"
                          value={fiscalForm.razonSocial}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, razonSocial: e.target.value })
                          }
                          placeholder="Nombre fiscal ante el SAT"
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor="nombreComercial"
                          className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs"
                        >
                          Nombre comercial
                        </Label>
                        <Input
                          id="nombreComercial"
                          value={fiscalForm.nombreComercial}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, nombreComercial: e.target.value })
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                        <Label htmlFor="regimenFiscal" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                          Régimen fiscal *
                        </Label>
                        <select
                          id="regimenFiscal"
                          value={fiscalForm.regimenFiscal}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, regimenFiscal: e.target.value })
                          }
                          className={selectClass}
                        >
                          <option value="">Seleccione…</option>
                          {REGIMENES_FISCALES.map((r) => (
                            <option key={r.clave} value={r.clave}>
                              {r.clave} - {r.descripcion}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="serie" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                          Serie *
                        </Label>
                        <Input
                          id="serie"
                          value={fiscalForm.serie}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, serie: e.target.value.toUpperCase() })
                          }
                          placeholder="A"
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="folioActual" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                          Folio actual *
                        </Label>
                        <Input
                          id="folioActual"
                          type="number"
                          value={fiscalForm.folioActual}
                          onChange={(e) =>
                            setFiscalForm({
                              ...fiscalForm,
                              folioActual: parseInt(e.target.value, 10) || 1,
                            })
                          }
                          className={fieldClass}
                          disabled={fiscalForm.modoPruebaFiscal}
                          title={
                            fiscalForm.modoPruebaFiscal
                              ? 'En modo prueba las facturas no usan este folio'
                              : undefined
                          }
                        />
                      </div>
                      <div className="col-span-full flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-100/70 p-2 dark:border-slate-700 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between sm:p-3 lg:gap-1.5 lg:py-1.5 lg:pl-2 lg:pr-2">
                        <div className="min-w-0 space-y-1">
                          <Label
                            htmlFor="modoPruebaFiscal"
                            className="text-sm font-medium text-slate-700 dark:text-slate-300 sm:text-xs"
                          >
                            Modo prueba (facturas y vistas de nómina)
                          </Label>
                          <p className="text-sm leading-snug text-slate-600 dark:text-slate-400 sm:text-xs lg:hidden">
                            Las facturas nuevas llevan serie PRUEBA y no avanzan el folio oficial. Las impresiones de
                            recibo de nómina de prueba usan PRUEBA-N y no tocan el folio de nómina SAT. Para
                            producción: desactiva esta opción, guarda aquí tu serie y folio autorizados y timbra con tu
                            PAC; el solo hecho de ingresar folios no sustituye el timbrado.
                          </p>
                          <p
                            className="hidden text-[11px] leading-snug text-slate-500 dark:text-slate-400 lg:block"
                            title="Las facturas nuevas llevan serie PRUEBA y no avanzan el folio oficial. Nómina de prueba: PRUEBA-N. Para producción desactive, guarde serie/folio y timbre con su PAC."
                          >
                            Serie/folio PRUEBA y PRUEBA-N; no sustituye timbrado con PAC. Pase el cursor para más
                            detalle.
                          </p>
                        </div>
                        <Switch
                          id="modoPruebaFiscal"
                          checked={fiscalForm.modoPruebaFiscal}
                          onCheckedChange={(checked) =>
                            setFiscalForm({ ...fiscalForm, modoPruebaFiscal: checked })
                          }
                          className="shrink-0 sm:ml-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor="lugarExpedicion"
                          className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs"
                        >
                          Lugar expedición (CP) *
                        </Label>
                        <Input
                          id="lugarExpedicion"
                          value={fiscalForm.lugarExpedicion}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, lugarExpedicion: e.target.value })
                          }
                          placeholder="00000"
                          maxLength={5}
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                        <Label htmlFor="codigoUsoCfdi" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                          Uso CFDI predeterminado
                        </Label>
                        <select
                          id="codigoUsoCfdi"
                          value={fiscalForm.codigoUsoCfdi}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, codigoUsoCfdi: e.target.value })
                          }
                          className={selectClass}
                        >
                          {USOS_CFDI.map((u) => (
                            <option key={u.clave} value={u.clave}>
                              {u.clave} - {u.descripcion}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Dirección fiscal: debajo en móvil; columna derecha en lg+ */}
                  <div className="min-w-0 flex-1 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800/80 lg:w-[min(100%,20rem)] lg:flex-none lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 xl:w-[min(100%,22rem)] xl:pl-5">
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-500 sm:text-xs lg:text-[11px]">
                      Dirección fiscal
                    </p>
                    <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:gap-y-1">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Calle</Label>
                        <Input
                          value={fiscalForm.calle}
                          onChange={(e) => setFiscalForm({ ...fiscalForm, calle: e.target.value })}
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Colonia</Label>
                        <Input
                          value={fiscalForm.colonia}
                          onChange={(e) => setFiscalForm({ ...fiscalForm, colonia: e.target.value })}
                          className={fieldClass}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                        <div className="space-y-1">
                          <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">No. ext.</Label>
                          <Input
                            value={fiscalForm.numeroExterior}
                            onChange={(e) =>
                              setFiscalForm({ ...fiscalForm, numeroExterior: e.target.value })
                            }
                            className={fieldClass}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">No. int.</Label>
                          <Input
                            value={fiscalForm.numeroInterior}
                            onChange={(e) =>
                              setFiscalForm({ ...fiscalForm, numeroInterior: e.target.value })
                            }
                            className={fieldClass}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">C.P.</Label>
                        <Input
                          value={fiscalForm.codigoPostal}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, codigoPostal: e.target.value })
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Ciudad</Label>
                        <Input
                          value={fiscalForm.ciudad}
                          onChange={(e) => setFiscalForm({ ...fiscalForm, ciudad: e.target.value })}
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Municipio</Label>
                        <Input
                          value={fiscalForm.municipio}
                          onChange={(e) =>
                            setFiscalForm({ ...fiscalForm, municipio: e.target.value })
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Estado</Label>
                        <Input
                          value={fiscalForm.estado}
                          onChange={(e) => setFiscalForm({ ...fiscalForm, estado: e.target.value })}
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 justify-end border-t border-slate-200/80 pt-3 dark:border-slate-800/60 lg:pt-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveFiscal}
                  disabled={!isFormValid()}
                  className={cn(
                    'bg-gradient-to-r from-cyan-500 to-blue-600 text-white',
                    !isFormValid() && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Guardar fiscal
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="empresa" className={cn(configuracionTabsPanelClass, 'justify-start')}>
          <Card className="w-full shrink-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-0 border-b border-slate-200/70 px-3 py-2.5 dark:border-slate-800/50 sm:px-4">
              <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-100 sm:text-base">
                <Building2 className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5" />
                Información de la empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-3 sm:p-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="empresa-telefono" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                    Teléfono
                  </Label>
                  <Input
                    id="empresa-telefono"
                    value={fiscalForm.telefono}
                    onChange={(e) => setFiscalForm({ ...fiscalForm, telefono: e.target.value })}
                    placeholder="(55) 1234-5678"
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                  <Label htmlFor="empresa-email" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                    Email de contacto
                  </Label>
                  <Input
                    id="empresa-email"
                    type="email"
                    value={fiscalForm.email}
                    onChange={(e) => setFiscalForm({ ...fiscalForm, email: e.target.value })}
                    placeholder="contacto@empresa.com"
                    className={fieldClass}
                  />
                </div>
              </div>
              <div className="flex justify-end border-t border-slate-200/80 pt-3 dark:border-slate-800/60">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveFiscal}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Guardar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certificados" className={configuracionTabsPanelClass}>
          <div className="flex w-full min-w-0 flex-col gap-3 xl:grid xl:min-h-0 xl:grid-cols-2 xl:gap-3 xl:overflow-hidden">
            <Card className="w-full shrink-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 xl:min-h-0 xl:shrink xl:flex xl:flex-col xl:overflow-hidden">
              <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
                <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-100 sm:text-base">
                  <FileKey className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                  CSD (sello digital)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-3 sm:p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-y-contain">
                <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400 sm:h-5 sm:w-5" />
                  <p className="text-sm leading-snug text-amber-400/90 sm:text-xs">
                    CSD del SAT para timbrar en producción. En esta demo el XML se genera sin
                    timbrar.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Certificado (.cer)</Label>
                    <Input
                      type="file"
                      accept=".cer"
                      className={csdFileInputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Llave (.key)</Label>
                    <Input
                      type="file"
                      accept=".key"
                      className={csdFileInputClass}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">Contraseña de la llave</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      className={fieldClass}
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1 xl:mt-auto">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                  >
                    <Lock className="mr-2 h-4 w-4" />
                    Configurar CSD
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="w-full shrink-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 xl:min-h-0 xl:shrink xl:flex xl:flex-col xl:overflow-hidden">
              <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
                <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-100 sm:text-base">
                  <Key className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                  Soporte (timbrado)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-y-contain">
                <div className="rounded-lg bg-slate-200/60 dark:bg-slate-800/30 p-3 sm:p-3">
                  <p className="text-sm text-slate-600 dark:text-slate-400 sm:text-sm">
                    Para timbrar ante el SAT contacte a Soporte:
                  </p>
                  <div className="mt-2 flex gap-2 text-sm text-slate-700 dark:text-slate-300 sm:text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400 sm:h-3.5 sm:w-3.5" />
                    <div className="min-w-0 space-y-1.5">
                      <p>Luis Alfonso Silvas Madrid</p>
                      <p>
                        <a
                          href="mailto:asilvasm97@gmail.com"
                          className="text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
                        >
                          asilvasm97@gmail.com
                        </a>
                      </p>
                      <p>
                        <a
                          href="tel:+526623501632"
                          className="text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
                        >
                          6623501632
                        </a>
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="nominas" className={configuracionTabsPanelClass}>
          <div className="flex w-full min-w-0 flex-col gap-3 xl:grid xl:min-h-0 xl:grid-cols-2 xl:items-start xl:gap-3 xl:overflow-hidden">
            <Card className="w-full min-w-0 shrink-0 gap-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 xl:min-h-0 xl:max-h-[min(100dvh-9.5rem,920px)] xl:overflow-hidden xl:flex xl:flex-col">
              <CardHeader className="shrink-0 space-y-0 px-3 py-1.5 sm:px-4 lg:py-1">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100 sm:text-base lg:text-sm">
                  <Wallet className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5 lg:h-4 lg:w-4" />
                  Nómina electrónica (CFDI)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-2.5 sm:p-3 lg:gap-1.5 lg:p-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-y-contain">
                <div className="flex gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 lg:p-1.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400 lg:h-3.5 lg:w-3.5" />
                  <p className="text-[11px] leading-snug text-emerald-400/95 sm:text-xs lg:text-[11px]">
                    Con <span className="font-medium text-emerald-300">serie y folio SAT</span>,{' '}
                    <span className="font-medium text-emerald-300">CSD</span> y{' '}
                    <span className="font-medium text-emerald-300">PAC</span> de nómina, el CFDI es válido ante el SAT.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-300/80 dark:border-slate-600/80 bg-slate-100/60 dark:bg-slate-800/40 p-2 sm:p-2.5 lg:p-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 lg:mb-1.5">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 lg:text-[11px]">
                      Personalizar recibo de prueba
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 border-slate-400/60 text-[11px] lg:h-6"
                      onClick={() => {
                        setNominaPruebaForm(getNominaPruebaDraftDefaults());
                        setNominaPercDraft({});
                        addToast({ type: 'success', message: 'Valores restaurados al ejemplo.' });
                      }}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Restaurar ejemplo
                    </Button>
                  </div>
                  <p className="mb-2 text-[11px] leading-snug text-slate-600 dark:text-slate-400 lg:mb-1.5">
                    Edita datos y montos; totales al imprimir. Se guarda local en este equipo.
                  </p>

                  <div className="space-y-1.5 lg:space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Trabajador (receptor)
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:gap-1">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Nombre completo</Label>
                        <Input
                          value={nominaPruebaForm.receptor.nombre}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              receptor: { ...f.receptor, nombre: e.target.value },
                            }))
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">RFC</Label>
                        <Input
                          value={nominaPruebaForm.receptor.rfc}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              receptor: { ...f.receptor, rfc: e.target.value.toUpperCase() },
                            }))
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">CURP</Label>
                        <Input
                          value={nominaPruebaForm.receptor.curp}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              receptor: { ...f.receptor, curp: e.target.value.toUpperCase() },
                            }))
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Núm. empleado</Label>
                        <Input
                          value={nominaPruebaForm.receptor.numeroEmpleado}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              receptor: { ...f.receptor, numeroEmpleado: e.target.value },
                            }))
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Departamento</Label>
                        <Input
                          value={nominaPruebaForm.receptor.departamento}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              receptor: { ...f.receptor, departamento: e.target.value },
                            }))
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Puesto</Label>
                        <Input
                          value={nominaPruebaForm.receptor.puesto}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              receptor: { ...f.receptor, puesto: e.target.value },
                            }))
                          }
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1.5 lg:mt-1.5 lg:space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Periodo de pago
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 lg:gap-1">
                      <div className="space-y-1 sm:col-span-3">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Descripción del periodo</Label>
                        <Input
                          value={nominaPruebaForm.periodo.descripcion}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              periodo: { ...f.periodo, descripcion: e.target.value },
                            }))
                          }
                          placeholder="Ej. 1 al 15 de marzo 2026"
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Días pagados</Label>
                        <Input
                          value={nominaPruebaForm.periodo.diasPagados}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              periodo: { ...f.periodo, diasPagados: e.target.value },
                            }))
                          }
                          placeholder="15"
                          className={fieldClass}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">Tipo de nómina</Label>
                        <Input
                          value={nominaPruebaForm.periodo.tipoNomina}
                          onChange={(e) =>
                            setNominaPruebaForm((f) => ({
                              ...f,
                              periodo: { ...f.periodo, tipoNomina: e.target.value },
                            }))
                          }
                          placeholder="Ej. O (ordinaria)"
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1.5 lg:mt-1.5 lg:space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Percepciones
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setNominaPruebaForm((f) => ({
                            ...f,
                            percepciones: [
                              ...f.percepciones,
                              { clave: '', concepto: '', gravado: 0, exento: 0 },
                            ],
                          }))
                        }
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Fila
                      </Button>
                    </div>
                    <div className="space-y-1.5 lg:space-y-1">
                      {nominaPruebaForm.percepciones.map((row, idx) => (
                        <div
                          key={`p-${idx}`}
                          className="grid grid-cols-1 gap-1 rounded-lg border border-slate-200/90 bg-slate-50/80 p-1.5 dark:border-slate-700/80 dark:bg-slate-900/40 sm:grid-cols-12 sm:items-end lg:p-1"
                        >
                          <div className="space-y-0.5 sm:col-span-2">
                            <Label className="text-[10px] text-slate-500">Clave</Label>
                            <Input
                              value={row.clave}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNominaPruebaForm((f) => {
                                  const next = [...f.percepciones];
                                  next[idx] = { ...next[idx], clave: v };
                                  return { ...f, percepciones: next };
                                });
                              }}
                              className={cn(fieldClass, 'h-9 sm:h-7')}
                            />
                          </div>
                          <div className="space-y-0.5 sm:col-span-5">
                            <Label className="text-[10px] text-slate-500">Concepto</Label>
                            <Input
                              value={row.concepto}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNominaPruebaForm((f) => {
                                  const next = [...f.percepciones];
                                  next[idx] = { ...next[idx], concepto: v };
                                  return { ...f, percepciones: next };
                                });
                              }}
                              className={cn(fieldClass, 'h-9 sm:h-7')}
                            />
                          </div>
                          <div className="space-y-0.5 sm:col-span-2">
                            <Label className="text-[10px] text-slate-500">Gravado</Label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={
                                nominaPercDraft[`p-${idx}-g`] !== undefined
                                  ? nominaPercDraft[`p-${idx}-g`]
                                  : String(Number.isFinite(row.gravado) ? row.gravado : 0)
                              }
                              onFocus={() => {
                                const gKey = `p-${idx}-g`;
                                setNominaPercDraft((d) => ({
                                  ...d,
                                  [gKey]:
                                    row.gravado === 0
                                      ? ''
                                      : String(Number.isFinite(row.gravado) ? row.gravado : 0),
                                }));
                              }}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const gKey = `p-${idx}-g`;
                                setNominaPercDraft((d) => ({ ...d, [gKey]: raw }));
                                const t = raw.trim();
                                if (t === '' || t === '-') {
                                  setNominaPruebaForm((f) => {
                                    const next = [...f.percepciones];
                                    next[idx] = { ...next[idx], gravado: 0 };
                                    return { ...f, percepciones: next };
                                  });
                                  return;
                                }
                                const v = parseNominaMoneyInput(raw);
                                setNominaPruebaForm((f) => {
                                  const next = [...f.percepciones];
                                  next[idx] = { ...next[idx], gravado: v };
                                  return { ...f, percepciones: next };
                                });
                              }}
                              onBlur={(e) => {
                                const raw = e.target.value;
                                const gKey = `p-${idx}-g`;
                                setNominaPercDraft((d) => {
                                  const next = { ...d };
                                  delete next[gKey];
                                  return next;
                                });
                                const v = parseNominaMoneyInput(raw);
                                setNominaPruebaForm((f) => {
                                  const next = [...f.percepciones];
                                  next[idx] = { ...next[idx], gravado: v };
                                  return { ...f, percepciones: next };
                                });
                              }}
                              className={cn(fieldClass, 'h-9 sm:h-7')}
                            />
                          </div>
                          <div className="space-y-0.5 sm:col-span-2">
                            <Label className="text-[10px] text-slate-500">Exento</Label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={
                                nominaPercDraft[`p-${idx}-e`] !== undefined
                                  ? nominaPercDraft[`p-${idx}-e`]
                                  : String(Number.isFinite(row.exento) ? row.exento : 0)
                              }
                              onFocus={() => {
                                const eKey = `p-${idx}-e`;
                                setNominaPercDraft((d) => ({
                                  ...d,
                                  [eKey]:
                                    row.exento === 0
                                      ? ''
                                      : String(Number.isFinite(row.exento) ? row.exento : 0),
                                }));
                              }}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const eKey = `p-${idx}-e`;
                                setNominaPercDraft((d) => ({ ...d, [eKey]: raw }));
                                const t = raw.trim();
                                if (t === '' || t === '-') {
                                  setNominaPruebaForm((f) => {
                                    const next = [...f.percepciones];
                                    next[idx] = { ...next[idx], exento: 0 };
                                    return { ...f, percepciones: next };
                                  });
                                  return;
                                }
                                const v = parseNominaMoneyInput(raw);
                                setNominaPruebaForm((f) => {
                                  const next = [...f.percepciones];
                                  next[idx] = { ...next[idx], exento: v };
                                  return { ...f, percepciones: next };
                                });
                              }}
                              onBlur={(e) => {
                                const raw = e.target.value;
                                const eKey = `p-${idx}-e`;
                                setNominaPercDraft((d) => {
                                  const next = { ...d };
                                  delete next[eKey];
                                  return next;
                                });
                                const v = parseNominaMoneyInput(raw);
                                setNominaPruebaForm((f) => {
                                  const next = [...f.percepciones];
                                  next[idx] = { ...next[idx], exento: v };
                                  return { ...f, percepciones: next };
                                });
                              }}
                              className={cn(fieldClass, 'h-9 sm:h-7')}
                            />
                          </div>
                          <div className="flex justify-end sm:col-span-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 text-red-500 hover:text-red-600"
                              disabled={nominaPruebaForm.percepciones.length <= 1}
                              onClick={() =>
                                setNominaPruebaForm((f) => ({
                                  ...f,
                                  percepciones: f.percepciones.filter((_, i) => i !== idx),
                                }))
                              }
                              aria-label="Quitar percepción"
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-2 space-y-1.5 lg:mt-1.5 lg:space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Deducciones
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setNominaPruebaForm((f) => ({
                            ...f,
                            deducciones: [...f.deducciones, { clave: '', concepto: '', importe: 0 }],
                          }))
                        }
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Fila
                      </Button>
                    </div>
                    <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                      Las claves <span className="font-mono">002</span> (ISR) y <span className="font-mono">021</span>{' '}
                      (IMSS) calculan el importe en automático a partir del total gravado + exento de percepciones
                      (estimación proporcional al mismo criterio del ejemplo 9,000 → 1,240 / 285).
                    </p>
                    <div className="space-y-1.5 lg:space-y-1">
                      {nominaPruebaForm.deducciones.map((row, idx) => {
                        const ckDed = normClaveNomina(row.clave);
                        const importeDeduccionAuto = ckDed === '002' || ckDed === '021';
                        return (
                        <div
                          key={`d-${idx}`}
                          className="grid grid-cols-1 gap-1 rounded-lg border border-slate-200/90 bg-slate-50/80 p-1.5 dark:border-slate-700/80 dark:bg-slate-900/40 sm:grid-cols-12 sm:items-end lg:p-1"
                        >
                          <div className="space-y-0.5 sm:col-span-2">
                            <Label className="text-[10px] text-slate-500">Clave</Label>
                            <Input
                              value={row.clave}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNominaPruebaForm((f) => {
                                  const next = [...f.deducciones];
                                  const { isr, imss } = estimarIsrImssDesdePercepciones(f.percepciones);
                                  const nk = normClaveNomina(v);
                                  let rowNext = { ...next[idx], clave: v };
                                  if (nk === '002') rowNext = { ...rowNext, importe: isr };
                                  else if (nk === '021') rowNext = { ...rowNext, importe: imss };
                                  next[idx] = rowNext;
                                  return { ...f, deducciones: next };
                                });
                              }}
                              className={cn(fieldClass, 'h-9 sm:h-7')}
                            />
                          </div>
                          <div className="space-y-0.5 sm:col-span-7">
                            <Label className="text-[10px] text-slate-500">Concepto</Label>
                            <Input
                              value={row.concepto}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNominaPruebaForm((f) => {
                                  const next = [...f.deducciones];
                                  next[idx] = { ...next[idx], concepto: v };
                                  return { ...f, deducciones: next };
                                });
                              }}
                              className={cn(fieldClass, 'h-9 sm:h-7')}
                            />
                          </div>
                          <div className="space-y-0.5 sm:col-span-2">
                            <Label className="text-[10px] text-slate-500">Importe</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={Number.isFinite(row.importe) ? row.importe : 0}
                              readOnly={importeDeduccionAuto}
                              title={
                                importeDeduccionAuto
                                  ? 'Calculado automáticamente desde percepciones (gravado + exento)'
                                  : undefined
                              }
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setNominaPruebaForm((f) => {
                                  const next = [...f.deducciones];
                                  next[idx] = { ...next[idx], importe: v };
                                  return { ...f, deducciones: next };
                                });
                              }}
                              className={cn(
                                fieldClass,
                                'h-9 sm:h-7',
                                importeDeduccionAuto && 'cursor-not-allowed bg-slate-200/90 dark:bg-slate-800/70'
                              )}
                            />
                          </div>
                          <div className="flex justify-end sm:col-span-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 text-red-500 hover:text-red-600"
                              disabled={nominaPruebaForm.deducciones.length <= 1}
                              onClick={() =>
                                setNominaPruebaForm((f) => ({
                                  ...f,
                                  deducciones: f.deducciones.filter((_, i) => i !== idx),
                                }))
                              }
                              aria-label="Quitar deducción"
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-2 rounded-md border border-slate-300/80 bg-white/80 px-2 py-1.5 text-[11px] dark:border-slate-600 dark:bg-slate-900/50 lg:py-1">
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-slate-700 dark:text-slate-300">
                      <span>Total percepciones: {formatMoney(totalPercepcionesNomina)}</span>
                      <span>Total deducciones: {formatMoney(totalDeduccionesNomina)}</span>
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      Neto a pagar: {formatMoney(netoNominaPreview)}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200/90 dark:border-slate-700/80 bg-slate-200/40 dark:bg-slate-800/40 p-2 lg:p-1.5">
                  <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Impresión de prueba:</span> serie
                    PRUEBA-N y folio local (siguiente:{' '}
                    <span className="font-mono text-cyan-600 dark:text-cyan-400">
                      {config?.folioPruebaNomina ?? 1}
                    </span>
                    ). No consume el folio de nómina SAT de la derecha.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 h-8 bg-gradient-to-r from-cyan-500 to-blue-600 text-white lg:mt-1.5 lg:h-7 lg:text-xs"
                    onClick={() => void handlePrintNominaPrueba()}
                  >
                    <Printer className="mr-2 h-3.5 w-3.5" />
                    Imprimir recibo de nómina (prueba)
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex w-full min-w-0 flex-col gap-2 xl:sticky xl:top-0 xl:max-h-[min(100dvh-9.5rem,920px)] xl:self-start">
              <Card className="w-full gap-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
                <CardHeader className="space-y-0 px-3 py-1.5 sm:px-4 lg:py-1">
                  <CardTitle className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100 sm:text-base lg:text-sm">
                    <Receipt className="h-4 w-4 shrink-0 text-cyan-400 lg:h-4 lg:w-4" />
                    Folios de nómina
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 p-2.5 sm:p-3 lg:gap-1.5 lg:p-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:gap-1.5">
                    <div className="space-y-0.5">
                      <Label htmlFor="serieNomina" className="text-xs text-slate-600 dark:text-slate-400">Serie nómina *</Label>
                      <Input
                        id="serieNomina"
                        value={fiscalForm.serieNomina}
                        onChange={(e) =>
                          setFiscalForm({
                            ...fiscalForm,
                            serieNomina: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="N"
                        className={fieldClass}
                      />
                    </div>
                    <div className="space-y-0.5">
                      <Label htmlFor="folioNominaActual" className="text-xs text-slate-600 dark:text-slate-400">
                        Folio actual nómina *
                      </Label>
                      <Input
                        id="folioNominaActual"
                        type="number"
                        value={fiscalForm.folioNominaActual}
                        onChange={(e) =>
                          setFiscalForm({
                            ...fiscalForm,
                            folioNominaActual: parseInt(e.target.value, 10) || 1,
                          })
                        }
                        className={fieldClass}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 lg:p-1.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <p className="text-[11px] leading-snug text-amber-400/90">
                      No reutilices folios ni saltes números del rango autorizado.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveNominaFolios()}
                    disabled={!fiscalForm.serieNomina?.trim() || !fiscalForm.folioNominaActual}
                    className={cn(
                      'h-8 w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white sm:w-auto sm:self-end lg:h-7 lg:text-xs',
                      (!fiscalForm.serieNomina?.trim() || !fiscalForm.folioNominaActual) &&
                        'cursor-not-allowed opacity-50'
                    )}
                  >
                    <Save className="mr-2 h-3.5 w-3.5" />
                    Guardar folios nómina
                  </Button>
                </CardContent>
              </Card>

              <Card className="w-full border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
                <CardHeader className="space-y-0 px-3 py-1.5 sm:px-4 lg:py-1">
                  <CardTitle className="text-xs font-semibold text-slate-800 dark:text-slate-100 lg:text-[11px]">
                    Requisitos para timbrado
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-2.5 pt-0 sm:p-3 sm:pt-0 lg:space-y-1.5 lg:p-2 lg:pt-0">
                  <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                    Solicita con Soporte los folios para tu tipo de nómina. Serie y folio deben coincidir con el rango
                    autorizado.
                  </p>
                  <ul className="space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300 lg:space-y-1">
                    <li className="flex gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                      Datos fiscales del emisor (pestaña Datos fiscales).
                    </li>
                    <li className="flex gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                      .cer y .key en Certificados.
                    </li>
                    <li className="flex gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                      PAC con timbrado de nómina (Soporte).
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {canManageSucursales && (
          <TabsContent value="sucursales" className={cn(configuracionTabsPanelFillClass, 'w-full')}>
            <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
              <SucursalManagement embedded />
            </div>
          </TabsContent>
        )}

        {canManageUsers && (
          <TabsContent value="usuarios" className={cn(configuracionTabsPanelFillClass, 'w-full')}>
            <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
              <UserManagement embedded />
            </div>
          </TabsContent>
        )}

        {canManageUsers && (
          <TabsContent
            value="permisos"
            className={cn(configuracionTabsPanelFillClass, 'w-full')}
          >
            <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
              <UserPermissionsEditor embedded />
            </div>
          </TabsContent>
        )}

        {canVerHistorialAbasto && (
          <TabsContent value="historial-abasto" className={cn(configuracionTabsPanelClass, 'w-full')}>
            <HistorialAbastoConfig enabled={activeTab === 'historial-abasto'} />
          </TabsContent>
        )}

        {canEditListaPreciosCliente && (
          <TabsContent value="inventario-listas" className={cn(configuracionTabsPanelClass, 'w-full')}>
            <Card className="w-full min-w-0 gap-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
              <CardHeader className="shrink-0 space-y-1 px-3 py-2 sm:px-4">
                <CardTitle className="text-base text-slate-900 dark:text-slate-100 sm:text-base">
                  Categorías y proveedores (inventario)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-3 pt-0 sm:p-4 sm:pt-0 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
                <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row xl:gap-4">
                  <div className="flex min-h-[12rem] flex-col gap-2 xl:min-h-0 xl:flex-1">
                    <Label className="shrink-0 text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                      Categorías
                    </Label>
                    <textarea
                      value={draftCategorias}
                      onChange={(e) => setDraftCategorias(e.target.value)}
                      rows={4}
                      className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-y-contain rounded-md border border-slate-300 bg-slate-200/80 p-3 font-mono text-base leading-normal text-slate-900 [-webkit-overflow-scrolling:touch] dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 sm:p-2 sm:text-sm"
                      spellCheck={false}
                    />
                  </div>
                  <div className="flex min-h-[10rem] flex-col gap-2 xl:min-h-0 xl:flex-1">
                    <Label className="shrink-0 text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
                      Proveedores
                    </Label>
                    <textarea
                      value={draftProveedores}
                      onChange={(e) => setDraftProveedores(e.target.value)}
                      rows={4}
                      className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-y-contain rounded-md border border-slate-300 bg-slate-200/80 p-3 font-mono text-base leading-normal text-slate-900 [-webkit-overflow-scrolling:touch] dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 sm:p-2 sm:text-sm"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 justify-end border-t border-slate-200/90 pt-3 dark:border-slate-800/80 xl:pt-2">
                  <Button
                    type="button"
                    onClick={handleSaveInventarioListas}
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Guardar listas
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
        </Tabs>
      </div>
    </PageShell>
  );
}
