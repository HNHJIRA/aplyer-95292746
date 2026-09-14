create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create or replace function public.kick_waitlist_drain()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  perform net.http_post(
    url := 'https://project--6e7c94e2-66c5-41bc-8e4d-e42fa5d94383.lovable.app/api/public/waitlist-drain',
    headers := jsonb_build_object('content-type','application/json','x-drain-secret','2e05f56ac75931bd682d5d0fd2690ac4a6a829ac8c40aec1'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  return null;
end;
$fn$;

drop trigger if exists trg_kick_waitlist_drain on public.waitlist_jobs;
create trigger trg_kick_waitlist_drain
after insert on public.waitlist_jobs
for each statement
execute function public.kick_waitlist_drain();

select cron.unschedule('waitlist-jobs-retry') where exists (select 1 from cron.job where jobname = 'waitlist-jobs-retry');

select cron.schedule(
  'waitlist-jobs-retry',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://project--6e7c94e2-66c5-41bc-8e4d-e42fa5d94383.lovable.app/api/public/waitlist-drain',
    headers := jsonb_build_object('content-type','application/json','x-drain-secret','2e05f56ac75931bd682d5d0fd2690ac4a6a829ac8c40aec1'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  )
  where exists (select 1 from public.waitlist_jobs where status = 'pending');
  $$
);