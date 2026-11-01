-- To-do v18: My projects Deploy 3 — subscriptions and costs per project.
--  * personal_project_costs: several per project (max 30): name, amount, currency (default GBP), how often (monthly,
--    yearly, one_off), next due date, optional https link and email. Deleted with its project.
--  * pproj_list returns each project's costs (the board flags anything due within 30 days).
--  * pcost_save / pcost_delete; adding, changing and removing a cost is written to the project's activity log.
--  * Separate from the Budget module's bills (those live in the 'budget' config, monthly and GBP only, without ids).
-- Touches no shop_* objects and no config keys. Safe to run more than once.

create table if not exists public.personal_project_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.personal_projects(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  amount numeric(10, 2) not null check (amount >= 0 and amount < 100000000),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  freq text not null default 'monthly' check (freq in ('monthly', 'yearly', 'one_off')),
  next_due date,
  link text check (link is null or (link ~* '^https://' and length(link) <= 300)),
  email text check (email is null or (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 120)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personal_project_costs_proj on public.personal_project_costs (project_id);
alter table public.personal_project_costs enable row level security;

-- "£12.00 yearly" style text for the activity log
create or replace function public.pcost_label(c public.personal_project_costs)
returns text language sql immutable set search_path to '' as $$
  select c.name || ' (' || case c.currency when 'GBP' then '£' when 'EUR' then '€' when 'USD' then '$' else c.currency || ' ' end
    || to_char(c.amount, 'FM999999990.00') || ' ' || replace(c.freq, '_', '-') || ')';
$$;
revoke all on function public.pcost_label(public.personal_project_costs) from public, anon, authenticated;

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
               from public.personal_project_costs c where c.project_id = p.id), '[]'::jsonb))
      order by p.pos, p.created_at)
    from public.personal_projects p
  ), '[]'::jsonb);
end $$;

-- Create (p_id null, p_project required) or update one cost. p_cost: {name, amount, currency, freq, next_due, link, email}.
create or replace function public.pcost_save(p_token text, p_id uuid, p_project uuid, p_cost jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_project_costs; old public.personal_project_costs;
  v_name text := nullif(left(btrim(coalesce(p_cost->>'name', '')), 60), '');
  v_amount numeric; v_cur text := upper(coalesce(nullif(btrim(p_cost->>'currency'), ''), 'GBP'));
  v_freq text := coalesce(nullif(btrim(p_cost->>'freq'), ''), 'monthly');
  v_due date; v_link text := nullif(btrim(coalesce(p_cost->>'link', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_cost->>'email', '')), ''));
begin
  perform public.todo_check(p_token);
  if p_cost is null or jsonb_typeof(p_cost) <> 'object' or v_name is null then raise exception 'name required' using errcode = '23514'; end if;
  begin
    v_amount := round((p_cost->>'amount')::numeric, 2);
    v_due := nullif(btrim(coalesce(p_cost->>'next_due', '')), '')::date;
  exception when others then raise exception 'bad amount or date' using errcode = '23514';
  end;
  if v_amount is null or v_amount < 0 or v_amount >= 100000000 then raise exception 'bad amount' using errcode = '23514'; end if;
  if v_cur !~ '^[A-Z]{3}$' or v_freq not in ('monthly', 'yearly', 'one_off') then raise exception 'bad currency or frequency' using errcode = '23514'; end if;
  if v_link is not null and (v_link !~* '^https://' or length(v_link) > 300) then raise exception 'bad link' using errcode = '23514'; end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120) then raise exception 'bad email' using errcode = '23514'; end if;
  if p_id is null then
    if not exists (select 1 from public.personal_projects where id = p_project) then raise exception 'not found' using errcode = 'P0002'; end if;
    if (select count(*) from public.personal_project_costs where project_id = p_project) >= 30 then raise exception 'too many' using errcode = '23514'; end if;
    insert into public.personal_project_costs (project_id, name, amount, currency, freq, next_due, link, email)
      values (p_project, v_name, v_amount, v_cur, v_freq, v_due, v_link, v_email) returning * into r;
    insert into public.personal_project_events (project_id, kind, text) values (r.project_id, 'cost_added', public.pcost_label(r));
  else
    select * into old from public.personal_project_costs where id = p_id for update;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.personal_project_costs set name = v_name, amount = v_amount, currency = v_cur, freq = v_freq, next_due = v_due,
      link = v_link, email = v_email, updated_at = now() where id = p_id returning * into r;
    if (r.name, r.amount, r.currency, r.freq, r.next_due, r.link, r.email) is distinct from
       (old.name, old.amount, old.currency, old.freq, old.next_due, old.link, old.email) then
      insert into public.personal_project_events (project_id, kind, text) values (r.project_id, 'cost_changed', public.pcost_label(r));
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'project_id', r.project_id, 'name', r.name, 'amount', r.amount, 'currency', r.currency,
    'freq', r.freq, 'next_due', r.next_due, 'link', r.link, 'email', r.email);
end $$;

create or replace function public.pcost_delete(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.personal_project_costs;
begin
  perform public.todo_check(p_token);
  delete from public.personal_project_costs where id = p_id returning * into r;
  if found then insert into public.personal_project_events (project_id, kind, text) values (r.project_id, 'cost_removed', public.pcost_label(r)); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pproj_list(text) from public, anon, authenticated;
revoke all on function public.pcost_save(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pcost_delete(text, uuid) from public, anon, authenticated;
grant execute on function public.pproj_list(text) to anon, service_role;
grant execute on function public.pcost_save(text, uuid, uuid, jsonb) to anon, service_role;
grant execute on function public.pcost_delete(text, uuid) to anon, service_role;
