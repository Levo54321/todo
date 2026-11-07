-- To-do v24: scans can also carry "done" lines (crossed out / ticked / highlighted on the page) (v1069).
-- Touches only todo_scans (one new column) and its two RPCs todo_scan_save / todo_scan_latest. No shop_* object, no config key, no todos change.
-- todo_scan_save gains an optional 4th argument; the old 3-argument version is dropped so a call with 3 arguments still works (default).
-- Safe to run more than once.
alter table public.todo_scans add column if not exists done jsonb not null default '{}'::jsonb;

drop function if exists public.todo_scan_save(text, text, int);
create or replace function public.todo_scan_save(p_token text, p_csv text, p_n int, p_done jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v uuid;
begin
  perform public.todo_check(p_token);
  update public.todo_scans set status = 'done' where status = 'ready';
  delete from public.todo_scans where created_at < now() - interval '30 days';
  insert into public.todo_scans (csv, n, done) values (p_csv, coalesce(p_n, 0), coalesce(p_done, '{}'::jsonb)) returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

create or replace function public.todo_scan_latest(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  perform public.todo_check(p_token);
  select jsonb_build_object('id', id, 'csv', csv, 'n', n, 'created_at', created_at, 'done', done) into r
  from public.todo_scans where status = 'ready' order by created_at desc limit 1;
  return r;
end $$;

revoke all on function public.todo_scan_save(text, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.todo_scan_latest(text) from public, anon, authenticated;
grant execute on function public.todo_scan_save(text, text, int, jsonb) to anon;
grant execute on function public.todo_scan_latest(text) to anon;
