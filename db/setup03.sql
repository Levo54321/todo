-- Desk To-Do v3: session checklists + settings. Safe to re-run.
alter table public.todos
  add column if not exists is_session boolean not null default false,
  add column if not exists items jsonb not null default '[]'::jsonb;

drop function if exists public.todo_add(text, text, date, text, text);
create or replace function public.todo_add(
  p_token text, p_title text, p_due date default null, p_category text default null,
  p_recur text default null, p_session boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.todos;
begin
  perform public.todo_check(p_token);
  insert into public.todos (title, due_date, category, recur, is_session)
  values (left(btrim(coalesce(p_title, '')), 500), p_due, nullif(btrim(coalesce(p_category, '')), ''),
          nullif(btrim(coalesce(p_recur, '')), ''), coalesce(p_session, false))
  returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.todo_add(text, text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.todo_add(text, text, date, text, text, boolean) to anon;

create or replace function public.todo_update(p_token text, p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.todos; old public.todos; nxt public.todos; n int;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform public.todo_check(p_token);
  select * into old from public.todos where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;

  if p_patch ? 'items' and (jsonb_typeof(p_patch->'items') <> 'array' or jsonb_array_length(p_patch->'items') > 100) then
    raise exception 'bad items' using errcode = '23514';
  end if;

  if p_patch ? 'focus' and coalesce((p_patch->>'focus')::boolean, false) and old.focus_date is distinct from v_today then
    select count(*) into n from public.todos where focus_date = v_today and done = false and id <> p_id;
    if n >= 3 then raise exception 'focus full' using errcode = '23514'; end if;
  end if;

  update public.todos set
    title = case when p_patch ? 'title' then left(btrim(coalesce(p_patch->>'title', '')), 500) else title end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch->>'category', '')), '') else category end,
    recur = case when p_patch ? 'recur' then nullif(btrim(coalesce(p_patch->>'recur', '')), '') else recur end,
    is_session = case when p_patch ? 'is_session' then coalesce((p_patch->>'is_session')::boolean, false) else is_session end,
    items = case when p_patch ? 'items' then p_patch->'items' else items end,
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
      insert into public.todos (title, due_date, category, recur, is_session, items)
      values (r.title, public.todo_next_date(coalesce(r.due_date, v_today), r.recur, v_today), r.category, r.recur, r.is_session,
              (select coalesce(jsonb_agg(jsonb_build_object('t', e->>'t', 'd', false)), '[]'::jsonb) from jsonb_array_elements(r.items) e))
      returning * into nxt;
      update public.todos set successor_id = nxt.id where id = r.id returning * into r;
    elsif not r.done and old.done and r.successor_id is not null then
      delete from public.todos where id = r.successor_id and done = false;
      select * into r from public.todos where id = p_id;
    end if;
  end if;
  return to_jsonb(r);
end $$;

-- Settings (city, units, calendar link, ...) live in app_config, reachable only with the token.
create or replace function public.todo_settings_get(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((select value::jsonb from public.app_config where key = 'settings'), '{}'::jsonb);
end $$;

create or replace function public.todo_settings_set(p_token text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; nxt jsonb;
begin
  perform public.todo_check(p_token);
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'bad settings' using errcode = '23514'; end if;
  select coalesce(value::jsonb, '{}'::jsonb) into cur from public.app_config where key = 'settings';
  nxt := jsonb_strip_nulls(coalesce(cur, '{}'::jsonb) || p_patch);
  if length(nxt::text) > 4000 then raise exception 'settings too large' using errcode = '23514'; end if;
  insert into public.app_config (key, value) values ('settings', nxt::text)
  on conflict (key) do update set value = excluded.value;
  return nxt;
end $$;
revoke all on function public.todo_settings_get(text) from public, anon, authenticated;
revoke all on function public.todo_settings_set(text, jsonb) from public, anon, authenticated;
grant execute on function public.todo_settings_get(text) to anon;
grant execute on function public.todo_settings_set(text, jsonb) to anon;
