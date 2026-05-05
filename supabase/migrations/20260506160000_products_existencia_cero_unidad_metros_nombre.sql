-- Existencias a cero en todo el catálogo y unidad SAT MTR donde el nombre indica venta por metro
-- («METRO DE CABLE…», «METRO CABLE…», «… TERMO METRO», etc.). Excluye multímetros/manómetros/etc.

update public.products
set doc = jsonb_set(doc, '{existencia}', '0'::jsonb, true),
    updated_at = now();

update public.products
set doc = jsonb_set(doc, '{unidadMedida}', '"MTR"'::jsonb, true),
    updated_at = now()
where upper(trim(coalesce(doc->>'categoria', ''))) <> 'SERVICIOS'
  and coalesce((doc->>'esServicio')::boolean, false) = false
  and trim(coalesce(doc->>'nombre', '')) <> ''
  and not (
    upper(trim(coalesce(doc->>'nombre', ''))) ~ '(FLEXOMETRO|MULTIMETRO|MANOMETRO|TERMOMETRO|VACUOMETRO|HIGROMETRO)'
  )
  and (
    upper(trim(coalesce(doc->>'nombre', ''))) ~ '^METRO[[:space:]]'
    or upper(trim(coalesce(doc->>'nombre', ''))) ~ '[[:space:]]METRO$'
  );
