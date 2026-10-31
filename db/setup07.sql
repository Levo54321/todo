-- Desk To-Do v7: task Notes + Shopping List (Beta).
-- Paste the WHOLE file into Supabase > SQL Editor and click Run. Safe to run more than once.

alter table public.todos add column if not exists notes text;

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
    select count(*) into n from public.todos where focus_date = v_today and done = false and id <> p_id and list = old.list;
    if n >= 3 then raise exception 'focus full' using errcode = '23514'; end if;
  end if;

  update public.todos set
    title = case when p_patch ? 'title' then left(btrim(coalesce(p_patch->>'title', '')), 500) else title end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch->>'category', '')), '') else category end,
    recur = case when p_patch ? 'recur' then nullif(btrim(coalesce(p_patch->>'recur', '')), '') else recur end,
    remind_time = case when p_patch ? 'remind_time' then nullif(btrim(coalesce(p_patch->>'remind_time', '')), '')::time else remind_time end,
    list = case when p_patch ? 'list' and (p_patch->>'list') in ('personal', 'work') then p_patch->>'list' else list end,
    is_session = case when p_patch ? 'is_session' then coalesce((p_patch->>'is_session')::boolean, false) else is_session end,
    items = case when p_patch ? 'items' then p_patch->'items' else items end,
    notes = case when p_patch ? 'notes' then nullif(left(btrim(coalesce(p_patch->>'notes', '')), 2000), '') else notes end,
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
      insert into public.todos (title, due_date, category, recur, is_session, items, remind_time, list, series_id, notes)
      values (r.title, public.todo_next_date(coalesce(r.due_date, v_today), r.recur, v_today), r.category, r.recur, r.is_session,
              (select coalesce(jsonb_agg(jsonb_build_object('t', e->>'t', 'd', false)), '[]'::jsonb) from jsonb_array_elements(r.items) e),
              r.remind_time, r.list, coalesce(r.series_id, r.id), r.notes)
      returning * into nxt;
      update public.todos set successor_id = nxt.id, series_id = coalesce(r.series_id, r.id) where id = r.id returning * into r;
    elsif not r.done and old.done and r.successor_id is not null then
      delete from public.todos where id = r.successor_id and done = false;
      select * into r from public.todos where id = p_id;
    end if;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.todo_update(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.todo_update(text, uuid, jsonb) to anon;

-- Shopping list is stored as one private config entry ('shop'); this lets the app use that key.
create or replace function public.cfg_get(p_token text, p_key text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public.todo_check(p_token);
  if p_key not in ('budget', 'caldav', 'caldav_state', 'saver', 'shop') then raise exception 'bad key' using errcode = '23514'; end if;
  return (select value from public.app_config where key = p_key);
end $$;
create or replace function public.cfg_set(p_token text, p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.todo_check(p_token);
  if p_key not in ('budget', 'caldav', 'caldav_state', 'saver', 'shop') then raise exception 'bad key' using errcode = '23514'; end if;
  if p_value is null then
    delete from public.app_config where key = p_key;
  else
    if length(p_value) > 60000 then raise exception 'too large' using errcode = '23514'; end if;
    insert into public.app_config (key, value) values (p_key, p_value)
      on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cfg_get(text, text) from public, anon, authenticated;
revoke all on function public.cfg_set(text, text, text) from public, anon, authenticated;
grant execute on function public.cfg_get(text, text) to anon;
grant execute on function public.cfg_set(text, text, text) to anon;
