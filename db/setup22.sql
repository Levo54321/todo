-- To-do v22: keep a clean copy of each CSV import so it can be downloaded or copied again later (v1062).
-- Only touches the new todo_imports table (setup21): one nullable column + two RPCs; the list RPC also reports has_csv.
alter table public.todo_imports add column if not exists csv text check (csv is null or length(csv) <= 600000);

create or replace function public.todo_import_csv_set(p_token text, p_batch uuid, p_csv text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  update public.todo_imports set csv = p_csv where id = p_batch and csv is null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.todo_import_csv_get(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  perform public.todo_check(p_token);
  select jsonb_build_object('name', name, 'csv', csv) into r from public.todo_imports where id = p_id;
  if r is null then raise exception 'no such import' using errcode = 'P0002'; end if;
  return r;
end $$;

create or replace function public.todo_import_list(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  perform public.todo_check(p_token);
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into r from (
    select i.id, i.name, i.n, i.created_at, i.undone_at, i.undone_n, (i.csv is not null) as has_csv,
           (select count(*) from public.todos t where t.id = any(i.ids))::int as alive
    from public.todo_imports i order by i.created_at desc limit 30
  ) x;
  return r;
end $$;

revoke all on function public.todo_import_csv_set(text, uuid, text) from public, anon, authenticated;
revoke all on function public.todo_import_csv_get(text, uuid) from public, anon, authenticated;
grant execute on function public.todo_import_csv_set(text, uuid, text) to anon;
grant execute on function public.todo_import_csv_get(text, uuid) to anon;
