-- To-do v12: Pause a Work task while you wait on someone else.
-- Paused tasks leave Overdue and your counts. When resumed, the deadline moves out by the whole days spent paused,
-- and the paused time is left out of "time to finish" in Insights. Safe to run more than once.

alter table public.todos add column if not exists paused boolean not null default false;
alter table public.todos add column if not exists paused_at timestamptz;
alter table public.todos add column if not exists paused_secs integer not null default 0;
alter table public.todos add column if not exists paused_on text;

create or replace function public.todo_pause(p_token text, p_id uuid, p_paused boolean, p_on text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  old public.todos; r public.todos; el bigint;
  v_on text := nullif(left(btrim(coalesce(p_on, '')), 300), '');
begin
  perform public.todo_check(p_token);
  select * into old from public.todos where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_paused then
    if old.list <> 'work' or old.done then raise exception 'cannot pause' using errcode = '23514'; end if;
    if old.paused then
      update public.todos set paused_on = v_on, updated_at = now() where id = p_id returning * into r;
    else
      update public.todos set paused = true, paused_at = now(), paused_on = v_on,
        blocked = false, blocked_at = null, unblock_action = null,
        focus_date = null, must = false, plan_order = null, plan_date = null, updated_at = now()
      where id = p_id returning * into r;
    end if;
  elsif old.paused then
    el := greatest(0, extract(epoch from (now() - coalesce(old.paused_at, now())))::bigint);
    update public.todos set paused = false, paused_at = null, paused_on = null,
      paused_secs = old.paused_secs + el::int,
      due_date = case when old.due_date is null then null else old.due_date + (el / 86400)::int end,
      updated_at = now()
    where id = p_id returning * into r;
  else
    r := old;
  end if;
  return to_jsonb(r);
end $function$;

create or replace function public.todo_history(p_token text, p_days integer default 120)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform public.todo_check(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'c', t.created_at + make_interval(secs => t.paused_secs + x.op),
      'd', t.done_at,
      'due', case when t.due_date is null then null else t.due_date + floor(x.op / 86400)::int end,
      'cat', t.category,
      'l', t.list, 'r', t.recur, 's', t.is_session, 't', t.title,
      'n', case when jsonb_typeof(t.items) = 'array' then jsonb_array_length(t.items) else 0 end,
      'k', case when jsonb_typeof(t.items) = 'array'
                then (select count(*) from jsonb_array_elements(t.items) e where e->>'d' = 'true') else 0 end
    ) order by t.done_at)
    from public.todos t
    cross join lateral (select case when t.paused and t.paused_at is not null
                                    then greatest(0, extract(epoch from (t.done_at - t.paused_at))) else 0 end as op) x
    where t.done and not t.low and t.done_at > now() - make_interval(days => least(greatest(coalesce(p_days, 120), 1), 400))
  ), '[]'::jsonb);
end $function$;

revoke all on function public.todo_pause(text, uuid, boolean, text) from public;
grant execute on function public.todo_pause(text, uuid, boolean, text) to anon, service_role;
