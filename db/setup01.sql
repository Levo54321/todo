-- Desk To-Do: token-gated access functions.
-- Paste this whole file into Supabase > SQL Editor (project "todo") and click Run.
-- The `todos` table already exists and is locked down (RLS on, no policies),
-- so the public anon key cannot read or write it directly. These functions are
-- the only way in, and each one requires your secret token (stored as a hash).

create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;

create or replace function public.todo_check(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null
     or encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
        is distinct from (select value from public.app_config where key = 'token_sha256') then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.todo_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.todo_check(p_token);
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.done, t.due_date nulls last, t.created_at)
    from public.todos t
    where t.done = false or t.done_at > now() - interval '7 days'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.todo_add(
  p_token text,
  p_title text,
  p_due date default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.todos;
begin
  perform public.todo_check(p_token);
  insert into public.todos (title, due_date, category)
  values (left(btrim(coalesce(p_title, '')), 500), p_due, nullif(btrim(coalesce(p_category, '')), ''))
  returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.todo_update(p_token text, p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.todos;
begin
  perform public.todo_check(p_token);
  update public.todos set
    title = case when p_patch ? 'title' then left(btrim(coalesce(p_patch->>'title', '')), 500) else title end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch->>'category', '')), '') else category end,
    done = case when p_patch ? 'done' then coalesce((p_patch->>'done')::boolean, false) else done end,
    done_at = case
      when p_patch ? 'done' then (case when coalesce((p_patch->>'done')::boolean, false) then now() else null end)
      else done_at end
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.todo_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.todo_check(p_token);
  delete from public.todos where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.todo_check(text) from public, anon, authenticated;
revoke all on function public.todo_list(text) from public, anon, authenticated;
revoke all on function public.todo_add(text, text, date, text) from public, anon, authenticated;
revoke all on function public.todo_update(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.todo_delete(text, uuid) from public, anon, authenticated;

grant execute on function public.todo_list(text) to anon;
grant execute on function public.todo_add(text, text, date, text) to anon;
grant execute on function public.todo_update(text, uuid, jsonb) to anon;
grant execute on function public.todo_delete(text, uuid) to anon;

-- Your access token, stored as a SHA-256 hash (the token itself is never in the database).
insert into public.app_config (key, value)
values ('token_sha256', 'REPLACE_WITH_SHA256_OF_YOUR_ACCESS_TOKEN')
on conflict (key) do update set value = excluded.value;
