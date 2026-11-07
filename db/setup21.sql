-- To-do v21: CSV import history with Undo (v1060).
-- One row per import (a "batch"): its name (the file), when, and the ids of the tasks it added. Undo deletes exactly those
-- tasks (whether or not they were ticked or edited since) and marks the batch undone. Touches only the new table todo_imports:
-- no change to todos, todo_add, any shop_* object or any config key. Safe to run more than once.

create table if not exists public.todo_imports (
  id uuid primary key,
  name text not null default '' check (length(name) <= 200),
  n int not null default 0,
  ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_n int
);
alter table public.todo_imports enable row level security;

-- Record (or extend) a batch. The page sends the same batch id with every chunk of one file.
create or replace function public.todo_import_log(p_token text, p_batch uuid, p_name text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  insert into public.todo_imports (id, name, n, ids)
  values (p_batch, left(coalesce(p_name, ''), 200), coalesce(cardinality(p_ids), 0), coalesce(p_ids, '{}'))
  on conflict (id) do update
    set ids = public.todo_imports.ids || excluded.ids,
        n = public.todo_imports.n + excluded.n
    where public.todo_imports.undone_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- Latest 30 imports, newest first, with how many of their tasks still exist.
create or replace function public.todo_import_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  perform public.todo_check(p_token);
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into r from (
    select i.id, i.name, i.n, i.created_at, i.undone_at, i.undone_n,
           (select count(*) from public.todos t where t.id = any(i.ids))::int as alive
    from public.todo_imports i order by i.created_at desc limit 30
  ) x;
  return r;
end $$;

-- Undo one import: delete the tasks it added (those still present), once.
create or replace function public.todo_import_undo(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare b public.todo_imports; k int;
begin
  perform public.todo_check(p_token);
  select * into b from public.todo_imports where id = p_id for update;
  if not found then raise exception 'no such import' using errcode = 'P0002'; end if;
  if b.undone_at is not null then raise exception 'already undone' using errcode = '23505'; end if;
  with d as (delete from public.todos where id = any(b.ids) returning 1) select count(*) into k from d;
  update public.todo_imports set undone_at = now(), undone_n = k where id = p_id;
  return jsonb_build_object('ok', true, 'removed', k, 'added', b.n);
end $$;

revoke all on function public.todo_import_log(text, uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.todo_import_list(text) from public, anon, authenticated;
revoke all on function public.todo_import_undo(text, uuid) from public, anon, authenticated;
grant execute on function public.todo_import_log(text, uuid, text, uuid[]) to anon;
grant execute on function public.todo_import_list(text) to anon;
grant execute on function public.todo_import_undo(text, uuid) to anon;
