-- Hardening de visibilidad/inserción de eventos de app

drop policy if exists app_ev_select on public.app_events;
drop policy if exists app_ev_insert on public.app_events;

create policy app_ev_select on public.app_events for select
  to authenticated using (
    public.is_admin()
    or coalesce(doc->>'sucursalId', '') = public.user_sucursal_id()
    or coalesce(doc->>'actorUserId', '') = auth.uid()::text
  );

create policy app_ev_insert on public.app_events for insert
  to authenticated with check (
    coalesce(doc->>'actorUserId', '') = auth.uid()::text
    and (
      coalesce(doc->>'sucursalId', '') = ''
      or public.can_access_sucursal(auth.uid(), coalesce(doc->>'sucursalId', ''))
    )
  );
