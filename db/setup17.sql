-- To-do v17: My projects Deploy 2.
--  * Status 'idea' (not started yet). Its tasks are shelved like Paused (out of Overdue and the counts). Old values still accepted.
--  * meta.reason (max 300): why a project is Idea / Paused / Not pursued / Shut down and what is needed to move it on.
--    A change is logged as its own activity entry ('reason'), not as "Details updated".
--  * personal_projects.pos: hand-made order (drag and drop). One order across all projects; each lane shows its projects
--    in that order, so a project keeps its place relative to the others when it changes lane. New projects go first.
--    Existing projects start in the order the board showed them (latest activity first).
--  * pproj_order(ids): reorders the given projects among the positions they already hold.
-- Touches no shop_* objects and no config keys. Safe to run more than once.

alter table public.personal_projects drop constraint if exists personal_projects_status_check;
alter table public.personal_projects add constraint personal_projects_status_check
  check (status in ('idea', 'in_progress', 'live', 'paused', 'not_pursued', 'shut_down'));

alter table public.personal_projects add column if not exists pos integer;
update public.personal_projects p set pos = o.n
  from (select id, row_number() over (order by coalesce((select max(e.at) from public.personal_project_events e where e.project_id = x.id), x.created_at) desc, x.created_at desc, x.id) as n
        from public.personal_projects x) o
  where p.id = o.id and p.pos is null;
alter table public.personal_projects alter column pos set default 0;
alter table public.personal_projects alter column pos set not null;

create or replace function public.pproj_clean_meta(p jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare k text; v text; out jsonb := '{}'::jsonb; arr jsonb := '[]'::jsonb; e jsonb; lb text; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  foreach k in array array['vercel', 'supabase', 'github', 'desc', 'reason', 'started', 'target', 'icon'] loop
    v := nullif(btrim(coalesce(p->>k, '')), '');
    if v is null then continue; end if;
    if k in ('started', 'target') then
      if v !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    elsif k = 'desc' then v := left(v, 200);
    elsif k = 'reason' then v := left(v, 300);
    else
      v := left(v, 300);
      if v !~* '^https://' then continue; end if;
    end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  -- websites: list of https urls (old single 'site' is folded in), max 8, no duplicates
  if jsonb_typeof(p->'sites') = 'array' then
    for e in select * from jsonb_array_elements(p->'sites') loop
      v := left(btrim(coalesce(e #>> '{}', '')), 300);
      if v ~* '^https://' and not arr @> jsonb_build_array(v) and jsonb_array_length(arr) < 8 then arr := arr || jsonb_build_array(v); end if;
    end loop;
  end if;
  v := left(btrim(coalesce(p->>'site', '')), 300);
  if v ~* '^https://' and not arr @> jsonb_build_array(v) and jsonb_array_length(arr) < 8 then arr := jsonb_build_array(v) || arr; end if;
  if jsonb_array_length(arr) > 0 then out := out || jsonb_build_object('sites', arr); end if;
  -- other links: [{l, u}] (old single 'claude' is folded in as "Claude"), max 12
  arr := '[]'::jsonb;
  v := left(btrim(coalesce(p->>'claude', '')), 300);
  if v ~* '^https://' then arr := jsonb_build_array(jsonb_build_object('l', 'Claude', 'u', v)); end if;
  if jsonb_typeof(p->'links') = 'array' then
    for e in select * from jsonb_array_elements(p->'links') loop
      if jsonb_typeof(e) <> 'object' then continue; end if;
      v := left(btrim(coalesce(e->>'u', '')), 300);
      lb := nullif(left(btrim(coalesce(e->>'l', '')), 40), '');
      if v !~* '^https://' or jsonb_array_length(arr) >= 12 then continue; end if;
      if exists (select 1 from jsonb_array_elements(arr) x where x->>'u' = v) then continue; end if;
      arr := arr || jsonb_build_array(jsonb_build_object('l', coalesce(lb, 'Link'), 'u', v));
    end loop;
  end if;
  if jsonb_array_length(arr) > 0 then out := out || jsonb_build_object('links', arr); end if;
  return out;
end $$;
revoke all on function public.pproj_clean_meta(jsonb) from public, anon, authenticated;

create or replace function public.pproj_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'created_at', p.created_at, 'meta', p.meta, 'pos', p.pos,
      'open', (select count(*) from public.todos t where t.pproject_id = p.id and not t.done),
      'done', (select count(*) from public.todos t where t.pproject_id = p.id and t.done),
      'done_old', (select count(*) from public.todos t where t.pproject_id = p.id and t.done and not (t.done_at > now() - interval '7 days')),
      'last_at', coalesce((select max(e.at) from public.personal_project_events e where e.project_id = p.id), p.created_at))
      order by p.pos, p.created_at)
    from public.personal_projects p
  ), '[]'::jsonb);
end $$;

create or replace function public.pproj_save(p_token text, p_id uuid, p_name text default null, p_status text default null, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_projects; old public.personal_projects; v_name text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
  v_meta jsonb := case when p_meta is null then null else public.pproj_clean_meta(p_meta) end;
  v_status text := case when p_status = 'active' then 'in_progress' else p_status end;
  STL constant jsonb := '{"idea":"Idea","in_progress":"In progress","live":"Live","paused":"Paused","not_pursued":"Not pursued","shut_down":"Shut down"}';
begin
  perform public.todo_check(p_token);
  if v_status is not null and v_status not in ('idea', 'in_progress', 'live', 'paused', 'not_pursued', 'shut_down') then
    raise exception 'bad status' using errcode = '23514';
  end if;
  if v_meta is not null and length(v_meta::text) > 6000 then raise exception 'details too large' using errcode = '23514'; end if;
  if v_name is not null and exists (select 1 from public.personal_projects where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'name taken' using errcode = '23505';
  end if;
  if p_id is null then
    if v_name is null then raise exception 'name required' using errcode = '23514'; end if;
    if (select count(*) from public.personal_projects) >= 200 then raise exception 'too many' using errcode = '23514'; end if;
    insert into public.personal_projects (name, status, meta, pos)
      values (v_name, coalesce(v_status, 'in_progress'), coalesce(v_meta, '{}'::jsonb), coalesce((select min(pos) from public.personal_projects), 1) - 1)
      returning * into r;
    insert into public.personal_project_events (project_id, kind, text) values (r.id, 'created', r.name);
    if r.meta ? 'reason' then insert into public.personal_project_events (project_id, kind, text) values (r.id, 'reason', r.meta->>'reason'); end if;
  else
    select * into old from public.personal_projects where id = p_id for update;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.personal_projects set name = coalesce(v_name, name), status = coalesce(v_status, status),
      meta = coalesce(v_meta, meta), updated_at = now()
      where id = p_id returning * into r;
    if r.status is distinct from old.status then
      insert into public.personal_project_events (project_id, kind, text)
        values (r.id, 'status', coalesce(STL->>old.status, old.status) || ' → ' || coalesce(STL->>r.status, r.status));
    end if;
    if r.name is distinct from old.name then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'renamed', old.name || ' → ' || r.name);
    end if;
    if (r.meta->>'reason') is distinct from (old.meta->>'reason') then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'reason', r.meta->>'reason');
    end if;
    if r.meta - 'icon' - 'reason' is distinct from old.meta - 'icon' - 'reason' then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'details', null);
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'created_at', r.created_at, 'meta', r.meta, 'pos', r.pos);
end $$;

-- Reorder: the given projects swap among the positions they already hold, in the order given (one lane at a time).
create or replace function public.pproj_order(p_token text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
declare n int := coalesce(array_length(p_ids, 1), 0);
begin
  perform public.todo_check(p_token);
  if n = 0 or n > 200 or (select count(distinct x) from unnest(p_ids) x) <> n then raise exception 'bad order' using errcode = '23514'; end if;
  if (select count(*) from public.personal_projects where id = any(p_ids)) <> n then raise exception 'not found' using errcode = 'P0002'; end if;
  perform 1 from public.personal_projects where id = any(p_ids) for update;
  update public.personal_projects p set pos = s.pos
    from (select w.id, h.pos
          from (select x as id, ord from unnest(p_ids) with ordinality u(x, ord)) w
          join (select pos, row_number() over (order by pos, id) as ord from public.personal_projects where id = any(p_ids)) h on h.ord = w.ord) s
    where p.id = s.id;
  return coalesce((select jsonb_object_agg(id, pos) from public.personal_projects where id = any(p_ids)), '{}'::jsonb);
end $$;

revoke all on function public.pproj_list(text) from public, anon, authenticated;
revoke all on function public.pproj_save(text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.pproj_order(text, uuid[]) from public, anon, authenticated;
grant execute on function public.pproj_list(text) to anon, service_role;
grant execute on function public.pproj_save(text, uuid, text, text, jsonb) to anon, service_role;
grant execute on function public.pproj_order(text, uuid[]) to anon, service_role;
