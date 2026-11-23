# Work projects data v2: migration runbook (stage 3a)

Status 23 Nov 2026 (connector back): **baseline recorded, backup taken and verified, dry run on the real data done, `db/setup37.sql` + the apply script tested inside a rolled-back transaction. Waiting for Luc's OK to apply.**
- Baseline before: shop items 1, members 3, push 1, receipts 1, shops 15, state 1, usuals 48; work_projects 15; open Work tasks 30; latest holmlodge-shop production deployment `dpl_Fnqvs85Eqj1EKTTCZxUFoNub5QbQ`.
- Backup: `work_bak_20261123_{projects 15, events 45, people 6, clients 1, client_icons 1, updates 0, status_state 1}`, row counts equal to the sources, RLS on.
- Dry run: `docs/handover/MIGRATION-V2-DRYRUN-2026-11-23.md` (15 projects, 9 link rows, 3 projects change, links lost 0).

## What v2 is (decision changed from the stage 2 plan, so the legacy ES5 pages keep working)
Luc asked to keep the legacy ES5 UI usable on the same data. So v2 does NOT add a resources table: everything stays in `work_projects.meta`.
- Link rows keep `{n,u,init?}` and may now carry `k` (kind) and `id` (Prolific group/study ID, Linear ID, Qualtrics form, Sheet id). The ID is read from the link
  automatically (text after the last `/`, ignoring a trailing `/overview`, `?query`, `#hash`) and can be edited by hand.
- New keys `linear`, `particip`, `deliver`, `activity`, `prov`, `sv`. Full shapes: header of `api/_wv2.js`.
- The only SQL is `db/setup37.sql`: `work_field_log` (history + the pre-migration copy of every project's meta) and `work_projects.next_task_id`.
- Every save through `PATCH /api/projects?id=..&meta=1` that carries links gives each row its kind and ID (kept from the stored row with the same URL, else read from the URL)
  and fills `meta.linear` from the first Linear issue link. So the legacy form (which does not send `k`/`id`) cannot strip them.
- Deadline shown on the board = `dates.due`. The Linear SLA is a separate ticket field.

## Steps (all SQL through the Supabase tools; project `ulcenfhbxvxbkxybldfp`)
1. **Baseline** (also after): `shop_*` row counts (items, members, push, receipts, shops, state, usuals), open Work task count, `work_projects` count,
   and the latest holmlodge-shop production deployment id (read-only).
2. **Backup** (new tables, RLS on, dropped later by Luc's OK):
   ```sql
   create table public.work_bak_20261123_projects as table public.work_projects;
   create table public.work_bak_20261123_events as table public.work_project_events;
   create table public.work_bak_20261123_people as table public.work_people;
   create table public.work_bak_20261123_clients as table public.work_clients;
   create table public.work_bak_20261123_client_icons as table public.work_client_icons;
   create table public.work_bak_20261123_updates as table public.work_project_updates;
   create table public.work_bak_20261123_status_state as table public.work_status_state;
   alter table public.work_bak_20261123_projects enable row level security; -- and the same for the other six
   ```
   Then compare row counts of each copy with its source.
3. **Apply `db/setup37.sql`** (additive; test first inside `begin; ... rollback;`).
4. **Dry run**: export the rows, then run the tool (nothing is written):
   ```sql
   select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'meta', meta) order by pos), '[]'::jsonb) from public.work_projects;
   ```
   Save the result as `rows.json`, then `node tools/wv2_migrate.js rows.json --md report.md --sql apply.sql`. The report shows every link row before and after,
   the Linear tickets it will read, warnings (a group or study whose link has no readable ID) and "links lost: 0". Luc reads it; nothing is applied yet.
5. **Apply** on Luc's OK: run `apply.sql` (one transaction; each project's old meta is first copied into `work_field_log`; a project changed since the dry run stops everything).
6. **Verify**: re-run the dry run (it must report "0 projects changed"), `shop_*` counts and the Work task counts unchanged, the latest holmlodge-shop deployment unchanged, `GET /api/projects` unchanged.
7. **Rollback** if needed: `update work_projects p set meta = l.old from work_field_log l where l.project_id = p.id and l.by = 'migrate_v2' and l.field = 'meta';` (or restore from the `work_bak_20261123_*` tables).
