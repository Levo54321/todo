-- To-do v10: Work list ordering. Adds a priority (0 none, 1 = !, 2 = !!, 3 = !!!), a Quick yes/no and a "Must do today" yes/no to every task.
-- "Must do today" switches itself off when a task is moved to a later day. Includes v9. Paste the WHOLE file into Supabase > SQL Editor and click Run. Safe to run more than once.

alter table public.todos add column if not exists prio smallint not null default 0;
alter table public.todos add column if not exists quick boolean not null default false;
alter table public.todos add column if not exists must boolean not null default false;

drop function if exists public.todo_add(text, text, date, text, text, boolean, text, text);
create or replace function public.todo_add(p_token text, p_title text, p_due date default null, p_category text default null, p_recur text default null,
    p_session boolean default false, p_remind text default null, p_list text default 'personal',
    p_prio integer default 0, p_quick boolean default false, p_must boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r public.todos;
begin
  perform public.todo_check(p_token);
  insert into public.todos (title, due_date, category, recur, is_session, remind_time, list, prio, quick, must)
  values (left(btrim(coalesce(p_title, '')), 500), p_due, nullif(btrim(coalesce(p_category, '')), ''),
          nullif(btrim(coalesce(p_recur, '')), ''), coalesce(p_session, false), nullif(btrim(coalesce(p_remind, '')), '')::time,
          case when p_list = 'work' then 'work' else 'personal' end,
          least(greatest(coalesce(p_prio, 0), 0), 3), coalesce(p_quick, false), coalesce(p_must, false))
  returning * into r;
  return to_jsonb(r);
end $function$;
revoke all on function public.todo_add(text, text, date, text, text, boolean, text, text, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.todo_add(text, text, date, text, text, boolean, text, text, integer, boolean, boolean) to anon;

create or replace function public.todo_update(p_token text, p_id uuid, p_patch jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r public.todos; old public.todos; nxt public.todos; n int; nd date;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform public.todo_check(p_token);
  select * into old from public.todos where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;

  if p_patch ? 'items' and (jsonb_typeof(p_patch->'items') <> 'array' or jsonb_array_length(p_patch->'items') > 100) then
    raise exception 'bad items' using errcode = '23514';
  end if;

  if p_patch ? 'focus' and coalesce((p_patch->>'focus')::boolean, false) and old.focus_date is distinct from v_today then
    select count(*) into n from public.todos where focus_date = v_today and done = false and id <> p_id and list = old.list;
    if n >= 3 then raise exception 'focus full' using errcode = '23514'; end if;
  end if;

  update public.todos set
    title = case when p_patch ? 'title' then left(btrim(coalesce(p_patch->>'title', '')), 500) else title end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch->>'category', '')), '') else category end,
    recur = case when p_patch ? 'recur' then nullif(btrim(coalesce(p_patch->>'recur', '')), '') else recur end,
    recur_until = case
      when p_patch ? 'recur' and nullif(btrim(coalesce(p_patch->>'recur', '')), '') is null then null
      when p_patch ? 'recur_until' then nullif(btrim(coalesce(p_patch->>'recur_until', '')), '')::date
      else recur_until end,
    remind_time = case when p_patch ? 'remind_time' then nullif(btrim(coalesce(p_patch->>'remind_time', '')), '')::time else remind_time end,
    list = case when p_patch ? 'list' and (p_patch->>'list') in ('personal', 'work') then p_patch->>'list' else list end,
    is_session = case when p_patch ? 'is_session' then coalesce((p_patch->>'is_session')::boolean, false) else is_session end,
    items = case when p_patch ? 'items' then p_patch->'items' else items end,
    notes = case when p_patch ? 'notes' then nullif(left(btrim(coalesce(p_patch->>'notes', '')), 2000), '') else notes end,
    focus_date = case when p_patch ? 'focus' then (case when coalesce((p_patch->>'focus')::boolean, false) then v_today else null end) else focus_date end,
    low = case
      when p_patch ? 'low' then coalesce((p_patch->>'low')::boolean, false)
      when p_patch ? 'due_date' and nullif(p_patch->>'due_date', '') is not null then false
      when p_patch ? 'focus' and coalesce((p_patch->>'focus')::boolean, false) then false
      else low end,
    prio = case when p_patch ? 'prio' then least(greatest(coalesce(nullif(p_patch->>'prio', '')::int, 0), 0), 3) else prio end,
    quick = case when p_patch ? 'quick' then coalesce((p_patch->>'quick')::boolean, false) else quick end,
    must = case
      when p_patch ? 'must' then coalesce((p_patch->>'must')::boolean, false)
      when p_patch ? 'due_date' and (nullif(p_patch->>'due_date', '') is null or (p_patch->>'due_date')::date > v_today) then false
      when p_patch ? 'done' and coalesce((p_patch->>'done')::boolean, false) then false
      else must end,
    reviewed_at = case when p_patch ? 'reviewed' then now() else reviewed_at end,
    done = case when p_patch ? 'done' then coalesce((p_patch->>'done')::boolean, false) else done end,
    done_at = case
      when p_patch ? 'done' then (case when coalesce((p_patch->>'done')::boolean, false) then now() else null end)
      else done_at end
  where id = p_id
  returning * into r;

  if p_patch ? 'done' then
    if r.done and not old.done and r.recur is not null and r.successor_id is null then
      nd := public.todo_next_date(coalesce(r.due_date, v_today), r.recur, v_today);
      -- the repeat stops once the next one would fall after the end date
      if r.recur_until is null or nd <= r.recur_until then
        insert into public.todos (title, due_date, category, recur, recur_until, is_session, items, remind_time, list, series_id, notes, prio, quick)
        values (r.title, nd, r.category, r.recur, r.recur_until, r.is_session,
                (select coalesce(jsonb_agg(jsonb_build_object('t', e->>'t', 'd', false)), '[]'::jsonb) from jsonb_array_elements(r.items) e),
                r.remind_time, r.list, coalesce(r.series_id, r.id), r.notes, r.prio, r.quick)
        returning * into nxt;
        update public.todos set successor_id = nxt.id, series_id = coalesce(r.series_id, r.id) where id = r.id returning * into r;
      end if;
    elsif not r.done and old.done and r.successor_id is not null then
      delete from public.todos where id = r.successor_id and done = false;
      select * into r from public.todos where id = p_id;
    end if;
  end if;
  return to_jsonb(r);
end $function$;
