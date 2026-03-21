import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFiscalConfig } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import { UserManagement } from '@/components/ui-custom/UserManagement';
import { SucursalManagement } from '@/components/ui-custom/SucursalManagement';
import { PageShell } from '@/components/ui-custom/PageShell';
import { REGIMENES_FISCALES, USOS_CFDI } from '@/types';
import { cn } from '@/lib/utils';

export function Configuracion() {
  const { config, isConfigured, saveConfig, updateConfig } = useFiscalConfig();
  const { addToast } = useAppStore();
  const { hasPermission } = useAuthStore();
  const canManageUsers = hasPermission('usuarios:gestionar');
  const canManageSucursales = hasPermission('sucursales:gestionar');
  const adminExtraTabs = (canManageUsers ? 1 : 0) + (canManageSucursales ? 1 : 0);
  const totalTabs = 4 + adminExtraTabs;
  
  const [activeTab, setActiveTab] = useState('fiscal');
  
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
    'h-8 border-slate-700 bg-slate-800/50 text-sm text-slate-100';
  const selectClass =
    'h-8 w-full rounded-md border border-slate-700 bg-slate-800/50 px-2 text-sm text-slate-100';

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
            <p className="min-w-0 text-[11px] leading-snug text-amber-400/90 sm:text-xs">
              <span className="font-medium text-amber-400">Incompleta.</span>{' '}
              Complete datos fiscales para facturar.
            </p>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 sm:px-3">
            <Check className="h-4 w-4 shrink-0 text-emerald-400 sm:h-5 sm:w-5" />
            <p className="min-w-0 text-[11px] leading-snug text-emerald-400/90 sm:text-xs">
              <span className="font-medium text-emerald-400">Listo</span> para generar facturas.
            </p>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 overflow-hidden sm:gap-2"
        >
        <TabsList
          className={cn(
            'grid h-auto w-full shrink-0 gap-1 bg-slate-900/50 p-1',
            totalTabs <= 4 && 'grid-cols-2 sm:grid-cols-4',
            totalTabs === 5 && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
            totalTabs >= 6 && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
          )}
        >
          <TabsTrigger
            value="fiscal"
            className="h-9 w-full text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 sm:text-sm"
          >
            <Receipt className="mr-1.5 h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Datos fiscales
          </TabsTrigger>
          <TabsTrigger
            value="empresa"
            className="h-9 w-full text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 sm:text-sm"
          >
            <Building2 className="mr-1.5 h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Empresa
          </TabsTrigger>
          <TabsTrigger
            value="certificados"
            className="h-9 w-full text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 sm:text-sm"
          >
            <FileKey className="mr-1.5 h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Certificados
          </TabsTrigger>
          <TabsTrigger
            value="nominas"
            className="h-9 w-full text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 sm:text-sm"
          >
            <Wallet className="mr-1.5 h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            Nóminas
          </TabsTrigger>
          {canManageSucursales && (
            <TabsTrigger
              value="sucursales"
              className="h-9 w-full text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 sm:text-sm"
            >
              <MapPin className="mr-1.5 h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Sucursales
            </TabsTrigger>
          )}
          {canManageUsers && (
            <TabsTrigger
              value="usuarios"
              className="h-9 w-full text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 sm:text-sm"
            >
              <Users className="mr-1.5 h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
              Usuarios
            </TabsTrigger>
          )}
        </TabsList>

        {/* Fiscal: rejilla densa; scroll solo si el viewport es bajo */}
        <TabsContent
          value="fiscal"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
        >
          <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                <Receipt className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5" />
                Datos fiscales CFDI 4.0
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 pt-0 sm:p-4 sm:pt-0">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-0.5">
                <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <div className="space-y-1">
                    <Label htmlFor="rfc" className="text-xs text-slate-400">
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
                    <Label htmlFor="razonSocial" className="text-xs text-slate-400">
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
                    <Label htmlFor="nombreComercial" className="text-xs text-slate-400">
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
                    <Label htmlFor="regimenFiscal" className="text-xs text-slate-400">
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
                    <Label htmlFor="serie" className="text-xs text-slate-400">
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
                    <Label htmlFor="folioActual" className="text-xs text-slate-400">
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
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lugarExpedicion" className="text-xs text-slate-400">
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
                    <Label htmlFor="codigoUsoCfdi" className="text-xs text-slate-400">
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

                  <div className="col-span-full mt-1 border-t border-slate-800/80 pt-2">
                    <p className="text-xs font-medium text-slate-500">Dirección fiscal</p>
                  </div>

                  <div className="space-y-1 sm:col-span-2 xl:col-span-2">
                    <Label className="text-xs text-slate-400">Calle</Label>
                    <Input
                      value={fiscalForm.calle}
                      onChange={(e) => setFiscalForm({ ...fiscalForm, calle: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2 xl:col-span-2">
                    <Label className="text-xs text-slate-400">Colonia</Label>
                    <Input
                      value={fiscalForm.colonia}
                      onChange={(e) => setFiscalForm({ ...fiscalForm, colonia: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">No. ext.</Label>
                      <Input
                        value={fiscalForm.numeroExterior}
                        onChange={(e) =>
                          setFiscalForm({ ...fiscalForm, numeroExterior: e.target.value })
                        }
                        className={fieldClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">No. int.</Label>
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
                    <Label className="text-xs text-slate-400">C.P.</Label>
                    <Input
                      value={fiscalForm.codigoPostal}
                      onChange={(e) =>
                        setFiscalForm({ ...fiscalForm, codigoPostal: e.target.value })
                      }
                      className={fieldClass}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2 lg:col-span-2 xl:col-span-1">
                    <Label className="text-xs text-slate-400">Ciudad</Label>
                    <Input
                      value={fiscalForm.ciudad}
                      onChange={(e) => setFiscalForm({ ...fiscalForm, ciudad: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2 lg:col-span-2 xl:col-span-1">
                    <Label className="text-xs text-slate-400">Municipio</Label>
                    <Input
                      value={fiscalForm.municipio}
                      onChange={(e) =>
                        setFiscalForm({ ...fiscalForm, municipio: e.target.value })
                      }
                      className={fieldClass}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs text-slate-400">Estado</Label>
                    <Input
                      value={fiscalForm.estado}
                      onChange={(e) => setFiscalForm({ ...fiscalForm, estado: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 justify-end border-t border-slate-800/60 pt-2">
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

        <TabsContent
          value="empresa"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
        >
          <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                <Building2 className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                Información de la empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col justify-between gap-3 p-3 sm:flex-row sm:items-end sm:p-4">
              <div className="grid w-full min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Teléfono</Label>
                  <Input
                    value={fiscalForm.telefono}
                    onChange={(e) => setFiscalForm({ ...fiscalForm, telefono: e.target.value })}
                    placeholder="(55) 1234-5678"
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                  <Label className="text-xs text-slate-400">Email de contacto</Label>
                  <Input
                    type="email"
                    value={fiscalForm.email}
                    onChange={(e) => setFiscalForm({ ...fiscalForm, email: e.target.value })}
                    placeholder="contacto@empresa.com"
                    className={fieldClass}
                  />
                </div>
              </div>
              <div className="flex shrink-0 justify-end sm:pl-4">
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

        <TabsContent
          value="certificados"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
        >
          <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-2 lg:gap-3">
            <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
              <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                  <FileKey className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                  CSD (sello digital)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-[11px] leading-snug text-amber-400/85 sm:text-xs">
                    CSD del SAT para timbrar en producción. En esta demo el XML se genera sin
                    timbrar.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Certificado (.cer)</Label>
                    <Input
                      type="file"
                      accept=".cer"
                      disabled
                      className={cn(fieldClass, 'py-1')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Llave (.key)</Label>
                    <Input
                      type="file"
                      accept=".key"
                      disabled
                      className={cn(fieldClass, 'py-1')}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs text-slate-400">Contraseña de la llave</Label>
                    <Input
                      type="password"
                      disabled
                      placeholder="••••••••"
                      className={fieldClass}
                    />
                  </div>
                </div>
                <div className="mt-auto flex justify-end pt-1">
                  <Button
                    type="button"
                    size="sm"
                    disabled
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white opacity-50"
                  >
                    <Lock className="mr-2 h-4 w-4" />
                    Configurar CSD
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
              <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                  <Key className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                  PAC (timbrado)
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
                <div className="rounded-lg bg-slate-800/30 p-2 sm:p-3">
                  <p className="text-xs text-slate-400 sm:text-sm">
                    Para timbrar ante el SAT contrate un PAC autorizado:
                  </p>
                  <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300 sm:text-sm">
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      Facturama
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      Finkok
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      SW Sapien
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      Edicom
                    </li>
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-500 sm:text-xs">
                    El XML CFDI 4.0 generado aquí puede enviarse a cualquiera de ellos.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent
          value="nominas"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
        >
          <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-y-contain lg:grid-cols-2 lg:gap-3">
            <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
              <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                  <Wallet className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5" />
                  Nómina electrónica (CFDI)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
                <div className="flex gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <p className="text-[11px] leading-snug text-emerald-400/90 sm:text-xs">
                    Con <span className="font-medium text-emerald-300">serie y folio autorizados por el SAT</span>, el
                    mismo <span className="font-medium text-emerald-300">CSD</span> y un{' '}
                    <span className="font-medium text-emerald-300">PAC</span> autorizado para timbrado de nómina, el
                    CFDI cumple el esquema oficial y es válido ante el SAT.
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-slate-400 sm:text-sm">
                  Solicita en el portal del SAT los folios para el tipo de comprobante de nómina que uses. Aquí defines
                  la serie y el folio consecutivo que se aplicarán al generar cada recibo; deben coincidir con el
                  rango autorizado.
                </p>
                <ul className="space-y-1.5 text-xs text-slate-300 sm:text-sm">
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    Datos fiscales del emisor completos (misma pestaña &quot;Datos fiscales&quot;).
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    Certificado (.cer) y llave (.key) configurados en &quot;Certificados&quot;.
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    PAC con servicio de timbrado de nómina (mismo criterio que facturas).
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
              <CardHeader className="shrink-0 space-y-0 px-3 py-2 sm:px-4">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                  <Receipt className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5" />
                  Folios de nómina
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="serieNomina" className="text-xs text-slate-400">
                      Serie nómina *
                    </Label>
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
                  <div className="space-y-1">
                    <Label htmlFor="folioNominaActual" className="text-xs text-slate-400">
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
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-[11px] leading-snug text-amber-400/85 sm:text-xs">
                    No reutilices folios ni saltes números dentro del rango autorizado; el SAT puede rechazar
                    comprobantes duplicados o fuera de secuencia.
                  </p>
                </div>
                <div className="mt-auto flex justify-end pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveNominaFolios()}
                    disabled={!fiscalForm.serieNomina?.trim() || !fiscalForm.folioNominaActual}
                    className={cn(
                      'bg-gradient-to-r from-cyan-500 to-blue-600 text-white',
                      (!fiscalForm.serieNomina?.trim() || !fiscalForm.folioNominaActual) &&
                        'cursor-not-allowed opacity-50'
                    )}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Guardar folios nómina
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {canManageSucursales && (
          <TabsContent
            value="sucursales"
            className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
          >
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
              <SucursalManagement embedded />
            </div>
          </TabsContent>
        )}

        {canManageUsers && (
          <TabsContent
            value="usuarios"
            className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
          >
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
              <UserManagement embedded />
            </div>
          </TabsContent>
        )}
        </Tabs>
      </div>
    </PageShell>
  );
}
