-- To-do v25: activity log for tagged API calls (voice assistant "Jarvis"). Server-side only; no frontend change.
-- A POST/PATCH/DELETE on /api/todos that carries the header `x-source: <word>` is recorded here: what, when, and the
-- before/after values of the fields that changed, so a mis-heard change can be seen and reversed. Calls without the
-- header are never logged. Rows older than 90 days are pruned whenever a new row is written.
-- New objects only: table todo_activity and four functions. No change to todos, todo_add, todo_update, todo_check,
-- any shop_* object or any config key. No foreign key to todos, so a deleted task keeps its history. Safe to run twice.
--
-- todo_activity_put / todo_activity_get hold the logic and are NOT callable by the API roles; the two public wrappers
-- check the access token first (todo_check) and then call them. That split lets the logic be tested in begin/rollback
-- without touching todo_check.

create table if not exists public.todo_activity (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  source text not null check (source ~ '^[A-Za-z0-9_-]{1,20}$'),
  action text not null check (action in ('add', 'update', 'delete')),
  todo_id uuid,
  title text not null default '' check (length(title) <= 500),
  before jsonb,
  after jsonb
);
create index if not exists todo_activity_at_idx on public.todo_activity (at desc);
create index if not exists todo_activity_todo_idx on public.todo_activity (todo_id, at desc);
alter table public.todo_activity enable row level security;

create or replace function public.todo_activity_put(p_source text, p_action text, p_todo_id uuid, p_title text, p_before jsonb, p_after jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  delete from public.todo_activity where at < now() - interval '90 days';
  insert into public.todo_activity (source, action, todo_id, title, before, after)
  values (
    p_source, p_action, p_todo_id, left(coalesce(p_title, ''), 500),
    case when p_before is not null and length(p_before::text) > 20000 then jsonb_build_object('truncated', true) else p_before end,
    case when p_after is not null and length(p_after::text) > 20000 then jsonb_build_object('truncated', true) else p_after end
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.todo_activity_get(p_source text, p_limit int, p_todo_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb; n int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into r from (
    select a.id, a.at, a.source, a.action, a.todo_id, a.title, a.before, a.after
    from public.todo_activity a
    where (p_source is null or a.source = p_source) and (p_todo_id is null or a.todo_id = p_todo_id)
    order by a.at desc limit n
  ) x;
  return r;
end $$;

create or replace function public.todo_activity_log(p_token text, p_source text, p_action text, p_todo_id uuid, p_title text, p_before jsonb, p_after jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return public.todo_activity_put(p_source, p_action, p_todo_id, p_title, p_before, p_after);
end $$;

create or replace function public.todo_activity_list(p_token text, p_source text default null, p_limit int default 20, p_todo_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return public.todo_activity_get(p_source, p_limit, p_todo_id);
end $$;

revoke all on function public.todo_activity_put(text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.todo_activity_get(text, int, uuid) from public, anon, authenticated;
revoke all on function public.todo_activity_log(text, text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.todo_activity_list(text, text, int, uuid) from public, anon, authenticated;
grant execute on function public.todo_activity_log(text, text, text, uuid, text, jsonb, jsonb) to anon;
grant execute on function public.todo_activity_list(text, text, int, uuid) to anon;
