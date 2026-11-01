-- To-do v16: My projects statuses + multiple links.
--  * Status 'active' becomes two: 'in_progress' (being worked on) and 'live' (deployed / done, still takes tasks).
--    Existing 'active' projects become 'in_progress'. 'active' is still accepted on save and stored as 'in_progress'.
--    Shelved statuses (tasks out of Overdue and counts) stay: paused, not_pursued, shut_down.
--  * Details hold lists: meta.sites = [https urls] (several domains), meta.links = [{l: label, u: https url}]
--    (Claude projects/sessions, docs ...). meta.site / meta.claude from v15 are moved into those lists.
--    vercel, supabase, github, desc, started, target, icon stay single values.
-- Touches no shop_* objects and no config keys. Safe to run more than once.

alter table public.personal_projects drop constraint if exists personal_projects_status_check;
update public.personal_projects set status = 'in_progress' where status = 'active';
alter table public.personal_projects alter column status set default 'in_progress';
alter table public.personal_projects add constraint personal_projects_status_check
  check (status in ('in_progress', 'live', 'paused', 'not_pursued', 'shut_down'));

create or replace function public.pproj_clean_meta(p jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare k text; v text; out jsonb := '{}'::jsonb; arr jsonb := '[]'::jsonb; e jsonb; lb text; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  foreach k in array array['vercel', 'supabase', 'github', 'desc', 'started', 'target', 'icon'] loop
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

-- move v15 single links into the lists
update public.personal_projects set meta = public.pproj_clean_meta(meta) where meta ? 'site' or meta ? 'claude';

create or replace function public.pproj_save(p_token text, p_id uuid, p_name text default null, p_status text default null, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_projects; old public.personal_projects; v_name text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
  v_meta jsonb := case when p_meta is null then null else public.pproj_clean_meta(p_meta) end;
  v_status text := case when p_status = 'active' then 'in_progress' else p_status end;
  STL constant jsonb := '{"in_progress":"In progress","live":"Live","paused":"Paused","not_pursued":"Not pursued","shut_down":"Shut down"}';
begin
  perform public.todo_check(p_token);
  if v_status is not null and v_status not in ('in_progress', 'live', 'paused', 'not_pursued', 'shut_down') then
    raise exception 'bad status' using errcode = '23514';
  end if;
  if v_meta is not null and length(v_meta::text) > 6000 then raise exception 'details too large' using errcode = '23514'; end if;
  if v_name is not null and exists (select 1 from public.personal_projects where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'name taken' using errcode = '23505';
  end if;
  if p_id is null then
    if v_name is null then raise exception 'name required' using errcode = '23514'; end if;
    if (select count(*) from public.personal_projects) >= 200 then raise exception 'too many' using errcode = '23514'; end if;
    insert into public.personal_projects (name, status, meta) values (v_name, coalesce(v_status, 'in_progress'), coalesce(v_meta, '{}'::jsonb)) returning * into r;
    insert into public.personal_project_events (project_id, kind, text) values (r.id, 'created', r.name);
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
    if r.meta - 'icon' is distinct from old.meta - 'icon' then
      insert into public.personal_project_events (project_id, kind, text) values (r.id, 'details', null);
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'created_at', r.created_at, 'meta', r.meta);
end $$;
revoke all on function public.pproj_save(text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pproj_save(text, uuid, text, text, jsonb) to anon, service_role;
