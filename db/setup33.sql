-- To-do v33: Work projects move from the 'projects' config key into their own table (like Personal Projects).
--  * work_projects: one row per Work project. id keeps the old 12-character ids; pos = place in the list (the old array
--    order); task_order = the board's hand-set order of that project's tasks (the old 'order' key); meta is for the
--    per-project details coming next (owner, requester, links, client, RAG ...), unused so far.
--  * work_project_events: activity log (created, renamed, prio, status), newest first.
--  * Tasks still belong to a project by todos.category (the name); rename moves them (project_rename).
--  * The 'projects' config key is NOT deleted: every write here rewrites it from the table (wproj_mirror), so the
--    previous app version still reads an up-to-date list if a deploy is rolled back. Drop the mirror in a later release.
-- Touches no shop_* objects and no config key other than 'projects'. Safe to run more than once.

create table if not exists public.work_projects (
  id text primary key check (id ~ '^[0-9a-f]{12}$'),
  name text not null check (length(btrim(name)) between 1 and 40),
  prio int not null default 0 check (prio between 0 and 3),
  status text not null default 'active' check (status in ('active', 'hold', 'done')),
  pos int not null default 0,
  task_order jsonb not null default '[]'::jsonb check (jsonb_typeof(task_order) = 'array'),
  left_open int check (left_open between 0 and 999),
  done_at timestamptz,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists work_projects_name_ci on public.work_projects (lower(name));
alter table public.work_projects enable row level security;

create table if not exists public.work_project_events (
  id bigint generated always as identity primary key,
  project_id text not null references public.work_projects(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  text text
);
create index if not exists work_project_events_proj on public.work_project_events (project_id, at desc);
alter table public.work_project_events enable row level security;

-- The list in exactly the shape the old config key held (keys left out when not set), in list order.
create or replace function public.wproj_json()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'name', p.name,
      'prio', nullif(p.prio, 0),
      'order', case when jsonb_array_length(p.task_order) > 0 then p.task_order end,
      'status', nullif(p.status, 'active'),
      'done_at', to_char(p.done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'left_open', p.left_open)) order by p.pos, p.created_at), '[]'::jsonb)
  from public.work_projects p
$$;

-- Keep the old config key in step (fallback for one release). Empty list = no key, as before.
create or replace function public.wproj_mirror()
returns void language plpgsql security definer set search_path to '' as $$
declare v jsonb := public.wproj_json();
begin
  if jsonb_array_length(v) = 0 then delete from public.app_config where key = 'projects';
  else insert into public.app_config (key, value) values ('projects', v::text) on conflict (key) do update set value = excluded.value;
  end if;
end $$;

-- One-off copy of the config list (ids, list order, prio, status, task order, left_open, done_at). Ids already copied are skipped.
insert into public.work_projects (id, name, prio, status, pos, task_order, left_open, done_at)
select e->>'id', left(btrim(e->>'name'), 40),
       coalesce(nullif(e->>'prio', '')::int, 0),
       coalesce(nullif(e->>'status', ''), 'active'),
       x.i::int,
       case when jsonb_typeof(e->'order') = 'array' then e->'order' else '[]'::jsonb end,
       nullif(e->>'left_open', '')::int,
       nullif(e->>'done_at', '')::timestamptz
from public.app_config c, jsonb_array_elements(c.value::jsonb) with ordinality x(e, i)
where c.key = 'projects' and jsonb_typeof(c.value::jsonb) = 'array'
on conflict (id) do nothing;

create or replace function public.wproj_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return public.wproj_json();
end $$;

-- Create (p_patch.new = true, with name) or change one project. Patch keys: name, prio (0-3), status (active/hold/done),
-- left_open (only with status done), order (task ids; [] clears). Returns {projects, tasks} where tasks = Work tasks moved
-- by a rename (0 otherwise). Name clash ignoring case -> unique violation 23505; bad values -> 23514; unknown id -> P0002.
create or replace function public.wproj_save(p_token text, p_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.work_projects; v_name text; v_prio int; v_st text; v_lo int; n int := 0;
begin
  perform public.todo_check(p_token);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'bad patch' using errcode = '23514'; end if;
  if p_patch ? 'name' then
    v_name := left(btrim(coalesce(p_patch->>'name', '')), 40);
    if v_name = '' then raise exception 'bad name' using errcode = '23514'; end if;
  end if;
  if coalesce((p_patch->>'new')::boolean, false) then
    if v_name is null then raise exception 'bad name' using errcode = '23514'; end if;
    insert into public.work_projects (id, name, pos)
      values (p_id, v_name, coalesce((select max(pos) + 1 from public.work_projects), 0)) returning * into r;
    insert into public.work_project_events (project_id, kind, text) values (r.id, 'created', r.name);
  else
    select * into r from public.work_projects where id = p_id for update;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    if p_patch ? 'order' then
      if jsonb_typeof(p_patch->'order') <> 'array' then raise exception 'bad order' using errcode = '23514'; end if;
      update public.work_projects set task_order = p_patch->'order', updated_at = now() where id = r.id;
    end if;
    if p_patch ? 'prio' then
      v_prio := (p_patch->>'prio')::int;
      if v_prio is null or v_prio < 0 or v_prio > 3 then raise exception 'bad priority' using errcode = '23514'; end if;
      if v_prio <> r.prio then
        update public.work_projects set prio = v_prio, updated_at = now() where id = r.id;
        insert into public.work_project_events (project_id, kind, text) values (r.id, 'prio', v_prio::text);
      end if;
    end if;
    if p_patch ? 'status' then
      v_st := p_patch->>'status';
      if v_st is null or v_st not in ('active', 'hold', 'done') then raise exception 'bad status' using errcode = '23514'; end if;
      if v_st = 'done' then
        if r.status <> 'done' then
          v_lo := case when (p_patch->>'left_open') ~ '^\d{1,3}$' then (p_patch->>'left_open')::int end;
          update public.work_projects set status = 'done', done_at = now(), left_open = v_lo, updated_at = now() where id = r.id;
        end if;
      else
        update public.work_projects set status = v_st, done_at = null, left_open = null, updated_at = now() where id = r.id;
      end if;
      if v_st <> r.status then insert into public.work_project_events (project_id, kind, text) values (r.id, 'status', v_st); end if;
    end if;
    if v_name is not null and v_name <> r.name then
      update public.work_projects set name = v_name, updated_at = now() where id = r.id;
      insert into public.work_project_events (project_id, kind, text) values (r.id, 'renamed', r.name || ' → ' || v_name);
      n := public.project_rename(p_token, r.name, v_name);
    end if;
  end if;
  perform public.wproj_mirror();
  return jsonb_build_object('projects', public.wproj_json(), 'tasks', coalesce(n, 0));
end $$;

-- Remove a project; Work tasks carrying it lose the project. Returns {projects, tasks}.
create or replace function public.wproj_delete(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_name text; n int := 0;
begin
  perform public.todo_check(p_token);
  delete from public.work_projects where id = p_id returning name into v_name;
  if v_name is null then raise exception 'not found' using errcode = 'P0002'; end if;
  n := public.project_clear(p_token, v_name);
  perform public.wproj_mirror();
  return jsonb_build_object('projects', public.wproj_json(), 'tasks', coalesce(n, 0));
end $$;

-- Activity log of one project, newest first.
create or replace function public.wproj_events(p_token text, p_id text, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'text', e.text) order by e.at desc, e.id desc)
    from (select * from public.work_project_events where project_id = p_id order by at desc, id desc limit greatest(1, least(coalesce(p_limit, 50), 200))) e), '[]'::jsonb);
end $$;

revoke all on function public.wproj_json() from public, anon, authenticated;
revoke all on function public.wproj_mirror() from public, anon, authenticated;
revoke all on function public.wproj_list(text) from public, anon, authenticated;
revoke all on function public.wproj_save(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.wproj_delete(text, text) from public, anon, authenticated;
revoke all on function public.wproj_events(text, text, int) from public, anon, authenticated;
grant execute on function public.wproj_list(text) to anon, service_role;
grant execute on function public.wproj_save(text, text, jsonb) to anon, service_role;
grant execute on function public.wproj_delete(text, text) to anon, service_role;
grant execute on function public.wproj_events(text, text, int) to anon, service_role;
