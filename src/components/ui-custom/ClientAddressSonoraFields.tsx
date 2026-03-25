import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ENTIDADES_FEDERATIVAS_MX } from '@/data/mexicoEstados';
import {
  ESTADO_SONORA,
  MUNICIPIOS_SONORA,
  lookupCp,
  normalizeCp,
} from '@/data/sonoraAddress';

export type AddressFormSlice = {
  codigoPostal: string;
  colonia: string;
  ciudad: string;
  estado: string;
  calle: string;
  numeroExterior: string;
  numeroInterior: string;
};

type Props<T extends AddressFormSlice> = {
  formData: T;
  setFormData: React.Dispatch<React.SetStateAction<T>>;
  municipio: string;
  setMunicipio: (v: string) => void;
  /** Formulario compacto (p. ej. modal en escritorio). */
  dense?: boolean;
  className?: string;
};

export function ClientAddressSonoraFields<T extends AddressFormSlice>({
  formData,
  setFormData,
  municipio,
  setMunicipio,
  dense = false,
  className,
}: Props<T>) {
  const [cpHint, setCpHint] = useState<string | null>(null);

  const isSonora = formData.estado === ESTADO_SONORA;

  const cpInfo = useMemo(
    () => (isSonora && formData.codigoPostal ? lookupCp(formData.codigoPostal) : null),
    [formData.codigoPostal, isSonora]
  );

  const colonias = cpInfo?.colonias ?? [];
  const calles = cpInfo?.calles ?? [];

  const applyCpLookup = () => {
    if (!isSonora) return;
    const info = lookupCp(formData.codigoPostal);
    if (!info) {
      setCpHint('CP no está en el catálogo local: puede capturar colonia y calle manualmente.');
      return;
    }
    setCpHint(null);
    setMunicipio(info.municipio);
    setFormData((f) => ({
      ...f,
      estado: ESTADO_SONORA,
      ciudad: info.ciudad,
      colonia: info.colonias[0] ?? f.colonia,
    }));
  };

  const fieldGap = dense ? 'space-y-1' : 'space-y-2';
  const controlClass = dense
    ? 'h-10 w-full rounded-md border border-slate-300 bg-slate-200 px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9'
    : 'h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 text-slate-900 dark:text-slate-100';
  const inputClass = dense
    ? 'border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9'
    : 'border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100';

  return (
    <div
      className={cn(
        'col-span-full border-t border-slate-200 dark:border-slate-800 sm:col-span-2 lg:col-span-3',
        dense ? 'pt-2 lg:col-span-4' : 'pt-4',
        className
      )}
    >
      <p
        className={cn(
          'text-sm text-slate-600 dark:text-slate-500',
          dense ? 'mb-2 text-xs lg:mb-1.5 lg:text-[11px]' : 'mb-3'
        )}
      >
        Dirección (México)
      </p>

      <div
        className={cn(
          'grid grid-cols-1 sm:grid-cols-2',
          dense
            ? 'gap-2 gap-y-2 lg:grid-cols-4 lg:gap-x-3 lg:gap-y-1.5'
            : 'gap-3 gap-y-4 lg:grid-cols-3 lg:gap-x-4'
        )}
      >
        <div className={cn(fieldGap, 'sm:col-span-2', dense ? 'lg:col-span-4' : 'lg:col-span-3')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Estado</Label>
          <select
            value={formData.estado || ESTADO_SONORA}
            onChange={(e) => {
              const est = e.target.value;
              setFormData((f) => ({ ...f, estado: est }));
              if (est !== ESTADO_SONORA) {
                setMunicipio('');
                setCpHint(null);
              }
            }}
            className={controlClass}
          >
            {ENTIDADES_FEDERATIVAS_MX.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        {isSonora ? (
        <div className={cn(fieldGap, 'sm:col-span-2', dense && 'lg:col-span-2')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Municipio (Sonora)</Label>
          <select
            value={municipio}
            onChange={(e) => {
              const m = e.target.value;
              setMunicipio(m);
              setFormData((f) => ({ ...f, estado: ESTADO_SONORA, ciudad: m === 'Cajeme' ? 'Ciudad Obregón' : m }));
            }}
            className={controlClass}
          >
            <option value="">Seleccione municipio…</option>
            {MUNICIPIOS_SONORA.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        ) : (
        <div className={cn(fieldGap, 'sm:col-span-2', dense ? 'lg:col-span-2' : 'lg:col-span-3')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Municipio o alcaldía</Label>
          <Input
            value={municipio}
            onChange={(e) => {
              const m = e.target.value;
              setMunicipio(m);
              setFormData((f) => ({ ...f, ciudad: f.ciudad || m }));
            }}
            placeholder="Ej. Guadalajara, Monterrey…"
            className={cn('h-10', inputClass)}
          />
        </div>
        )}

        <div className={cn(fieldGap, dense && 'lg:col-span-1')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Código postal</Label>
          <Input
            inputMode="numeric"
            autoComplete="postal-code"
            value={formData.codigoPostal}
            onChange={(e) =>
              setFormData((f) => ({ ...f, codigoPostal: normalizeCp(e.target.value) }))
            }
            onBlur={() => applyCpLookup()}
            placeholder="5 dígitos"
            maxLength={5}
            className={cn('h-10', inputClass)}
          />
        </div>

        <div className={cn(fieldGap, dense && 'lg:col-span-1')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Ciudad</Label>
          <Input
            value={formData.ciudad}
            onChange={(e) => setFormData((f) => ({ ...f, ciudad: e.target.value }))}
            className={cn('h-10', inputClass)}
            placeholder="Se llena con CP o municipio"
          />
        </div>

        {colonias.length > 0 ? (
          <div className={cn(fieldGap, 'sm:col-span-2', dense ? 'lg:col-span-4' : 'lg:col-span-3')}>
            <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Colonia</Label>
            <select
              value={formData.colonia}
              onChange={(e) => setFormData((f) => ({ ...f, colonia: e.target.value }))}
              className={controlClass}
            >
              <option value="">Seleccione…</option>
              {colonias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className={cn(fieldGap, 'sm:col-span-2', dense ? 'lg:col-span-4' : 'lg:col-span-3')}>
            <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Colonia</Label>
            <Input
              value={formData.colonia}
              onChange={(e) => setFormData((f) => ({ ...f, colonia: e.target.value }))}
              className={cn('h-10', inputClass)}
            />
          </div>
        )}

        {calles.length > 0 ? (
          <div className={cn(fieldGap, 'sm:col-span-2', dense ? 'lg:col-span-4' : 'lg:col-span-3')}>
            <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Calle (catálogo por CP)</Label>
            <select
              value={calles.includes(formData.calle) ? formData.calle : ''}
              onChange={(e) => setFormData((f) => ({ ...f, calle: e.target.value }))}
              className={controlClass}
            >
              <option value="">Seleccione o escriba abajo…</option>
              {calles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Input
              value={formData.calle}
              onChange={(e) => setFormData((f) => ({ ...f, calle: e.target.value }))}
              placeholder="O escriba la calle manualmente"
              className={cn('h-9 text-sm', inputClass)}
            />
          </div>
        ) : (
          <div className={cn(fieldGap, 'sm:col-span-2', dense ? 'lg:col-span-4' : 'lg:col-span-3')}>
            <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Calle</Label>
            <Input
              value={formData.calle}
              onChange={(e) => setFormData((f) => ({ ...f, calle: e.target.value }))}
              className={cn('h-10', inputClass)}
            />
          </div>
        )}

        <div className={cn(fieldGap, dense && 'lg:col-span-2')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Número exterior</Label>
          <Input
            inputMode="numeric"
            value={formData.numeroExterior}
            onChange={(e) => setFormData((f) => ({ ...f, numeroExterior: e.target.value }))}
            className={cn('h-10', inputClass)}
          />
        </div>

        <div className={cn(fieldGap, dense && 'lg:col-span-2')}>
          <Label className={dense ? 'text-sm lg:text-xs' : undefined}>Número interior</Label>
          <Input
            inputMode="numeric"
            value={formData.numeroInterior}
            onChange={(e) => setFormData((f) => ({ ...f, numeroInterior: e.target.value }))}
            className={cn('h-10', inputClass)}
          />
        </div>
      </div>

      {cpHint ? <p className="mt-2 text-xs text-amber-400/90">{cpHint}</p> : null}
    </div>
  );
}
