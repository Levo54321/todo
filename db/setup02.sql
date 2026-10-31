-- Desk To-Do v2: focus, repeat, review support. Safe to re-run.
alter table public.todos
  add column if not exists focus_date date,
  add column if not exists recur text check (recur is null or recur in ('daily','weekdays','weekly','fortnightly','monthly','yearly')),
  add column if not exists successor_id uuid references public.todos(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create or replace function public.todo_next_date(p_base date, p_recur text, p_today date)
returns date language plpgsql immutable set search_path = '' as $$
declare d date := p_base;
begin
  loop
    d := case p_recur
      when 'daily' then d + 1
      when 'weekdays' then case extract(isodow from d)::int when 5 then d + 3 when 6 then d + 2 else d + 1 end
      when 'weekly' then d + 7
      when 'fortnightly' then d + 14
      when 'monthly' then (d + interval '1 month')::date
      when 'yearly' then (d + interval '1 year')::date
      else d + 1 end;
    exit when d > p_today;
  end loop;
  return d;
end $$;
revoke all on function public.todo_next_date(date, text, date) from public, anon, authenticated;

drop function if exists public.todo_add(text, text, date, text);
create or replace function public.todo_add(
  p_token text, p_title text, p_due date default null, p_category text default null, p_recur text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.todos;
begin
  perform public.todo_check(p_token);
  insert into public.todos (title, due_date, category, recur)
  values (left(btrim(coalesce(p_title, '')), 500), p_due, nullif(btrim(coalesce(p_category, '')), ''), nullif(btrim(coalesce(p_recur, '')), ''))
  returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.todo_add(text, text, date, text, text) from public, anon, authenticated;
grant execute on function public.todo_add(text, text, date, text, text) to anon;

create or replace function public.todo_update(p_token text, p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.todos; old public.todos; nxt public.todos; n int;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform public.todo_check(p_token);
  select * into old from public.todos where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;

  if p_patch ? 'focus' and coalesce((p_patch->>'focus')::boolean, false) and old.focus_date is distinct from v_today then
    select count(*) into n from public.todos where focus_date = v_today and done = false and id <> p_id;
    if n >= 3 then raise exception 'focus full' using errcode = '23514'; end if;
  end if;

  update public.todos set
    title = case when p_patch ? 'title' then left(btrim(coalesce(p_patch->>'title', '')), 500) else title end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch->>'category', '')), '') else category end,
    recur = case when p_patch ? 'recur' then nullif(btrim(coalesce(p_patch->>'recur', '')), '') else recur end,
    focus_date = case when p_patch ? 'focus' then (case when coalesce((p_patch->>'focus')::boolean, false) then v_today else null end) else focus_date end,
    reviewed_at = case when p_patch ? 'reviewed' then now() else reviewed_at end,
    done = case when p_patch ? 'done' then coalesce((p_patch->>'done')::boolean, false) else done end,
    done_at = case
      when p_patch ? 'done' then (case when coalesce((p_patch->>'done')::boolean, false) then now() else null end)
      else done_at end
  where id = p_id
  returning * into r;

  if p_patch ? 'done' then
    if r.done and not old.done and r.recur is not null and r.successor_id is null then
      insert into public.todos (title, due_date, category, recur)
      values (r.title, public.todo_next_date(coalesce(r.due_date, v_today), r.recur, v_today), r.category, r.recur)
      returning * into nxt;
      update public.todos set successor_id = nxt.id where id = r.id returning * into r;
    elsif not r.done and old.done and r.successor_id is not null then
      delete from public.todos where id = r.successor_id and done = false;
      select * into r from public.todos where id = p_id;
    end if;
  end if;
  return to_jsonb(r);
end $$;
