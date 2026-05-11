-- Checklist: login con PIN (verify-pos-pin-login)
-- Ejecute en Supabase → SQL Editor. Cambie el filtro si el usuario no es Gabriel.
-- El directorio de login usa el email exacto de profiles para verify-pos-pin (sin alias de dominio).

-- 1) Perfil + enlace a auth.users (mismo id = modelo estándar)
select
  p.id as profile_id,
  p.email as profile_email,
  p.pos_pin,
  p.is_active,
  u.id as auth_user_id,
  case when u.id is null then 'FALTA: sin fila en auth.users con id = profiles.id' else 'OK' end as auth_link
from public.profiles p
left join auth.users u on u.id = p.id
where lower(trim(p.email)) like '%gabriel%'
order by p.email;

-- 2) Secrets en Dashboard → Project Settings → Edge Functions → Secrets
--    ADMIN_CREATE_USER_ALLOWED_ORIGINS = URL exacta del front (sin / final), CSV si hay varias.
--    Si abre la PWA desde un dominio que no está en la lista ni es *.vercel.app ni localhost,
--    la Edge responde 403 con code ORIGIN_NOT_ALLOWED.

-- Códigos HTTP ↔ code en el cuerpo JSON: ver comentario en supabase/functions/verify-pos-pin-login/index.ts
