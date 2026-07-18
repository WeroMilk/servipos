-- Vacía globalmente la bandeja de notificaciones cada domingo a las 23:00
-- de America/Hermosillo (UTC-7 todo el año): lunes 06:00 UTC.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job_id bigint;
begin
  -- Permite volver a aplicar la definición sin duplicar el trabajo.
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'purge-all-app-events-weekly'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'purge-all-app-events-weekly',
    '0 6 * * 1',
    $cron$delete from public.app_events;$cron$
  );
end
$$;

-- Solicitud operativa inicial: dejar vacías ahora todas las bandejas.
delete from public.app_events;
