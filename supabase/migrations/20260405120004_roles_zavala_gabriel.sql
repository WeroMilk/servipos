-- Roles: zavala → admin, gabriel → cashier.
-- Si los UPDATE devolvían 0 filas, suele faltar la fila en public.profiles (usuario creado en Auth
-- antes del trigger o sin trigger). Primero se crean perfiles desde auth.users.

insert into public.profiles (id, email, username, name, role, is_active)
select
  u.id,
  coalesce(u.email, ''),
  lower(split_part(coalesce(u.email, ''), '@', 1)),
  lower(split_part(coalesce(u.email, ''), '@', 1)),
  'cashier',
  true
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

update public.profiles
set
  role = 'admin',
  updated_at = now()
where
  lower(split_part(coalesce(email, ''), '@', 1)) = 'zavala'
  or lower(trim(coalesce(username, ''))) = 'zavala';

update public.profiles
set
  role = 'cashier',
  updated_at = now()
where
  lower(split_part(coalesce(email, ''), '@', 1)) = 'gabriel'
  or lower(trim(coalesce(username, ''))) = 'gabriel';
