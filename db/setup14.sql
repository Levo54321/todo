-- To-do v14: Personal Projects. Personal tasks can link to a project (todos.pproject_id); projects have a status.
-- Separate from Work projects (which stay as a Work task's category + the 'projects' config key) and from the
-- Personal category label. Touches no shop_* objects and no config keys. Safe to run more than once.

create table if not exists public.personal_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  status text not null default 'active' check (status in ('active', 'paused', 'not_pursued', 'shut_down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists personal_projects_name_ci on public.personal_projects (lower(name));
alter table public.personal_projects enable row level security;

alter table public.todos add column if not exists pproject_id uuid references public.personal_projects(id) on delete set null;
create index if not exists todos_pproject_id on public.todos (pproject_id) where pproject_id is not null;

-- All projects with all-time open/done task counts. done_old = finished more than 7 days ago (todo_list leaves those out,
-- so the app adds done_old to the done tasks it already has to show live progress).
create or replace function public.pproj_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'created_at', p.created_at,
      'open', (select count(*) from public.todos t where t.pproject_id = p.id and not t.done),
      'done', (select count(*) from public.todos t where t.pproject_id = p.id and t.done),
      'done_old', (select count(*) from public.todos t where t.pproject_id = p.id and t.done and not (t.done_at > now() - interval '7 days')))
      order by p.created_at)
    from public.personal_projects p
  ), '[]'::jsonb);
end $$;

-- Create (p_id null) or rename / change status. Names are unique ignoring capitalisation.
create or replace function public.pproj_save(p_token text, p_id uuid, p_name text default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_projects; v_name text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
begin
  perform public.todo_check(p_token);
  if p_status is not null and p_status not in ('active', 'paused', 'not_pursued', 'shut_down') then
    raise exception 'bad status' using errcode = '23514';
  end if;
  if v_name is not null and exists (select 1 from public.personal_projects where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'name taken' using errcode = '23505';
  end if;
  if p_id is null then
    if v_name is null then raise exception 'name required' using errcode = '23514'; end if;
    if (select count(*) from public.personal_projects) >= 200 then raise exception 'too many' using errcode = '23514'; end if;
    insert into public.personal_projects (name, status) values (v_name, coalesce(p_status, 'active')) returning * into r;
  else
    update public.personal_projects set name = coalesce(v_name, name), status = coalesce(p_status, status), updated_at = now()
      where id = p_id returning * into r;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'created_at', r.created_at);
end $$;

-- Remove a project; its tasks stay, they just lose the link.
create or replace function public.pproj_delete(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  delete from public.personal_projects where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pproj_list(text) from public, anon, authenticated;
revoke all on function public.pproj_save(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.pproj_delete(text, uuid) from public, anon, authenticated;
grant execute on function public.pproj_list(text) to anon, service_role;
grant execute on function public.pproj_save(text, uuid, text, text) to anon, service_role;
grant execute on function public.pproj_delete(text, uuid) to anon, service_role;

-- todo_update (as in setup11) plus pproject_id: Personal tasks only (cleared when a task moves to Work),
-- and copied to the next copy of a repeating task.
create or replace function public.todo_update(p_token text, p_id uuid, p_patch jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r public.todos; old public.todos; nxt public.todos; n int; nd date; v_blocked boolean;
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

  v_blocked := case
    when p_patch ? 'blocked' then coalesce((p_patch->>'blocked')::boolean, false)
    when p_patch ? 'done' and coalesce((p_patch->>'done')::boolean, false) then false
    else old.blocked end;
  if (case when p_patch ? 'list' and (p_patch->>'list') in ('personal', 'work') then p_patch->>'list' else old.list end) <> 'work' then v_blocked := false; end if;

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
    pproject_id = case
      when (case when p_patch ? 'list' and (p_patch->>'list') in ('personal', 'work') then p_patch->>'list' else old.list end) <> 'personal' then null
      when p_patch ? 'pproject_id' then nullif(btrim(coalesce(p_patch->>'pproject_id', '')), '')::uuid
      else pproject_id end,
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
      when v_blocked and not old.blocked then false
      else must end,
    blocked = v_blocked,
    blocked_at = case when v_blocked and not old.blocked then now() when not v_blocked then null else blocked_at end,
    unblock_action = case
      when not v_blocked then null
      when p_patch ? 'unblock_action' then nullif(left(btrim(coalesce(p_patch->>'unblock_action', '')), 300), '')
      else unblock_action end,
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
        insert into public.todos (title, due_date, category, recur, recur_until, is_session, items, remind_time, list, series_id, notes, prio, quick, pproject_id)
        values (r.title, nd, r.category, r.recur, r.recur_until, r.is_session,
                (select coalesce(jsonb_agg(jsonb_build_object('t', e->>'t', 'd', false)), '[]'::jsonb) from jsonb_array_elements(r.items) e),
                r.remind_time, r.list, coalesce(r.series_id, r.id), r.notes, r.prio, r.quick, r.pproject_id)
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
revoke all on function public.todo_update(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.todo_update(text, uuid, jsonb) to anon, service_role;
