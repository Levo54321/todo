-- To-do v20: My projects Deploy 4b — secure vault for sensitive values (env vars, codes) per project.
-- The database only ever holds ciphertext. Encryption and decryption happen in api/vault.js (Node crypto,
-- AES-256-GCM); the key comes from the vault password (scrypt) mixed with the server secret VAULT_PEPPER
-- (a Vercel env var that never reaches the database). Neither the password nor the key is stored anywhere.
--  * pvault_lock: one row: scrypt salt + parameters, a check blob (proves a password is right), failed-attempt
--    counter and lockout time.
--  * pvault_entries: per project; name and value are each encrypted (bound to the project and entry id).
--  * No activity events, no logging. Deleted with the project. Forgotten password = reset (deletes everything).
-- Touches no shop_* objects and no config keys. Separate from every shop_* object. Safe to run more than once.

create table if not exists public.pvault_lock (
  id int primary key default 1 check (id = 1),
  salt text not null check (length(salt) between 16 and 200),
  kdf text not null check (length(kdf) <= 60),
  check_blob text not null check (length(check_blob) <= 400),
  fails int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pvault_lock enable row level security;

create table if not exists public.pvault_entries (
  id uuid primary key,
  project_id uuid not null references public.personal_projects(id) on delete cascade,
  name_blob text not null check (length(name_blob) <= 1000),
  value_blob text not null check (length(value_blob) <= 16000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pvault_entries_proj on public.pvault_entries (project_id, created_at);
alter table public.pvault_entries enable row level security;

-- Vault state for the API (salt and check blob are needed to test a password; they reveal nothing on their own).
create or replace function public.pvault_state(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.pvault_lock;
begin
  perform public.todo_check(p_token);
  select * into r from public.pvault_lock where id = 1;
  if not found then return jsonb_build_object('set', false); end if;
  return jsonb_build_object('set', true, 'salt', r.salt, 'kdf', r.kdf, 'check', r.check_blob, 'fails', r.fails,
    'locked', r.locked_until is not null and r.locked_until > now(), 'until', r.locked_until);
end $$;

-- First-time setup only.
create or replace function public.pvault_setup(p_token text, p_salt text, p_kdf text, p_check text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  if exists (select 1 from public.pvault_lock) then raise exception 'vault already set up' using errcode = '23505'; end if;
  insert into public.pvault_lock (id, salt, kdf, check_blob) values (1, p_salt, p_kdf, p_check);
  return jsonb_build_object('ok', true);
end $$;

-- Record a password attempt. 5 wrong in a row locks the vault for 5 minutes (then each further miss locks again).
create or replace function public.pvault_attempt(p_token text, p_ok boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.pvault_lock;
begin
  perform public.todo_check(p_token);
  if p_ok then
    update public.pvault_lock set fails = 0, locked_until = null where id = 1 returning * into r;
  else
    update public.pvault_lock set fails = fails + 1,
      locked_until = case when fails + 1 >= 5 then now() + interval '5 minutes' else locked_until end
      where id = 1 returning * into r;
  end if;
  return jsonb_build_object('fails', coalesce(r.fails, 0), 'until', r.locked_until);
end $$;

-- Entry list for one project: ids and encrypted names only (never values).
create or replace function public.pvault_list(p_token text, p_project uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name_blob) order by e.created_at, e.id)
    from public.pvault_entries e where e.project_id = p_project), '[]'::jsonb);
end $$;

-- One encrypted value.
create or replace function public.pvault_value(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.pvault_entries;
begin
  perform public.todo_check(p_token);
  select * into r from public.pvault_entries where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', r.id, 'project_id', r.project_id, 'name', r.name_blob, 'value', r.value_blob);
end $$;

-- Create (new id) or replace an entry of that project. Max 50 per project.
create or replace function public.pvault_save(p_token text, p_id uuid, p_project uuid, p_name text, p_value text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  if not exists (select 1 from public.pvault_lock) then raise exception 'vault not set up' using errcode = '23514'; end if;
  if exists (select 1 from public.pvault_entries where id = p_id) then
    update public.pvault_entries set name_blob = p_name, value_blob = p_value, updated_at = now() where id = p_id and project_id = p_project;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  else
    if not exists (select 1 from public.personal_projects where id = p_project) then raise exception 'not found' using errcode = 'P0002'; end if;
    if (select count(*) from public.pvault_entries where project_id = p_project) >= 50 then raise exception 'too many' using errcode = '23514'; end if;
    insert into public.pvault_entries (id, project_id, name_blob, value_blob) values (p_id, p_project, p_name, p_value);
  end if;
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.pvault_delete(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  delete from public.pvault_entries where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Forgotten password: wipe every vault entry and the password so a new vault can be set up.
create or replace function public.pvault_reset(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  perform public.todo_check(p_token);
  delete from public.pvault_entries where true;
  get diagnostics n = row_count;
  delete from public.pvault_lock where true;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

revoke all on function public.pvault_state(text) from public, anon, authenticated;
revoke all on function public.pvault_setup(text, text, text, text) from public, anon, authenticated;
revoke all on function public.pvault_attempt(text, boolean) from public, anon, authenticated;
revoke all on function public.pvault_list(text, uuid) from public, anon, authenticated;
revoke all on function public.pvault_value(text, uuid) from public, anon, authenticated;
revoke all on function public.pvault_save(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.pvault_delete(text, uuid) from public, anon, authenticated;
revoke all on function public.pvault_reset(text) from public, anon, authenticated;
grant execute on function public.pvault_state(text) to anon, service_role;
grant execute on function public.pvault_setup(text, text, text, text) to anon, service_role;
grant execute on function public.pvault_attempt(text, boolean) to anon, service_role;
grant execute on function public.pvault_list(text, uuid) to anon, service_role;
grant execute on function public.pvault_value(text, uuid) to anon, service_role;
grant execute on function public.pvault_save(text, uuid, uuid, text, text) to anon, service_role;
grant execute on function public.pvault_delete(text, uuid) to anon, service_role;
grant execute on function public.pvault_reset(text) to anon, service_role;

-- Belt and braces: no direct table access for the public roles at all (RLS already shows them nothing);
-- only the security-definer functions above can touch the vault.
revoke all on table public.pvault_lock, public.pvault_entries from anon, authenticated;
