-- To-do v36: Work project status updates (pasted from work Claude, or typed by hand).
--  * work_project_updates: one row per update. rag = the RAG that was SUGGESTED (not the project's RAG); rag_accepted says whether
--    Luc accepted it (then the project's meta.rag was set through wproj_meta_put, which logs the usual 'rag' event).
--    Sections done/next/blockers/risks/decisions are jsonb arrays of short strings, asks = [{who,what}],
--    sources = {slack:[{n,u}], linear:[{n,u}]}, origin = 'claude' (pasted block) or 'manual' (typed, headline + notes).
--  * work_status_state: one row remembering the hash of the last "Copy for Claude" export, so "changed since last copy" is the
--    same on every device.
--  * wupd_list (one project, newest first), wupd_add (several updates in ONE transaction), wupd_export (open projects for the
--    export; the text itself is built in api/_wstatus.js), wupd_copied (remember the hash).
-- The API (api/projects.js, api/_wstatus.js) cleans every field before it gets here. Touches no shop_* objects and no config key.
-- Safe to run more than once.

create table if not exists public.work_project_updates (
  id bigserial primary key,
  project_id text not null references public.work_projects(id) on delete cascade,
  at timestamptz not null default now(),
  period text check (period is null or length(period) <= 60),
  rag text check (rag is null or rag in ('r', 'a', 'g')),
  headline text not null check (length(btrim(headline)) between 1 and 200),
  done jsonb not null default '[]'::jsonb,
  next jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  asks jsonb not null default '[]'::jsonb,
  sources jsonb not null default '{}'::jsonb,
  notes text check (notes is null or length(notes) <= 4000),
  origin text not null check (origin in ('claude', 'manual')),
  rag_accepted boolean not null default false
);
create index if not exists work_project_updates_p on public.work_project_updates (project_id, at desc, id desc);
alter table public.work_project_updates enable row level security;

create table if not exists public.work_status_state (
  id int primary key check (id = 1),
  export_hash text,
  copied_at timestamptz
);
alter table public.work_status_state enable row level security;

create or replace function public.wupd_json(p_row public.work_project_updates)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_row.id, 'at', p_row.at, 'period', p_row.period, 'rag', p_row.rag,
    'headline', p_row.headline, 'done', p_row.done, 'next', p_row.next, 'blockers', p_row.blockers, 'risks', p_row.risks,
    'decisions', p_row.decisions, 'asks', p_row.asks, 'sources', p_row.sources, 'notes', p_row.notes,
    'origin', p_row.origin, 'rag_accepted', p_row.rag_accepted))
$$;

create or replace function public.wupd_list(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  if not exists (select 1 from public.work_projects where id = p_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(public.wupd_json(u) order by u.at desc, u.id desc)
    from (select * from public.work_project_updates where project_id = p_id order by at desc, id desc limit 100) u), '[]'::jsonb);
end $$;

-- p_items: [{project_id, accept_rag (bool), update:{period?, rag?, headline, done.., asks, sources, notes?}, origin}]
-- One transaction: any failure saves nothing. Returns {saved, projects:[ids]}.
create or replace function public.wupd_add(p_token text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare it jsonb; u jsonb; v_id text; v_rag text; v_acc boolean; v_ids text[] := '{}'; n int := 0;
begin
  perform public.todo_check(p_token);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'bad items' using errcode = '23514';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_id := it ->> 'project_id'; u := it -> 'update';
    if not exists (select 1 from public.work_projects where id = v_id) then raise exception 'not found' using errcode = 'P0002'; end if;
    v_rag := nullif(u ->> 'rag', '');
    v_acc := coalesce((it ->> 'accept_rag')::boolean, false) and v_rag is not null;
    insert into public.work_project_updates (project_id, period, rag, headline, done, next, blockers, risks, decisions, asks, sources, notes, origin, rag_accepted)
    values (v_id, nullif(u ->> 'period', ''), v_rag, u ->> 'headline',
      coalesce(u -> 'done', '[]'), coalesce(u -> 'next', '[]'), coalesce(u -> 'blockers', '[]'), coalesce(u -> 'risks', '[]'),
      coalesce(u -> 'decisions', '[]'), coalesce(u -> 'asks', '[]'), coalesce(u -> 'sources', '{}'), nullif(u ->> 'notes', ''),
      it ->> 'origin', v_acc);
    if v_acc then perform public.wproj_meta_put(p_token, v_id, jsonb_build_object('rag', v_rag)); end if;
    n := n + 1; v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('saved', n, 'projects', to_jsonb(v_ids));
end $$;

-- Open (active and on hold) projects in list order, with what the export needs; people and the last-copied hash ride along.
create or replace function public.wupd_export(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return jsonb_build_object(
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'meta', p.meta,
        'last', (select jsonb_build_object('at', to_char(u.at at time zone 'Europe/London', 'YYYY-MM-DD'), 'headline', u.headline)
                 from public.work_project_updates u where u.project_id = p.id order by u.at desc, u.id desc limit 1)) order by p.pos, p.created_at)
      from public.work_projects p where p.status <> 'done'), '[]'::jsonb),
    'people', public.wpeople_json(),
    'last_hash', (select export_hash from public.work_status_state where id = 1),
    'today', to_char(now() at time zone 'Europe/London', 'YYYY-MM-DD'));
end $$;

create or replace function public.wupd_copied(p_token text, p_hash text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  insert into public.work_status_state (id, export_hash, copied_at) values (1, left(p_hash, 80), now())
    on conflict (id) do update set export_hash = excluded.export_hash, copied_at = excluded.copied_at;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.wupd_json(public.work_project_updates) from public, anon, authenticated;
revoke all on function public.wupd_list(text, text) from public, anon, authenticated;
revoke all on function public.wupd_add(text, jsonb) from public, anon, authenticated;
revoke all on function public.wupd_export(text) from public, anon, authenticated;
revoke all on function public.wupd_copied(text, text) from public, anon, authenticated;
grant execute on function public.wupd_list(text, text) to anon, service_role;
grant execute on function public.wupd_add(text, jsonb) to anon, service_role;
grant execute on function public.wupd_export(text) to anon, service_role;
grant execute on function public.wupd_copied(text, text) to anon, service_role;
