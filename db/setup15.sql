-- To-do v15: Personal Projects details, Backlog vs My list, and an activity log.
--  * personal_projects.meta: links (site, vercel, supabase, github, claude), desc, started, target, icon (found from the site).
--  * todos.pp_backlog: a project task kept only on its project page (Backlog), out of the Personal list. Personal tasks only.
--  * personal_project_events: what happened in each project (tasks added/done, status, details), newest first.
-- Touches no shop_* objects and no config keys. Safe to run more than once.

alter table public.personal_projects add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.todos add column if not exists pp_backlog boolean not null default false;

create table if not exists public.personal_project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.personal_projects(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  text text
);
create index if not exists personal_project_events_proj on public.personal_project_events (project_id, at desc);
alter table public.personal_project_events enable row level security;

-- Clean a details object: known keys only, strings trimmed and capped, empties removed; dates must be YYYY-MM-DD.
create or replace function public.pproj_clean_meta(p jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare k text; v text; out jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  foreach k in array array['site', 'vercel', 'supabase', 'github', 'claude', 'desc', 'started', 'target', 'icon'] loop
    v := nullif(btrim(coalesce(p->>k, '')), '');
    if v is null then continue; end if;
    if k in ('started', 'target') then
      if v !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    elsif k = 'desc' then v := left(v, 200);
    else
      v := left(v, 300);
      if v !~* '^https://' then continue; end if;
    end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  return out;
end $$;
revoke all on function public.pproj_clean_meta(jsonb) from public, anon, authenticated;

create or replace function public.pproj_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'created_at', p.created_at, 'meta', p.meta,
      'open', (select count(*) from public.todos t where t.pproject_id = p.id and not t.done),
      'done', (select count(*) from public.todos t where t.pproject_id = p.id and t.done),
      'done_old', (select count(*) from public.todos t where t.pproject_id = p.id and t.done and not (t.done_at > now() - interval '7 days')),
      'last_at', coalesce((select max(e.at) from public.personal_project_events e where e.project_id = p.id), p.created_at))
      order by p.created_at)
    from public.personal_projects p
  ), '[]'::jsonb);
end $$;

-- Create (p_id null) or update name / status / details (p_meta replaces the details; null leaves them).
drop function if exists public.pproj_save(text, uuid, text, text);
create or replace function public.pproj_save(p_token text, p_id uuid, p_name text default null, p_status text default null, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_projects; old public.personal_projects; v_name text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
  v_meta jsonb := case when p_meta is null then null else public.pproj_clean_meta(p_meta) end;
  STL constant jsonb := '{"active":"Active","paused":"Paused","not_pursued":"Not pursued","shut_down":"Shut down"}';
begin
  perform public.todo_check(p_token);
  if p_status is not null and p_status not in ('active', 'paused', 'not_pursued', 'shut_down') then
    raise exception 'bad status' using errcode = '23514';
  end if;
  if v_meta is not null and length(v_meta::text) > 4000 then raise exception 'details too large' using errcode = '23514'; end if;
  if v_name is not null and exists (select 1 from public.personal_projects where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'name taken' using errcode = '23505';
  end if;
  if p_id is null then
    if v_name is null then raise exception 'name required' using errcode = '23514'; end if;
    if (select count(*) from public.personal_projects) >= 200 then raise exception 'too many' using errcode = '23514'; end if;
    insert into public.personal_projects (name, status, meta) values (v_name, coalesce(p_status, 'active'), coalesce(v_meta, '{}'::jsonb)) returning * into r;
    insert into public.personal_project_events (project_id, kind, text) values (r.id, 'created', r.name);
  else
    select * into old from public.personal_projects where id = p_id for update;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.personal_projects set name = coalesce(v_name, name), status = coalesce(p_status, status),
      meta = coalesce(v_meta, meta), updated_at = now()
      where id = p_id returning * into r;
    if r.status is distinct from old.status then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'status', (STL->>old.status) || ' → ' || (STL->>r.status));
    end if;
    if r.name is distinct from old.name then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'renamed', old.name || ' → ' || r.name);
    end if;
    if r.meta - 'icon' is distinct from old.meta - 'icon' then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'details', null);
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'created_at', r.created_at, 'meta', r.meta);
end $$;

-- A project's activity, newest first.
create or replace function public.pproj_events(p_token text, p_id uuid, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', e.at, 'k', e.kind, 't', e.text) order by e.at desc, e.id desc)
    from (select * from public.personal_project_events where project_id = p_id order by at desc, id desc
          limit least(greatest(coalesce(p_limit, 40), 1), 200)) e
  ), '[]'::jsonb);
end $$;

revoke all on function public.pproj_list(text) from public, anon, authenticated;
revoke all on function public.pproj_save(text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.pproj_events(text, uuid, int) from public, anon, authenticated;
grant execute on function public.pproj_list(text) to anon, service_role;
grant execute on function public.pproj_save(text, uuid, text, text, jsonb) to anon, service_role;
grant execute on function public.pproj_events(text, uuid, int) to anon, service_role;

-- Existing projects start their history with a 'created' entry so "last activity" is never blank.
insert into public.personal_project_events (project_id, at, kind, text)
select p.id, p.created_at, 'created', p.name from public.personal_projects p
where not exists (select 1 from public.personal_project_events e where e.project_id = p.id);

-- todo_update (as in setup14) plus pp_backlog (Personal project tasks only; cleared when unlinked or moved to Work,
-- copied to the next copy of a repeating task) and activity logging for project tasks.
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
    pp_backlog = case
      when (case when p_patch ? 'list' and (p_patch->>'list') in ('personal', 'work') then p_patch->>'list' else old.list end) <> 'personal' then false
      when p_patch ? 'pproject_id' and nullif(btrim(coalesce(p_patch->>'pproject_id', '')), '') is null then false
      when p_patch ? 'pp_backlog' then coalesce((p_patch->>'pp_backlog')::boolean, false)
      else pp_backlog end,
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
        insert into public.todos (title, due_date, category, recur, recur_until, is_session, items, remind_time, list, series_id, notes, prio, quick, pproject_id, pp_backlog)
        values (r.title, nd, r.category, r.recur, r.recur_until, r.is_session,
                (select coalesce(jsonb_agg(jsonb_build_object('t', e->>'t', 'd', false)), '[]'::jsonb) from jsonb_array_elements(r.items) e),
                r.remind_time, r.list, coalesce(r.series_id, r.id), r.notes, r.prio, r.quick, r.pproject_id, r.pp_backlog)
        returning * into nxt;
        update public.todos set successor_id = nxt.id, series_id = coalesce(r.series_id, r.id) where id = r.id returning * into r;
      end if;
    elsif not r.done and old.done and r.successor_id is not null then
      delete from public.todos where id = r.successor_id and done = false;
      select * into r from public.todos where id = p_id;
    end if;
  end if;
  -- Personal Project activity log (best effort, never blocks the update)
  begin
    if r.pproject_id is not null and r.pproject_id is distinct from old.pproject_id then
      insert into public.personal_project_events (project_id, kind, text) values (r.pproject_id, 'task_added', left(r.title, 200));
    elsif r.pproject_id is not null and r.pp_backlog is distinct from old.pp_backlog then
      insert into public.personal_project_events (project_id, kind, text) values (r.pproject_id, case when r.pp_backlog then 'to_backlog' else 'to_list' end, left(r.title, 200));
    end if;
    if r.pproject_id is not null and r.done is distinct from old.done then
      insert into public.personal_project_events (project_id, kind, text) values (r.pproject_id, case when r.done then 'task_done' else 'task_reopened' end, left(r.title, 200));
    end if;
  exception when others then null;
  end;
  return to_jsonb(r);
end $function$;
revoke all on function public.todo_update(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.todo_update(text, uuid, jsonb) to anon, service_role;
