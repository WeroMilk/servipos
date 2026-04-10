-- Ingreso de efectivo a caja durante sesión abierta (cambio adicional, fondeo, etc.).
-- Suma a aportesEfectivo / aportesEfectivoTotal en el doc de caja_sesiones.

create or replace function public.rpc_registrar_aporte_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_monto numeric,
  p_notas text,
  p_usuario_id text,
  p_usuario_nombre text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_sess jsonb;
  v_arr jsonb;
  v_total numeric;
  v_item jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  if coalesce(p_monto, 0) <= 0 then raise exception 'Indique un monto mayor a cero'; end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if coalesce(v_sess->>'estado', '') <> 'abierta' then raise exception 'La caja no está abierta'; end if;

  v_item := jsonb_build_object(
    'id', replace(gen_random_uuid()::text, '-', ''),
    'monto', round(p_monto::numeric, 2),
    'notas', nullif(trim(coalesce(p_notas, '')), ''),
    'createdAt', to_jsonb(v_now),
    'usuarioId', p_usuario_id,
    'usuarioNombre', coalesce(nullif(trim(p_usuario_nombre), ''), 'Usuario')
  );

  v_arr := coalesce(v_sess->'aportesEfectivo', '[]'::jsonb) || jsonb_build_array(v_item);
  v_total := coalesce((v_sess->>'aportesEfectivoTotal')::numeric, 0) + round(p_monto::numeric, 2);

  update public.caja_sesiones
  set doc = v_sess || jsonb_build_object(
      'aportesEfectivo', v_arr,
      'aportesEfectivoTotal', v_total,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sesion_id;
end;
$$;

grant execute on function public.rpc_registrar_aporte_caja(text, text, numeric, text, text, text) to authenticated;
