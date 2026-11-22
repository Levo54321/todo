-- To-do v34: Work project pages (details in work_projects.meta) and the Work people list.
--  * work_people: names Luc picks as Owner / Requester / Recruiter. Removing a person only sets removed_at, so projects
--    that still point at them keep working and show "Name (removed)" until another person is picked.
--  * wproj_meta_get / wproj_meta_put: the page's details. put MERGES top-level keys (a key sent as null is removed),
--    so the RAG switch can save {rag} alone while the form sends all its keys. Changes are logged in
--    work_project_events: kinds rag, owner, requester, recruiter (text = new value) and details (text = changed keys).
--  * wproj_cards: what the board column header needs (rag, owner id, due date) plus the people list, in one call.
-- The API (api/projects.js) checks and cleans every field before put; this only stores. wproj_list is unchanged.
-- Touches no shop_* objects and no config key. Safe to run more than once.

create table if not exists public.work_people (
  id text primary key check (id ~ '^[0-9a-f]{12}$'),
  name text not null check (length(btrim(name)) between 1 and 40),
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists work_people_name_ci on public.work_people (lower(name)) where removed_at is null;
alter table public.work_people enable row level security;

-- Everyone, removed ones included (so old picks still have a name), A-Z.
create or replace function public.wpeople_json()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', name, 'removed', case when removed_at is not null then true end))
    order by lower(name), created_at), '[]'::jsonb) from public.work_people
$$;

create or replace function public.wpeople_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.wpeople_json(); end $$;

-- Add (new id) or rename (existing id). A removed person with the same name is brought back instead of duplicated.
create or replace function public.wpeople_save(p_token text, p_id text, p_name text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 40); v_old text;
begin
  perform public.todo_check(p_token);
  if v_name = '' then raise exception 'empty name' using errcode = '23514'; end if;
  if exists (select 1 from public.work_people where id = p_id) then
    update public.work_people set name = v_name where id = p_id;
  else
    select id into v_old from public.work_people where lower(name) = lower(v_name) and removed_at is not null order by created_at limit 1;
    if v_old is not null and not exists (select 1 from public.work_people where lower(name) = lower(v_name) and removed_at is null) then
      update public.work_people set removed_at = null where id = v_old;
    else
      insert into public.work_people (id, name) values (p_id, v_name);
    end if;
  end if;
  return public.wpeople_json();
end $$;

create or replace function public.wpeople_remove(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  update public.work_people set removed_at = now() where id = p_id and removed_at is null;
  if not found and not exists (select 1 from public.work_people where id = p_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  return public.wpeople_json();
end $$;

create or replace function public.wproj_page_json(p_id text)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('id', p.id, 'meta', p.meta,
    'created', to_char(p.created_at at time zone 'Europe/London', 'YYYY-MM-DD'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'text', e.text) order by e.at desc, e.id desc)
       from (select * from public.work_project_events where project_id = p.id order by at desc, id desc limit 60) e), '[]'::jsonb),
    'people', public.wpeople_json())
  from public.work_projects p where p.id = p_id
$$;

create or replace function public.wproj_meta_get(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v jsonb;
begin
  perform public.todo_check(p_token);
  v := public.wproj_page_json(p_id);
  if v is null then raise exception 'not found' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.wproj_meta_put(p_token text, p_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_old jsonb; v_new jsonb; k text; v_changed text[] := '{}'; v_txt text;
begin
  perform public.todo_check(p_token);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'bad meta' using errcode = '23514'; end if;
  select meta into v_old from public.work_projects where id = p_id for update;
  if v_old is null then raise exception 'not found' using errcode = 'P0002'; end if;
  v_new := jsonb_strip_nulls(v_old || p_patch);
  if pg_column_size(v_new) > 60000 then raise exception 'meta too big' using errcode = '23514'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if (v_old -> k) is not distinct from (v_new -> k) then continue; end if;
    if k = 'rag' then
      insert into public.work_project_events (project_id, kind, text) values (p_id, 'rag', coalesce(v_new ->> 'rag', ''));
    elsif k in ('owner', 'requester', 'recruiter') then
      select name into v_txt from public.work_people where id = v_new ->> k;
      insert into public.work_project_events (project_id, kind, text) values (p_id, k, coalesce(v_txt, ''));
    else v_changed := v_changed || k;
    end if;
  end loop;
  if array_length(v_changed, 1) > 0 then
    insert into public.work_project_events (project_id, kind, text) values (p_id, 'details', array_to_string(v_changed, ','));
  end if;
  update public.work_projects set meta = v_new, updated_at = now() where id = p_id;
  return public.wproj_page_json(p_id);
end $$;

-- Board headers: {cards: {id: {rag?, owner?, due?}}, people: [...]}, only projects that have one of them.
create or replace function public.wproj_cards(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return jsonb_build_object(
    'cards', coalesce((select jsonb_object_agg(id, c) from (
        select id, jsonb_strip_nulls(jsonb_build_object('rag', meta -> 'rag', 'owner', meta -> 'owner', 'due', meta #> '{dates,due}')) c
        from public.work_projects) x where c <> '{}'::jsonb), '{}'::jsonb),
    'people', public.wpeople_json());
end $$;

revoke all on function public.wpeople_json() from public, anon, authenticated;
revoke all on function public.wproj_page_json(text) from public, anon, authenticated;
revoke all on function public.wpeople_list(text) from public, anon, authenticated;
revoke all on function public.wpeople_save(text, text, text) from public, anon, authenticated;
revoke all on function public.wpeople_remove(text, text) from public, anon, authenticated;
revoke all on function public.wproj_meta_get(text, text) from public, anon, authenticated;
revoke all on function public.wproj_meta_put(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.wproj_cards(text) from public, anon, authenticated;
grant execute on function public.wpeople_list(text) to anon, service_role;
grant execute on function public.wpeople_save(text, text, text) to anon, service_role;
grant execute on function public.wpeople_remove(text, text) to anon, service_role;
grant execute on function public.wproj_meta_get(text, text) to anon, service_role;
grant execute on function public.wproj_meta_put(text, text, jsonb) to anon, service_role;
grant execute on function public.wproj_cards(text) to anon, service_role;
