-- Asigna clave Producto/Servicio SAT por defecto (52141500) a artículos sin clave válida.
-- No sobrescribe claves que ya tienen exactamente 8 dígitos.

update public.products
set
  doc = jsonb_set(doc, '{claveProdServ}', '"52141500"'::jsonb, true),
  updated_at = now()
where
  length(regexp_replace(coalesce(doc->>'claveProdServ', ''), '\D', '', 'g')) <> 8;
