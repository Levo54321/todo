-- v1081 Jobs step 5: career profile (the CV facts Luc enters in the app, used later by Tailor my CV).
-- One row. The CV text itself is NEVER in this repo: it is entered in the app (or pasted from cv_data.json) and lives only in this table.
create table if not exists public.career_profile (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 120000),
  updated_at timestamptz not null default now()
);
alter table public.career_profile enable row level security;

create or replace function public.career_get_do() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r public.career_profile;
begin
  insert into public.career_profile (id) values (1) on conflict (id) do nothing;
  select * into r from public.career_profile where id = 1;
  return jsonb_build_object('data', r.data, 'updated_at', r.updated_at);
end $$;

create or replace function public.career_put_do(p_data jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  if jsonb_typeof(p_data) <> 'object' then raise exception 'bad profile' using errcode = '23514'; end if;
  perform public.career_get_do();
  update public.career_profile set data = p_data, updated_at = now() where id = 1;
  return public.career_get_do();
end $$;

create or replace function public.career_get(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.career_get_do(); end $$;
create or replace function public.career_put(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin perform public.todo_check(p_token); return public.career_put_do(p_data); end $$;

revoke all on function public.career_get_do() from public, anon, authenticated;
revoke all on function public.career_put_do(jsonb) from public, anon, authenticated;
revoke all on function public.career_get(text) from public, anon, authenticated;
revoke all on function public.career_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.career_get(text) to anon;
grant execute on function public.career_put(text, jsonb) to anon;
