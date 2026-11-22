-- To-do v35: Work projects are Internal or for a Client.
--  * work_clients: the list Luc manages (name unique ignoring case). A project's client is meta.client = <client id>;
--    no meta.client = Internal (so every existing project is Internal with no data change).
--  * work_client_icons: one optional icon per client, in its own table (never in meta). base64, max ~200 KB, checked by the API.
--  * wproj_meta_put: now also (a) refuses a client id that does not exist, (b) logs kind 'client' (text = client name,
--    '' = back to Internal).
--  * wclient_remove: resets every project using that client back to Internal, logs kind 'client_removed' (text = client
--    name) in each project's activity, then deletes the client and its icon. Returns {clients, reset}.
--  * wproj_page_json (page) and wproj_cards (board) now also carry the clients list; cards carry each project's client id.
-- The API (api/projects.js, api/_wclients.js) cleans every field before it gets here. Touches no shop_* objects and no
-- config key. Safe to run more than once.

create table if not exists public.work_clients (
  id text primary key check (id ~ '^[0-9a-f]{12}$'),
  name text not null check (length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index if not exists work_clients_name_ci on public.work_clients (lower(name));
alter table public.work_clients enable row level security;

create table if not exists public.work_client_icons (
  client_id text primary key references public.work_clients(id) on delete cascade,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  data text not null check (length(data) <= 280000),
  updated_at timestamptz not null default now()
);
alter table public.work_client_icons enable row level security;

-- [{id, name, icon_at? (ms, the cache stamp), n (projects using it)}] A-Z.
create or replace function public.wclients_json()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
      'icon_at', (select floor(extract(epoch from i.updated_at) * 1000)::bigint from public.work_client_icons i where i.client_id = c.id),
      'n', (select count(*) from public.work_projects p where p.meta ->> 'client' = c.id)))
    order by lower(c.name), c.created_at), '[]'::jsonb) from public.work_clients c
$$;

create or replace function public.wclient_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.wclients_json(); end $$;

-- Add (new id) or rename (existing id).
create or replace function public.wclient_save(p_token text, p_id text, p_name text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 40);
begin
  perform public.todo_check(p_token);
  if v_name = '' then raise exception 'empty name' using errcode = '23514'; end if;
  if exists (select 1 from public.work_clients where id = p_id) then
    update public.work_clients set name = v_name where id = p_id;
  else
    insert into public.work_clients (id, name) values (p_id, v_name);
  end if;
  return public.wclients_json();
end $$;

create or replace function public.wclient_remove(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_name text; v_n int := 0; r record;
begin
  perform public.todo_check(p_token);
  select name into v_name from public.work_clients where id = p_id for update;
  if v_name is null then raise exception 'not found' using errcode = 'P0002'; end if;
  for r in select id from public.work_projects where meta ->> 'client' = p_id for update loop
    update public.work_projects set meta = meta - 'client', updated_at = now() where id = r.id;
    insert into public.work_project_events (project_id, kind, text) values (r.id, 'client_removed', v_name);
    v_n := v_n + 1;
  end loop;
  delete from public.work_clients where id = p_id; -- the icon goes with it (on delete cascade)
  return jsonb_build_object('clients', public.wclients_json(), 'reset', v_n);
end $$;

create or replace function public.wclient_icon_get(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.work_client_icons;
begin
  perform public.todo_check(p_token);
  select * into r from public.work_client_icons where client_id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('mime', r.mime, 'data', r.data);
end $$;

-- Store (p_data given) or remove (p_data null) a client's icon.
create or replace function public.wclient_icon_set(p_token text, p_id text, p_mime text, p_data text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  if not exists (select 1 from public.work_clients where id = p_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_data is null then
    delete from public.work_client_icons where client_id = p_id;
  else
    insert into public.work_client_icons (client_id, mime, data, updated_at) values (p_id, p_mime, p_data, now())
      on conflict (client_id) do update set mime = excluded.mime, data = excluded.data, updated_at = now();
  end if;
  return public.wclients_json();
end $$;

create or replace function public.wproj_page_json(p_id text)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('id', p.id, 'meta', p.meta,
    'created', to_char(p.created_at at time zone 'Europe/London', 'YYYY-MM-DD'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'text', e.text) order by e.at desc, e.id desc)
       from (select * from public.work_project_events where project_id = p.id order by at desc, id desc limit 60) e), '[]'::jsonb),
    'people', public.wpeople_json(),
    'clients', public.wclients_json())
  from public.work_projects p where p.id = p_id
$$;

create or replace function public.wproj_meta_put(p_token text, p_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_old jsonb; v_new jsonb; k text; v_changed text[] := '{}'; v_txt text;
begin
  perform public.todo_check(p_token);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'bad meta' using errcode = '23514'; end if;
  select meta into v_old from public.work_projects where id = p_id for update;
  if v_old is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_patch -> 'client') = 'string' and not exists (select 1 from public.work_clients where id = p_patch ->> 'client') then
    raise exception 'bad client' using errcode = '23514';
  end if;
  v_new := jsonb_strip_nulls(v_old || p_patch);
  if pg_column_size(v_new) > 60000 then raise exception 'meta too big' using errcode = '23514'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if (v_old -> k) is not distinct from (v_new -> k) then continue; end if;
    if k = 'rag' then
      insert into public.work_project_events (project_id, kind, text) values (p_id, 'rag', coalesce(v_new ->> 'rag', ''));
    elsif k in ('owner', 'requester', 'recruiter') then
      select name into v_txt from public.work_people where id = v_new ->> k;
      insert into public.work_project_events (project_id, kind, text) values (p_id, k, coalesce(v_txt, ''));
    elsif k = 'client' then
      select name into v_txt from public.work_clients where id = v_new ->> 'client';
      insert into public.work_project_events (project_id, kind, text) values (p_id, 'client', coalesce(v_txt, ''));
    else v_changed := v_changed || k;
    end if;
  end loop;
  if array_length(v_changed, 1) > 0 then
    insert into public.work_project_events (project_id, kind, text) values (p_id, 'details', array_to_string(v_changed, ','));
  end if;
  update public.work_projects set meta = v_new, updated_at = now() where id = p_id;
  return public.wproj_page_json(p_id);
end $$;

-- Board headers: {cards: {id: {rag?, owner?, due?, client?}}, people, clients}.
create or replace function public.wproj_cards(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return jsonb_build_object(
    'cards', coalesce((select jsonb_object_agg(id, c) from (
        select id, jsonb_strip_nulls(jsonb_build_object('rag', meta -> 'rag', 'owner', meta -> 'owner', 'due', meta #> '{dates,due}', 'client', meta -> 'client')) c
        from public.work_projects) x where c <> '{}'::jsonb), '{}'::jsonb),
    'people', public.wpeople_json(),
    'clients', public.wclients_json());
end $$;

revoke all on function public.wclients_json() from public, anon, authenticated;
revoke all on function public.wclient_list(text) from public, anon, authenticated;
revoke all on function public.wclient_save(text, text, text) from public, anon, authenticated;
revoke all on function public.wclient_remove(text, text) from public, anon, authenticated;
revoke all on function public.wclient_icon_get(text, text) from public, anon, authenticated;
revoke all on function public.wclient_icon_set(text, text, text, text) from public, anon, authenticated;
revoke all on function public.wproj_page_json(text) from public, anon, authenticated;
revoke all on function public.wproj_meta_put(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.wproj_cards(text) from public, anon, authenticated;
grant execute on function public.wclient_list(text) to anon, service_role;
grant execute on function public.wclient_save(text, text, text) to anon, service_role;
grant execute on function public.wclient_remove(text, text) to anon, service_role;
grant execute on function public.wclient_icon_get(text, text) to anon, service_role;
grant execute on function public.wclient_icon_set(text, text, text, text) to anon, service_role;
grant execute on function public.wproj_meta_put(text, text, jsonb) to anon, service_role;
grant execute on function public.wproj_cards(text) to anon, service_role;
