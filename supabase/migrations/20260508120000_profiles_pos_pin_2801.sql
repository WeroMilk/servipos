-- Login POS: mismo PIN 2801 para todos los usuarios activos (selector + PIN).
-- Corrige despliegues que ya aplicaron 20260507120000 con 1234 o solo zavala/gabriel.

update public.profiles
set pos_pin = '2801',
    updated_at = now()
where is_active = true;

alter table public.profiles alter column pos_pin set default '2801';
