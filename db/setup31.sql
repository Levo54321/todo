-- v31: "More like this" learning for Discover. job_* objects only. Safe to run twice.
--   job_leads.vote: 1 = "more like this" was tapped (0 otherwise)
--   job_feed_cfg.learn: {term: weight} learned from likes, saves, dismissals; the API turns it into a small fit boost when leads are listed
alter table public.job_leads add column if not exists vote smallint not null default 0 check (vote between -1 and 1);
alter table public.job_feed_cfg add column if not exists learn jsonb not null default '{}'::jsonb check (jsonb_typeof(learn) = 'object' and pg_column_size(learn) < 20000);

create or replace function public.job_leads_list_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.fit desc nulls last, x.created_at desc)
    from (select id, source, role, company, location, mode, url, fit, why, salary, vote, created_at,
                 (details - 'description') as meta, (details ? 'description') as has_desc
          from public.job_leads where state = 'new' order by fit desc nulls last, created_at desc limit 100) x), '[]'::jsonb);
end $$;

create or replace function public.job_lead_vote_do(p_id uuid, p_vote int) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare l public.job_leads;
begin
  if p_vote not between -1 and 1 then raise exception 'bad vote' using errcode = '23514'; end if;
  update public.job_leads set vote = p_vote where id = p_id returning * into l;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', l.id, 'vote', l.vote);
end $$;

create or replace function public.job_learn_put_do(p_learn jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  if jsonb_typeof(p_learn) <> 'object' then raise exception 'bad learn' using errcode = '23514'; end if;
  perform public.job_feed_get_do();
  update public.job_feed_cfg set learn = p_learn where id = 1;
  return public.job_feed_get_do();
end $$;

create or replace function public.job_lead_vote(p_token text, p_id uuid, p_vote int) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_lead_vote_do(p_id, p_vote); end $$;
create or replace function public.job_learn_put(p_token text, p_learn jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.job_learn_put_do(p_learn); end $$;

revoke all on function public.job_lead_vote_do(uuid, int) from public, anon, authenticated;
revoke all on function public.job_learn_put_do(jsonb) from public, anon, authenticated;
revoke all on function public.job_lead_vote(text, uuid, int) from public, anon, authenticated;
revoke all on function public.job_learn_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.job_lead_vote(text, uuid, int) to anon;
grant execute on function public.job_learn_put(text, jsonb) to anon;
