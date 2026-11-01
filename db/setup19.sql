-- To-do v19: My projects Deploy 4a — account labels and stored icons.
--  * meta.acct_vercel / acct_supabase / acct_github: which account, team or org a project lives in (email or username,
--    plain text, max 80). Never passwords.
--  * personal_project_icons: one icon per project, stored in the database so it still shows when the site is down or
--    paused. kind 'upload' (picked by Luc, resized in the browser), 'site' (a copy of the site's own icon) or 'none'
--    (removed on purpose: show the first letter and do not fetch from the site again). data = base64, max ~200 KB.
--  * pproj_list returns icon_kind and icon_at (ms, used to refresh the cached image).
-- Touches no shop_* objects and no config keys. Safe to run more than once.

create table if not exists public.personal_project_icons (
  project_id uuid primary key references public.personal_projects(id) on delete cascade,
  kind text not null check (kind in ('upload', 'site', 'none')),
  mime text check (mime is null or mime in ('image/png', 'image/jpeg', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/webp')),
  data text check (data is null or length(data) <= 280000),
  updated_at timestamptz not null default now(),
  check ((kind = 'none') = (data is null))
);
alter table public.personal_project_icons enable row level security;

create or replace function public.pproj_clean_meta(p jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare k text; v text; out jsonb := '{}'::jsonb; arr jsonb := '[]'::jsonb; e jsonb; lb text; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  foreach k in array array['vercel', 'supabase', 'github', 'desc', 'reason', 'started', 'target', 'icon', 'acct_vercel', 'acct_supabase', 'acct_github'] loop
    v := nullif(btrim(coalesce(p->>k, '')), '');
    if v is null then continue; end if;
    if k in ('started', 'target') then
      if v !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    elsif k = 'desc' then v := left(v, 200);
    elsif k = 'reason' then v := left(v, 300);
    elsif k like 'acct\_%' then v := left(v, 80);
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
      'last_at', coalesce((select max(e.at) from public.personal_project_events e where e.project_id = p.id), p.created_at),
      'costs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'amount', c.amount, 'currency', c.currency,
                 'freq', c.freq, 'next_due', c.next_due, 'link', c.link, 'email', c.email) order by c.created_at, c.id)
               from public.personal_project_costs c where c.project_id = p.id), '[]'::jsonb),
      'icon_kind', (select i.kind from public.personal_project_icons i where i.project_id = p.id),
      'icon_at', (select floor(extract(epoch from i.updated_at) * 1000)::bigint from public.personal_project_icons i where i.project_id = p.id))
      order by p.pos, p.created_at)
    from public.personal_projects p
  ), '[]'::jsonb);
end $$;


-- The stored icon itself.
create or replace function public.picon_get(p_token text, p_project uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_project_icons;
begin
  perform public.todo_check(p_token);
  select * into r from public.personal_project_icons where project_id = p_project and kind <> 'none';
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('mime', r.mime, 'data', r.data, 'at', floor(extract(epoch from r.updated_at) * 1000)::bigint);
end $$;

-- Store an icon. kind 'site' never replaces an upload or a removal unless p_force (Luc tapped "Get from website").
-- kind 'none' = removed (letter). Upload/removal are written to the activity log.
create or replace function public.picon_set(p_token text, p_project uuid, p_kind text, p_mime text default null, p_data text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare cur text;
begin
  perform public.todo_check(p_token);
  if p_kind not in ('upload', 'site', 'none') then raise exception 'bad kind' using errcode = '23514'; end if;
  if (p_kind = 'none') <> (p_data is null) then raise exception 'bad icon' using errcode = '23514'; end if;
  if not exists (select 1 from public.personal_projects where id = p_project) then raise exception 'not found' using errcode = 'P0002'; end if;
  select kind into cur from public.personal_project_icons where project_id = p_project;
  if p_kind = 'site' and not p_force and cur in ('upload', 'none') then return jsonb_build_object('stored', false, 'kind', cur); end if;
  insert into public.personal_project_icons (project_id, kind, mime, data, updated_at)
    values (p_project, p_kind, case when p_kind = 'none' then null else p_mime end, p_data, now())
    on conflict (project_id) do update set kind = excluded.kind, mime = excluded.mime, data = excluded.data, updated_at = now();
  if p_kind = 'upload' then insert into public.personal_project_events (project_id, kind, text) values (p_project, 'icon', 'uploaded');
  elsif p_kind = 'none' then insert into public.personal_project_events (project_id, kind, text) values (p_project, 'icon', 'removed');
  elsif p_force then insert into public.personal_project_events (project_id, kind, text) values (p_project, 'icon', 'from the website');
  end if;
  return jsonb_build_object('stored', true, 'kind', p_kind, 'at', floor(extract(epoch from now()) * 1000)::bigint);
end $$;

revoke all on function public.pproj_list(text) from public, anon, authenticated;
revoke all on function public.picon_get(text, uuid) from public, anon, authenticated;
revoke all on function public.picon_set(text, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.pproj_list(text) to anon, service_role;
grant execute on function public.picon_get(text, uuid) to anon, service_role;
grant execute on function public.picon_set(text, uuid, text, text, text, boolean) to anon, service_role;
