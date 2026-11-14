-- To-do v29: Jobs step 4 (Reed feed into Discover, fit score from Luc's skills). Changes to job_* objects only.
-- No change to todos, todo_check, other tables, any shop_* object or any config key. Safe to run twice.
--   job_leads gains fit (0-100, null when unknown), why (matched skills, text), salary (text, carried to the job on Save)
--   job_feed_cfg: one row (id 1): keywords to search, skills for the fit score, last run info
--   job_feed_get/job_feed_put/job_feed_ran (token-checked wrappers); job_leads_add_do now takes fit/why/salary; job_leads_list_do sorts best fit first.

alter table public.job_leads add column if not exists fit smallint check (fit between 0 and 100);
alter table public.job_leads add column if not exists why text not null default '' check (length(why) <= 300);
alter table public.job_leads add column if not exists salary text not null default '' check (length(salary) <= 60);

create table if not exists public.job_feed_cfg (
  id int primary key default 1 check (id = 1),
  keywords jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  last_run timestamptz,
  last_added int not null default 0,
  last_err text not null default '' check (length(last_err) <= 200)
);
alter table public.job_feed_cfg enable row level security;

create or replace function public.job_feed_get_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r public.job_feed_cfg;
begin
  insert into public.job_feed_cfg (id, keywords, skills) values (1,
    '["AI data operations","human data operations","AI operations manager","technical program manager AI","AI delivery lead","LLM evaluation"]'::jsonb,
    '["RLHF","red teaming","LLM","human-in-the-loop","data annotation","annotation","evaluation","quality assurance","program management","programme management","delivery","stakeholder","SLA","vendor management","AI operations","data operations","machine learning","workflow","operations","enterprise clients"]'::jsonb)
  on conflict (id) do nothing;
  select * into r from public.job_feed_cfg where id = 1;
  return to_jsonb(r);
end $$;

-- p_cfg: {keywords:[text], skills:[text]}; each list trimmed, max 10 keywords / 40 skills of up to 60 characters
create or replace function public.job_feed_put_do(p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare k jsonb; s jsonb;
begin
  perform public.job_feed_get_do();
  if jsonb_typeof(p_cfg->'keywords') <> 'array' or jsonb_typeof(p_cfg->'skills') <> 'array' then raise exception 'bad config' using errcode = '23514'; end if;
  select coalesce(jsonb_agg(v), '[]'::jsonb) into k from (select distinct left(btrim(value #>> '{}'), 60) v from jsonb_array_elements(p_cfg->'keywords') where btrim(value #>> '{}') <> '' limit 10) x;
  select coalesce(jsonb_agg(v), '[]'::jsonb) into s from (select distinct left(btrim(value #>> '{}'), 60) v from jsonb_array_elements(p_cfg->'skills') where btrim(value #>> '{}') <> '' limit 40) x;
  update public.job_feed_cfg set keywords = k, skills = s where id = 1;
  return public.job_feed_get_do();
end $$;

create or replace function public.job_feed_ran_do(p_added int, p_err text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  perform public.job_feed_get_do();
  update public.job_feed_cfg set last_run = now(), last_added = coalesce(p_added, 0), last_err = left(coalesce(p_err, ''), 200) where id = 1;
  return public.job_feed_get_do();
end $$;

create or replace function public.job_leads_list_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.fit desc nulls last, x.created_at desc)
    from (select id, source, role, company, location, mode, url, fit, why, salary, created_at from public.job_leads
          where state = 'new' order by fit desc nulls last, created_at desc limit 100) x), '[]'::jsonb);
end $$;

create or replace function public.job_leads_add_do(p_leads jsonb, p_source text default 'linkedin') returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r jsonb; v_url text; v_added int := 0; v_skipped int := 0;
  v_src text := coalesce(nullif(left(regexp_replace(coalesce(p_source, ''), '[^A-Za-z0-9_ -]', '', 'g'), 30), ''), 'linkedin');
begin
  if jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) > 200 then raise exception 'bad leads' using errcode = '23514'; end if;
  delete from public.job_leads where (state = 'new' and created_at < now() - interval '45 days') or (state <> 'new' and created_at < now() - interval '90 days');
  for r in select value from jsonb_array_elements(p_leads) loop
    v_url := case when r->>'url' ~* '^https?://\S+$' then left(r->>'url', 1000) else '' end;
    if (coalesce(r->>'role', '') = '' and coalesce(r->>'company', '') = '')
       or (v_url <> '' and (exists (select 1 from public.job_leads where url = v_url) or exists (select 1 from public.jobs where url = v_url))) then
      v_skipped := v_skipped + 1; continue;
    end if;
    insert into public.job_leads (source, role, company, location, mode, url, fit, why, salary)
    values (v_src, left(coalesce(r->>'role', ''), 160), left(coalesce(r->>'company', ''), 120), left(coalesce(r->>'location', ''), 120),
            case when r->>'mode' in ('remote', 'hybrid', 'onsite') then r->>'mode' else '' end, v_url,
            case when (r->>'fit') ~ '^[0-9]{1,3}$' and (r->>'fit')::int <= 100 then (r->>'fit')::smallint else null end,
            left(coalesce(r->>'why', ''), 300), left(coalesce(r->>'salary', ''), 60));
    v_added := v_added + 1;
  end loop;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;

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
    v_job := public.job_put_do(jsonb_build_object('role', l.role, 'company', l.company, 'location', l.location, 'mode', l.mode, 'url', l.url, 'salary', l.salary), l.source);
    update public.job_leads set state = 'saved', job_id = (v_job->>'id')::uuid where id = p_id;
    return jsonb_build_object('job', v_job, 'lead_id', p_id);
  end if;
  raise exception 'bad action' using errcode = '23514';
end $$;

create or replace function public.job_feed_get(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_feed_get_do(); end $$;
create or replace function public.job_feed_put(p_token text, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_feed_put_do(p_cfg); end $$;
create or replace function public.job_feed_ran(p_token text, p_added int, p_err text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_feed_ran_do(p_added, p_err); end $$;

revoke all on function public.job_feed_get_do() from public, anon, authenticated;
revoke all on function public.job_feed_put_do(jsonb) from public, anon, authenticated;
revoke all on function public.job_feed_ran_do(int, text) from public, anon, authenticated;
revoke all on function public.job_feed_get(text) from public, anon, authenticated;
revoke all on function public.job_feed_put(text, jsonb) from public, anon, authenticated;
revoke all on function public.job_feed_ran(text, int, text) from public, anon, authenticated;
grant execute on function public.job_feed_get(text) to anon;
grant execute on function public.job_feed_put(text, jsonb) to anon;
grant execute on function public.job_feed_ran(text, int, text) to anon;
