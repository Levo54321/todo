-- setup13: record the config-key whitelist as it is live in Supabase.
-- 'gcal' (Google Calendar login/choices) and 'projects' (project priority/status/order) were added
-- directly in Supabase after setup07; this file brings the repo back in line. Safe to re-run.
-- When you add a new config key, add it to BOTH lists below (and apply the file).
create or replace function public.cfg_get(p_token text, p_key text)
returns text language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  if p_key not in ('budget', 'caldav', 'caldav_state', 'saver', 'shop', 'gcal', 'projects') then raise exception 'bad key' using errcode = '23514'; end if;
  return (select value from public.app_config where key = p_key);
end $$;

create or replace function public.cfg_set(p_token text, p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  if p_key not in ('budget', 'caldav', 'caldav_state', 'saver', 'shop', 'gcal', 'projects') then raise exception 'bad key' using errcode = '23514'; end if;
  if p_value is null then
    delete from public.app_config where key = p_key;
  else
    if length(p_value) > 60000 then raise exception 'too large' using errcode = '23514'; end if;
    insert into public.app_config (key, value) values (p_key, p_value)
      on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cfg_get(text, text) from public, anon, authenticated;
revoke all on function public.cfg_set(text, text, text) from public, anon, authenticated;
grant execute on function public.cfg_get(text, text) to anon, service_role;
grant execute on function public.cfg_set(text, text, text) to anon, service_role;
