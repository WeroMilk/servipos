import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
};

export function ClientAddressSonoraFields<T extends AddressFormSlice>({
  formData,
  setFormData,
  municipio,
  setMunicipio,
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

  return (
    <div className="col-span-full border-t border-slate-800 pt-4 sm:col-span-2">
      <p className="mb-3 text-sm text-slate-500">Dirección (México)</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Estado</Label>
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
            className="h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 text-slate-100"
          >
            {ENTIDADES_FEDERATIVAS_MX.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        {isSonora ? (
        <div className="space-y-2 sm:col-span-2">
          <Label>Municipio (Sonora)</Label>
          <select
            value={municipio}
            onChange={(e) => {
              const m = e.target.value;
              setMunicipio(m);
              setFormData((f) => ({ ...f, estado: ESTADO_SONORA, ciudad: m === 'Cajeme' ? 'Ciudad Obregón' : m }));
            }}
            className="h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 text-slate-100"
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
        <div className="space-y-2 sm:col-span-2">
          <Label>Municipio o alcaldía</Label>
          <Input
            value={municipio}
            onChange={(e) => {
              const m = e.target.value;
              setMunicipio(m);
              setFormData((f) => ({ ...f, ciudad: f.ciudad || m }));
            }}
            placeholder="Ej. Guadalajara, Monterrey…"
            className="border-slate-700 bg-slate-800 text-slate-100"
          />
        </div>
        )}

        <div className="space-y-2">
          <Label>Código postal</Label>
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
            className="border-slate-700 bg-slate-800 text-slate-100"
          />
        </div>

        <div className="space-y-2">
          <Label>Ciudad</Label>
          <Input
            value={formData.ciudad}
            onChange={(e) => setFormData((f) => ({ ...f, ciudad: e.target.value }))}
            className="border-slate-700 bg-slate-800 text-slate-100"
            placeholder="Se llena con CP o municipio"
          />
        </div>

        {colonias.length > 0 ? (
          <div className="space-y-2 sm:col-span-2">
            <Label>Colonia</Label>
            <select
              value={formData.colonia}
              onChange={(e) => setFormData((f) => ({ ...f, colonia: e.target.value }))}
              className="h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 text-slate-100"
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
          <div className="space-y-2 sm:col-span-2">
            <Label>Colonia</Label>
            <Input
              value={formData.colonia}
              onChange={(e) => setFormData((f) => ({ ...f, colonia: e.target.value }))}
              className="border-slate-700 bg-slate-800 text-slate-100"
            />
          </div>
        )}

        {calles.length > 0 ? (
          <div className="space-y-2 sm:col-span-2">
            <Label>Calle (catálogo por CP)</Label>
            <select
              value={calles.includes(formData.calle) ? formData.calle : ''}
              onChange={(e) => setFormData((f) => ({ ...f, calle: e.target.value }))}
              className="h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 text-slate-100"
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
              className="border-slate-700 bg-slate-800 text-sm text-slate-100"
            />
          </div>
        ) : (
          <div className="space-y-2 sm:col-span-2">
            <Label>Calle</Label>
            <Input
              value={formData.calle}
              onChange={(e) => setFormData((f) => ({ ...f, calle: e.target.value }))}
              className="border-slate-700 bg-slate-800 text-slate-100"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Número exterior</Label>
          <Input
            inputMode="numeric"
            value={formData.numeroExterior}
            onChange={(e) => setFormData((f) => ({ ...f, numeroExterior: e.target.value }))}
            className="border-slate-700 bg-slate-800 text-slate-100"
          />
        </div>

        <div className="space-y-2">
          <Label>Número interior</Label>
          <Input
            inputMode="numeric"
            value={formData.numeroInterior}
            onChange={(e) => setFormData((f) => ({ ...f, numeroInterior: e.target.value }))}
            className="border-slate-700 bg-slate-800 text-slate-100"
          />
        </div>
      </div>

      {cpHint ? <p className="mt-2 text-xs text-amber-400/90">{cpHint}</p> : null}
    </div>
  );
}
