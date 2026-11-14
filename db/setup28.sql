-- To-do v28: Jobs step 3 (Discover leads from LinkedIn alert emails; step 4 will feed Adzuna into the same table).
-- New: table job_leads and functions job_leads_*, job_lead_act*; job_list_do also reports new_leads (count).
-- No change to todos, todo_check, other tables, any shop_* object or any config key. Safe to run twice.
-- A lead = a recommended posting that has NOT been saved yet (state new). Save turns it into a job in the first stage
-- (state saved, job_id set); Dismiss hides it for good (kept 90 days so the same posting is not offered again).
-- Dedupe: a posting whose link is already a lead or already a job is skipped. New leads older than 45 days are dropped.

create table if not exists public.job_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'linkedin' check (length(source) <= 30),
  role text not null default '' check (length(role) <= 160),
  company text not null default '' check (length(company) <= 120),
  location text not null default '' check (length(location) <= 120),
  mode text not null default '' check (mode in ('', 'remote', 'hybrid', 'onsite')),
  url text not null default '' check (length(url) <= 1000),
  state text not null default 'new' check (state in ('new', 'saved', 'dismissed')),
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists job_leads_url_idx on public.job_leads (url) where url <> '';
create index if not exists job_leads_state_idx on public.job_leads (state, created_at desc);
alter table public.job_leads enable row level security;

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
  return jsonb_build_object('stages', s, 'jobs', j, 'new_leads', (select count(*) from public.job_leads where state = 'new'));
end $$;

create or replace function public.job_leads_list_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (select id, source, role, company, location, mode, url, created_at from public.job_leads
          where state = 'new' order by created_at desc limit 100) x), '[]'::jsonb);
end $$;

-- p_leads: [{role, company, location, mode, url}]; returns {added, skipped}
create or replace function public.job_leads_add_do(p_leads jsonb, p_source text default 'linkedin') returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r jsonb; v_url text; v_added int := 0; v_skipped int := 0;
  v_src text := coalesce(nullif(left(regexp_replace(coalesce(p_source, ''), '[^A-Za-z0-9_ -]', '', 'g'), 30), ''), 'linkedin');
begin
  if jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) > 100 then raise exception 'bad leads' using errcode = '23514'; end if;
  delete from public.job_leads where (state = 'new' and created_at < now() - interval '45 days') or (state <> 'new' and created_at < now() - interval '90 days');
  for r in select value from jsonb_array_elements(p_leads) loop
    v_url := case when r->>'url' ~* '^https?://\S+$' then left(r->>'url', 1000) else '' end;
    if (coalesce(r->>'role', '') = '' and coalesce(r->>'company', '') = '')
       or (v_url <> '' and (exists (select 1 from public.job_leads where url = v_url) or exists (select 1 from public.jobs where url = v_url))) then
      v_skipped := v_skipped + 1; continue;
    end if;
    insert into public.job_leads (source, role, company, location, mode, url)
    values (v_src, left(coalesce(r->>'role', ''), 160), left(coalesce(r->>'company', ''), 120), left(coalesce(r->>'location', ''), 120),
            case when r->>'mode' in ('remote', 'hybrid', 'onsite') then r->>'mode' else '' end, v_url);
    v_added := v_added + 1;
  end loop;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;

-- save: becomes a job in the first stage (returns {job, lead_id}); dismiss: hidden for good
create or replace function public.job_lead_act_do(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare l public.job_leads; v_job jsonb;
begin
  select * into l from public.job_leads where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_action = 'dismiss' then
    update public.job_leads set state = 'dismissed' where id = p_id;
    return jsonb_build_object('ok', true, 'lead_id', p_id);
  elsif p_action = 'save' then
    if l.state = 'saved' and l.job_id is not null and exists (select 1 from public.jobs where id = l.job_id) then
      return jsonb_build_object('job', (select to_jsonb(j) from public.jobs j where j.id = l.job_id), 'lead_id', p_id, 'again', true);
    end if;
    v_job := public.job_put_do(jsonb_build_object('role', l.role, 'company', l.company, 'location', l.location, 'mode', l.mode, 'url', l.url), l.source);
    update public.job_leads set state = 'saved', job_id = (v_job->>'id')::uuid where id = p_id;
    return jsonb_build_object('job', v_job, 'lead_id', p_id);
  end if;
  raise exception 'bad action' using errcode = '23514';
end $$;

create or replace function public.job_leads_list(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_leads_list_do(); end $$;
create or replace function public.job_leads_add(p_token text, p_leads jsonb, p_source text default 'linkedin') returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_leads_add_do(p_leads, p_source); end $$;
create or replace function public.job_lead_act(p_token text, p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_lead_act_do(p_id, p_action); end $$;

revoke all on function public.job_leads_list_do() from public, anon, authenticated;
revoke all on function public.job_leads_add_do(jsonb, text) from public, anon, authenticated;
revoke all on function public.job_lead_act_do(uuid, text) from public, anon, authenticated;
revoke all on function public.job_leads_list(text) from public, anon, authenticated;
revoke all on function public.job_leads_add(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.job_lead_act(text, uuid, text) from public, anon, authenticated;
grant execute on function public.job_leads_list(text) to anon;
grant execute on function public.job_leads_add(text, jsonb, text) to anon;
grant execute on function public.job_lead_act(text, uuid, text) to anon;
