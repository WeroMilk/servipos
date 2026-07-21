-- Anular un abono CxC registrado en caja_sesiones.doc.abonosCobros (sesión abierta o cerrada).

create or replace function private.rpc_anular_abono_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_abono_id text
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
  v_next jsonb := '[]'::jsonb;
  v_item jsonb;
  v_found boolean := false;
  v_aid text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public.can_access_sucursal(v_uid, p_sucursal_id) then raise exception 'forbidden'; end if;

  v_aid := nullif(trim(coalesce(p_abono_id, '')), '');
  if v_aid is null then raise exception 'Indique el abono a anular'; end if;

  select s.doc into v_sess
  from public.caja_sesiones s
  where s.sucursal_id = p_sucursal_id and s.id = p_sesion_id
  for update;

  if not found then raise exception 'Sesión de caja no encontrada'; end if;

  v_arr := coalesce(v_sess->'abonosCobros', '[]'::jsonb);
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  for v_item in select * from jsonb_array_elements(v_arr)
  loop
    if coalesce(v_item->>'id', '') = v_aid then
      v_found := true;
    else
      v_next := v_next || jsonb_build_array(v_item);
    end if;
  end loop;

  if not v_found then raise exception 'Abono no encontrado en la sesión de caja'; end if;

  update public.caja_sesiones
  set doc = v_sess || jsonb_build_object(
      'abonosCobros', v_next,
      'updatedAt', to_jsonb(v_now)
    ),
    updated_at = v_now
  where sucursal_id = p_sucursal_id and id = p_sesion_id;
end;
$$;

create or replace function public.rpc_anular_abono_caja(
  p_sucursal_id text,
  p_sesion_id text,
  p_abono_id text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select private.rpc_anular_abono_caja(p_sucursal_id, p_sesion_id, p_abono_id);
$$;

revoke all on function public.rpc_anular_abono_caja(text, text, text)
  from PUBLIC, anon;
grant execute on function public.rpc_anular_abono_caja(text, text, text)
  to authenticated, service_role;
