-- To-do v26: Jobs tab (application tracker). New objects only: tables job_stages, jobs, job_events and functions job_*.
-- No change to todos, todo_check, any other table, any shop_* object or any config key. Safe to run twice.
--
-- job_stages = the pipeline columns, fully editable (name, colour, kind active/won/lost, optional "follow up after N days").
-- jobs       = one row per posting/application; stage_id says which column it sits in (pos = order inside the column,
--              new and moved cards go to the top). applied_on is set automatically the first time a card leaves the first stage.
-- job_events = history (added, moved to <stage>).
-- Removing a stage moves its jobs to the stage before it (or the first remaining one).
--
-- Same split as setup25: the *_do functions hold the logic and are NOT callable by the API roles; the public wrappers
-- check the access token (todo_check) first. That lets the logic be tested inside begin/rollback without a token.

create table if not exists public.job_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 40),
  color text not null default 'sand' check (color in ('sand','clay','ochre','sage','moss','stone','rose','slate')),
  kind text not null default 'active' check (kind in ('active','won','lost')),
  follow_days int check (follow_days is null or follow_days between 1 and 60),
  pos int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  company text not null default '' check (length(company) <= 120),
  role text not null default '' check (length(role) <= 160),
  location text not null default '' check (length(location) <= 120),
  mode text not null default '' check (mode in ('', 'remote', 'hybrid', 'onsite')),
  salary text not null default '' check (length(salary) <= 60),
  url text not null default '' check (length(url) <= 1000),
  source text not null default 'manual' check (length(source) <= 30),
  stage_id uuid references public.job_stages (id) on delete set null,
  contact text not null default '' check (length(contact) <= 120),
  cv_variant text not null default '' check (length(cv_variant) <= 80),
  notes text not null default '' check (length(notes) <= 4000),
  next_step text not null default '' check (length(next_step) <= 120),
  next_on date,
  applied_on date,
  pos int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_stage_idx on public.jobs (stage_id, pos);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('added', 'stage')),
  text text not null default '' check (length(text) <= 200)
);
create index if not exists job_events_job_idx on public.job_events (job_id, at desc);

alter table public.job_stages enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;

-- first use: the default pipeline
create or replace function public.job_seed_do() returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform pg_advisory_xact_lock(26001);
  if exists (select 1 from public.job_stages) then return; end if;
  insert into public.job_stages (name, color, kind, follow_days, pos) values
    ('Saved', 'sand', 'active', null, 0), ('Applied', 'clay', 'active', 7, 1), ('Screening', 'ochre', 'active', null, 2),
    ('Interview', 'sage', 'active', null, 3), ('Offer', 'moss', 'won', null, 4), ('Closed', 'stone', 'lost', null, 5);
end $$;

create or replace function public.job_list_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare s jsonb; j jsonb;
begin
  perform public.job_seed_do();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb) into s
    from (select id, name, color, kind, follow_days, pos from public.job_stages) x;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.pos, y.updated_at desc), '[]'::jsonb) into j
    from (select id, company, role, location, mode, salary, url, source, stage_id, contact, cv_variant, notes,
                 next_step, next_on, applied_on, pos, created_at, updated_at from public.jobs) y;
  return jsonb_build_object('stages', s, 'jobs', j);
end $$;

create or replace function public.job_get_do(p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare j public.jobs; ev jsonb;
begin
  select * into j from public.jobs where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc), '[]'::jsonb) into ev
    from (select at, kind, text from public.job_events where job_id = p_id order by at desc limit 50) e;
  return jsonb_build_object('job', to_jsonb(j), 'events', ev);
end $$;

-- create (no id) or update (id): only the keys present in p_job are changed
create or replace function public.job_put_do(p_job jsonb, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_id uuid := nullif(p_job->>'id', '')::uuid;
  v_old public.jobs; v_row public.jobs; v_stage uuid; v_first uuid; v_name text;
  v_src text := coalesce(nullif(left(regexp_replace(coalesce(p_source, ''), '[^A-Za-z0-9_ -]', '', 'g'), 30), ''), 'manual');
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform public.job_seed_do();
  select id into v_first from public.job_stages order by pos limit 1;
  if v_id is not null then
    select * into v_old from public.jobs where id = v_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  if p_job ? 'stage_id' then
    v_stage := nullif(p_job->>'stage_id', '')::uuid;
    if v_stage is not null and not exists (select 1 from public.job_stages where id = v_stage) then
      raise exception 'unknown stage' using errcode = '23514';
    end if;
  end if;

  if v_id is null then
    if v_stage is null then v_stage := v_first; end if;
    insert into public.jobs (company, role, location, mode, salary, url, source, stage_id, contact, cv_variant, notes,
                             next_step, next_on, applied_on, pos)
    values (
      left(coalesce(p_job->>'company', ''), 120), left(coalesce(p_job->>'role', ''), 160),
      left(coalesce(p_job->>'location', ''), 120),
      case when p_job->>'mode' in ('remote', 'hybrid', 'onsite') then p_job->>'mode' else '' end,
      left(coalesce(p_job->>'salary', ''), 60),
      case when p_job->>'url' ~* '^https?://\S+$' then left(p_job->>'url', 1000) else '' end,
      v_src, v_stage, left(coalesce(p_job->>'contact', ''), 120), left(coalesce(p_job->>'cv_variant', ''), 80),
      left(coalesce(p_job->>'notes', ''), 4000), left(coalesce(p_job->>'next_step', ''), 120),
      nullif(p_job->>'next_on', '')::date,
      case when v_stage is distinct from v_first then v_today else nullif(p_job->>'applied_on', '')::date end,
      coalesce((select min(pos) from public.jobs where stage_id = v_stage), 1) - 1)
    returning * into v_row;
    select name into v_name from public.job_stages where id = v_stage;
    insert into public.job_events (job_id, kind, text) values (v_row.id, 'added', coalesce(v_name, '') || ' · ' || v_src);
  else
    update public.jobs set
      company = case when p_job ? 'company' then left(coalesce(p_job->>'company', ''), 120) else company end,
      role = case when p_job ? 'role' then left(coalesce(p_job->>'role', ''), 160) else role end,
      location = case when p_job ? 'location' then left(coalesce(p_job->>'location', ''), 120) else location end,
      mode = case when p_job ? 'mode' then (case when p_job->>'mode' in ('remote', 'hybrid', 'onsite') then p_job->>'mode' else '' end) else mode end,
      salary = case when p_job ? 'salary' then left(coalesce(p_job->>'salary', ''), 60) else salary end,
      url = case when p_job ? 'url' then (case when p_job->>'url' ~* '^https?://\S+$' then left(p_job->>'url', 1000) else '' end) else url end,
      contact = case when p_job ? 'contact' then left(coalesce(p_job->>'contact', ''), 120) else contact end,
      cv_variant = case when p_job ? 'cv_variant' then left(coalesce(p_job->>'cv_variant', ''), 80) else cv_variant end,
      notes = case when p_job ? 'notes' then left(coalesce(p_job->>'notes', ''), 4000) else notes end,
      next_step = case when p_job ? 'next_step' then left(coalesce(p_job->>'next_step', ''), 120) else next_step end,
      next_on = case when p_job ? 'next_on' then nullif(p_job->>'next_on', '')::date else next_on end,
      applied_on = case when p_job ? 'applied_on' then nullif(p_job->>'applied_on', '')::date
                        when v_stage is not null and v_stage is distinct from v_old.stage_id and v_stage is distinct from v_first and v_old.applied_on is null then v_today
                        else applied_on end,
      stage_id = case when v_stage is not null then v_stage else stage_id end,
      pos = case when v_stage is not null and v_stage is distinct from v_old.stage_id
                 then coalesce((select min(pos) from public.jobs where stage_id = v_stage), 1) - 1 else pos end,
      updated_at = now()
    where id = v_id returning * into v_row;
    if v_stage is not null and v_stage is distinct from v_old.stage_id then
      select name into v_name from public.job_stages where id = v_stage;
      insert into public.job_events (job_id, kind, text) values (v_id, 'stage', coalesce(v_name, ''));
    end if;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.job_del_do(p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  delete from public.jobs where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- replace the whole stage list (order = array order). Stages left out are removed; their jobs move to the stage before.
create or replace function public.job_stages_put_do(p_stages jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  r jsonb; rm record; i int := 0; v_id uuid; v_name text; v_color text; v_kind text; v_fd int;
  incoming uuid[] := '{}'; keep uuid[] := '{}'; tgt uuid; first_id uuid;
begin
  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) not between 1 and 12 then
    raise exception 'bad stages' using errcode = '23514';
  end if;
  perform public.job_seed_do();
  perform pg_advisory_xact_lock(26001);
  for r in select value from jsonb_array_elements(p_stages) loop
    v_id := nullif(r->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.job_stages where id = v_id) then incoming := incoming || v_id; end if;
  end loop;
  -- removed stages: jobs go to the nearest remaining stage before it, else the first remaining one
  for rm in select id, pos from public.job_stages where not (id = any(incoming)) order by pos loop
    select id into tgt from public.job_stages where id = any(incoming) and pos < rm.pos order by pos desc limit 1;
    if tgt is null then select id into tgt from public.job_stages where id = any(incoming) order by pos limit 1; end if;
    update public.jobs set stage_id = tgt, updated_at = now() where stage_id = rm.id;
    delete from public.job_stages where id = rm.id;
  end loop;
  for r in select value from jsonb_array_elements(p_stages) loop
    v_name := btrim(coalesce(r->>'name', ''));
    if v_name = '' or length(v_name) > 40 then raise exception 'bad name' using errcode = '23514'; end if;
    v_color := case when r->>'color' in ('sand','clay','ochre','sage','moss','stone','rose','slate') then r->>'color' else 'sand' end;
    v_kind := case when r->>'kind' in ('active', 'won', 'lost') then r->>'kind' else 'active' end;
    v_fd := case when (r->>'follow_days') ~ '^\d{1,2}$' and (r->>'follow_days')::int between 1 and 60 then (r->>'follow_days')::int else null end;
    v_id := nullif(r->>'id', '')::uuid;
    if v_id is not null and v_id = any(incoming) then
      update public.job_stages set name = v_name, color = v_color, kind = v_kind, follow_days = v_fd, pos = i where id = v_id;
    else
      insert into public.job_stages (name, color, kind, follow_days, pos) values (v_name, v_color, v_kind, v_fd, i) returning id into v_id;
    end if;
    keep := keep || v_id; i := i + 1;
  end loop;
  select id into first_id from public.job_stages order by pos limit 1;
  update public.jobs set stage_id = first_id where stage_id is null;
  return public.job_list_do();
end $$;

-- public wrappers: token first
create or replace function public.job_list(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_list_do(); end $$;
create or replace function public.job_get(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_get_do(p_id); end $$;
create or replace function public.job_put(p_token text, p_job jsonb, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_put_do(p_job, p_source); end $$;
create or replace function public.job_del(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_del_do(p_id); end $$;
create or replace function public.job_stages_put(p_token text, p_stages jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_stages_put_do(p_stages); end $$;

revoke all on function public.job_seed_do() from public, anon, authenticated;
revoke all on function public.job_list_do() from public, anon, authenticated;
revoke all on function public.job_get_do(uuid) from public, anon, authenticated;
revoke all on function public.job_put_do(jsonb, text) from public, anon, authenticated;
revoke all on function public.job_del_do(uuid) from public, anon, authenticated;
revoke all on function public.job_stages_put_do(jsonb) from public, anon, authenticated;
revoke all on function public.job_list(text) from public, anon, authenticated;
revoke all on function public.job_get(text, uuid) from public, anon, authenticated;
revoke all on function public.job_put(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.job_del(text, uuid) from public, anon, authenticated;
revoke all on function public.job_stages_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.job_list(text) to anon;
grant execute on function public.job_get(text, uuid) to anon;
grant execute on function public.job_put(text, jsonb, text) to anon;
grant execute on function public.job_del(text, uuid) to anon;
grant execute on function public.job_stages_put(text, jsonb) to anon;
