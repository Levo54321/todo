-- To-do v23: scanned handwritten notes waiting for review (v1065).
-- One row per scan: the CSV Gemini produced from a photo, until it is reviewed in Settings > Import (then 'done').
-- Touches only the new table todo_scans and three new RPCs: no change to todos, any other table, any shop_* object or any config key.
-- Safe to run more than once.
create table if not exists public.todo_scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'ready' check (status in ('ready', 'done')),
  csv text not null check (length(csv) <= 100000),
  n int not null default 0
);
alter table public.todo_scans enable row level security;

-- Save a new scan. Only the newest scan stays 'ready'; scans older than 30 days are removed.
create or replace function public.todo_scan_save(p_token text, p_csv text, p_n int)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v uuid;
begin
  perform public.todo_check(p_token);
  update public.todo_scans set status = 'done' where status = 'ready';
  delete from public.todo_scans where created_at < now() - interval '30 days';
  insert into public.todo_scans (csv, n) values (p_csv, coalesce(p_n, 0)) returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

-- The newest scan still waiting for review, or null.
create or replace function public.todo_scan_latest(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  perform public.todo_check(p_token);
  select jsonb_build_object('id', id, 'csv', csv, 'n', n, 'created_at', created_at) into r
  from public.todo_scans where status = 'ready' order by created_at desc limit 1;
  return r;
end $$;

-- Mark a scan reviewed (added or dismissed).
create or replace function public.todo_scan_done(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  update public.todo_scans set status = 'done' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.todo_scan_save(text, text, int) from public, anon, authenticated;
revoke all on function public.todo_scan_latest(text) from public, anon, authenticated;
revoke all on function public.todo_scan_done(text, uuid) from public, anon, authenticated;
grant execute on function public.todo_scan_save(text, text, int) to anon;
grant execute on function public.todo_scan_latest(text) to anon;
grant execute on function public.todo_scan_done(text, uuid) to anon;
