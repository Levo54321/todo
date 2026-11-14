-- To-do v27: Jobs step 2 (analytics + to-do links). Changes to jobs only (new columns) and new job_* functions.
-- No change to todos, todo_check, any other table, any shop_* object or any config key. Safe to run twice.
--   jobs.next_at     optional time (HH:MM) for the next step, so the linked to-do gets a reminder time
--   jobs.next_todo   id of the to-do made for the next step      (the API creates, updates and removes it)
--   jobs.follow_todo id of the "follow up" to-do made when a job entered a stage with follow_days
-- job_put_do now also accepts next_at and returns prev_stage (the stage before this call; null on create) so the API
-- knows a move happened. job_link_do stores the two to-do ids without touching updated_at. job_events_all_do feeds analytics.

alter table public.jobs add column if not exists next_at text not null default '' check (next_at = '' or next_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.jobs add column if not exists next_todo uuid;
alter table public.jobs add column if not exists follow_todo uuid;

create or replace function public.job_list_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare s jsonb; j jsonb;
begin
  perform public.job_seed_do();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb) into s
    from (select id, name, color, kind, follow_days, pos from public.job_stages) x;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.pos, y.updated_at desc), '[]'::jsonb) into j
    from (select id, company, role, location, mode, salary, url, source, stage_id, contact, cv_variant, notes,
                 next_step, next_on, next_at, applied_on, pos, created_at, updated_at from public.jobs) y;
  return jsonb_build_object('stages', s, 'jobs', j);
end $$;

create or replace function public.job_put_do(p_job jsonb, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_id uuid := nullif(p_job->>'id', '')::uuid;
  v_old public.jobs; v_row public.jobs; v_prev uuid; v_at text; v_stage uuid; v_first uuid; v_name text;
  v_src text := coalesce(nullif(left(regexp_replace(coalesce(p_source, ''), '[^A-Za-z0-9_ -]', '', 'g'), 30), ''), 'manual');
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform public.job_seed_do();
  select id into v_first from public.job_stages order by pos limit 1;
  if v_id is not null then
    select * into v_old from public.jobs where id = v_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    v_prev := v_old.stage_id;
  end if;
  if p_job ? 'next_at' then
    v_at := coalesce(p_job->>'next_at', '');
    if v_at <> '' and v_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'bad time' using errcode = '23514'; end if;
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
                             next_step, next_on, next_at, applied_on, pos)
    values (
      left(coalesce(p_job->>'company', ''), 120), left(coalesce(p_job->>'role', ''), 160),
      left(coalesce(p_job->>'location', ''), 120),
      case when p_job->>'mode' in ('remote', 'hybrid', 'onsite') then p_job->>'mode' else '' end,
      left(coalesce(p_job->>'salary', ''), 60),
      case when p_job->>'url' ~* '^https?://\S+$' then left(p_job->>'url', 1000) else '' end,
      v_src, v_stage, left(coalesce(p_job->>'contact', ''), 120), left(coalesce(p_job->>'cv_variant', ''), 80),
      left(coalesce(p_job->>'notes', ''), 4000), left(coalesce(p_job->>'next_step', ''), 120),
      nullif(p_job->>'next_on', '')::date, coalesce(v_at, ''),
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
      next_at = case when p_job ? 'next_at' then v_at else next_at end,
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
  return to_jsonb(v_row) || jsonb_build_object('prev_stage', v_prev);
end $$;

create or replace function public.job_link_do(p_id uuid, p_next uuid, p_follow uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_row public.jobs;
begin
  update public.jobs set next_todo = p_next, follow_todo = p_follow where id = p_id returning * into v_row;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.job_events_all_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('job_id', job_id, 'at', at, 'kind', kind, 'text', text) order by at)
                     from public.job_events), '[]'::jsonb);
end $$;

create or replace function public.job_link(p_token text, p_id uuid, p_next uuid, p_follow uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_link_do(p_id, p_next, p_follow); end $$;
create or replace function public.job_events_all(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_events_all_do(); end $$;

revoke all on function public.job_link_do(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.job_events_all_do() from public, anon, authenticated;
revoke all on function public.job_link(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.job_events_all(text) from public, anon, authenticated;
grant execute on function public.job_link(text, uuid, uuid, uuid) to anon;
grant execute on function public.job_events_all(text) to anon;
