-- v30: Jobs richer cards. Changes to job_* objects only (no shop_*, no todos, no config keys). Safe to run twice.
--   jobs.details / job_leads.details: jsonb bag for everything a posting tells us beyond the basics
--   (description, contract, job_type, salary_type, posted, expires, applicants, apply_url, ai{summary,requirements,nice_to_have,skills}).
--   job_leads_list_do returns a light "meta" (details without the description) + has_desc; the full text is fetched one lead at a time.
--   job_leads_add_do stores details given by the feed; saving a lead copies its details to the new job.

alter table public.jobs add column if not exists details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 60000);
alter table public.job_leads add column if not exists details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 60000);

create or replace function public.job_leads_list_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.fit desc nulls last, x.created_at desc)
    from (select id, source, role, company, location, mode, url, fit, why, salary, created_at,
                 (details - 'description') as meta, (details ? 'description') as has_desc
          from public.job_leads where state = 'new' order by fit desc nulls last, created_at desc limit 100) x), '[]'::jsonb);
end $$;

create or replace function public.job_lead_get_do(p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare l public.job_leads;
begin
  select * into l from public.job_leads where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return to_jsonb(l);
end $$;

create or replace function public.job_lead_details_set_do(p_id uuid, p_details jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare l public.job_leads;
begin
  if jsonb_typeof(p_details) <> 'object' then raise exception 'bad details' using errcode = '23514'; end if;
  update public.job_leads set details = details || p_details where id = p_id returning * into l;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return to_jsonb(l);
end $$;

create or replace function public.job_details_set_do(p_id uuid, p_details jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare j public.jobs;
begin
  if jsonb_typeof(p_details) <> 'object' then raise exception 'bad details' using errcode = '23514'; end if;
  update public.jobs set details = details || p_details where id = p_id returning * into j;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('details', j.details);
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
    insert into public.job_leads (source, role, company, location, mode, url, fit, why, salary, details)
    values (v_src, left(coalesce(r->>'role', ''), 160), left(coalesce(r->>'company', ''), 120), left(coalesce(r->>'location', ''), 120),
            case when r->>'mode' in ('remote', 'hybrid', 'onsite') then r->>'mode' else '' end, v_url,
            case when (r->>'fit') ~ '^[0-9]{1,3}$' and (r->>'fit')::int <= 100 then (r->>'fit')::smallint else null end,
            left(coalesce(r->>'why', ''), 300), left(coalesce(r->>'salary', ''), 60),
            case when jsonb_typeof(r->'details') = 'object' and pg_column_size(r->'details') < 4000 then r->'details' else '{}'::jsonb end);
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
      return jsonb_build_object('job', (select to_jsonb(j) - 'details' from public.jobs j where j.id = l.job_id), 'lead_id', p_id, 'again', true);
    end if;
    v_job := public.job_put_do(jsonb_build_object('role', l.role, 'company', l.company, 'location', l.location, 'mode', l.mode, 'url', l.url, 'salary', l.salary), l.source);
    if l.details <> '{}'::jsonb then update public.jobs set details = l.details where id = (v_job->>'id')::uuid; end if;
    update public.job_leads set state = 'saved', job_id = (v_job->>'id')::uuid where id = p_id;
    return jsonb_build_object('job', v_job - 'details', 'lead_id', p_id);
  end if;
  raise exception 'bad action' using errcode = '23514';
end $$;

create or replace function public.job_lead_get(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_lead_get_do(p_id); end $$;
create or replace function public.job_lead_details_set(p_token text, p_id uuid, p_details jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_lead_details_set_do(p_id, p_details); end $$;
create or replace function public.job_details_set(p_token text, p_id uuid, p_details jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_details_set_do(p_id, p_details); end $$;

revoke all on function public.job_lead_get_do(uuid) from public, anon, authenticated;
revoke all on function public.job_lead_details_set_do(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.job_details_set_do(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.job_lead_get(text, uuid) from public, anon, authenticated;
revoke all on function public.job_lead_details_set(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.job_details_set(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.job_lead_get(text, uuid) to anon;
grant execute on function public.job_lead_details_set(text, uuid, jsonb) to anon;
grant execute on function public.job_details_set(text, uuid, jsonb) to anon;
