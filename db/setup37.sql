-- To-do v37: Work projects data v2 (additive; nothing is dropped or renamed).
--  * work_field_log: who changed which field, with the old and new value. The v2 migration writes one row per project
--    (field 'meta', by 'migrate_v2', old = the complete meta before) so any project can be put back; the new section
--    and the Claude import write one row per changed field (by luc/claude/auto, src = source link).
--  * work_projects.next_task_id: the project's Next task (one per project). The app treats it as cleared when the task
--    is missing, done or no longer in this project, so no todo_* function needs to change.
-- The new meta keys (link kind/id, linear, particip, deliver, activity, prov, sv) need no SQL: wproj_meta_put merges
-- any keys; their shape and cleaning live in api/_wv2.js + api/_wpmeta.js.
-- Touches no shop_* objects. Safe to run more than once.

create table if not exists public.work_field_log (
  id bigint generated always as identity primary key,
  project_id text not null references public.work_projects(id) on delete cascade,
  at timestamptz not null default now(),
  field text not null,
  old jsonb,
  new jsonb,
  by text not null check (by in ('luc', 'claude', 'auto', 'migrate_v2')),
  src text,
  note text
);
create index if not exists work_field_log_proj on public.work_field_log (project_id, at desc);
alter table public.work_field_log enable row level security;

alter table public.work_projects add column if not exists next_task_id uuid;
