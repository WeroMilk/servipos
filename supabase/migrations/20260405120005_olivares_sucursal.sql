-- Sucursal Olivares + asignación de tienda y roles (zavala admin, gabriel cajero).
-- Id estable `olivares` (coincide con createSucursalMeta / import scripts).

insert into public.sucursales (id, nombre, codigo, activo, created_at, updated_at)
values ('olivares', 'Olivares', null, true, now(), now())
on conflict (id) do update set
  nombre = excluded.nombre,
  activo = true,
  updated_at = now();

update public.profiles
set
  role = 'admin',
  sucursal_id = 'olivares',
  updated_at = now()
where lower(split_part(coalesce(email, ''), '@', 1)) = 'zavala'
   or lower(trim(coalesce(username, ''))) = 'zavala';

update public.profiles
set
  role = 'cashier',
  sucursal_id = 'olivares',
  updated_at = now()
where lower(split_part(coalesce(email, ''), '@', 1)) = 'gabriel'
   or lower(trim(coalesce(username, ''))) = 'gabriel';
