# luc-todo — current state and architecture

_Snapshot: 1 Nov 2026 (v1041). Repo `Levo54321/todo`, live at https://luc-todo.vercel.app._

## 1. Big picture
```
iPad 2 (iOS 9) / iPhone  --XHR-->  /api/*.js (Vercel Node, dub1)  --RPC-->  Supabase Postgres (security-definer functions)
        |                                   |--> Apple iCloud CalDAV  (api/cal.js)
        |                                   |--> Google Calendar OAuth (api/gcal.js)
        |                                   `--> Open-Meteo / iCal feed (api/glance.js)
```
Only the API layer holds the Supabase key. The browser holds the access token (localStorage) and sends it as `x-todo-token`.

## 2. Repository layout
| Path | Purpose |
|---|---|
| `shell.html` | HTML template with `@@V@@` and `@@SCRIPTS@@` placeholders |
| `tools/build.py` | `python3 tools/build.py <ver> <modules...>` -> `public/index.html` |
| `public/app.css`, `work.css` | styles; tokens in `:root` (`--bg`, `--alert`, `--serif`, `--r1`, `--s1`, `--fs-xs`, `--rail`) |
| `public/js/core.js` | `App` shell, router, state, editor sheet, Personal/Work columns, pause/resume handlers |
| `public/js/board.js` | Projects board, row states (overdue, blocked `st-bl`, paused `st-pz`), drag/number ordering, health chips |
| `public/js/insights.js` | completion stats, "time to finish" (excludes paused time), behind/open counts |
| `public/js/projects.js` | Manage Projects for Work (priority, status, rename) |
| `public/js/pprojects.js` | My projects: Personal Projects list + project page (tasks, done vs open progress, add task) |
| `public/js/workcal.js` | "Add to Google work calendar?" prompt in the editor for timed Work tasks |
| `public/js/budget.js`, `saver.js`, `calendar.js` | Budget, screensaver, calendar view |
| `api/*.js` | one endpoint each (see section 4) |
| `db/setup01..14.sql` | ordered migrations; idempotent (`if not exists`, `create or replace`) |
| `public/add.html` | minimal add page |

## 3. Data model
`todos` (RLS on, accessed only by RPCs). Key fields: `list` personal/work; `category` is the project for Work; `prio` 0-3; flags `must`, `quick`, `low`, `blocked`, `paused`; recurrence `recur` (daily, weekdays, weekly, fortnightly, monthly, yearly) with `recur_until` and `series_id`; session tasks use `is_session` + `items` jsonb; `plan_date/plan_order` drive day planning; calendar sync fields `cal_uid/etag/sig`; `pproject_id` (nullable) links a Personal task to a Personal Project.
Other tables: `personal_projects(id,name,status,created_at,updated_at)` (status active/paused/not_pursued/shut_down; names unique ignoring case), `app_config(key,value)`, `budget_entries(entry_date,kind,amount)`, `saver_images`. Shop tables (`shop_*`) and the `shop` config key share the database but belong to holmlodge-shop (a separate app with its own repo/project); this app never reads or changes them.

## 4. API surface
`/api/todos` (GET list, POST add/quick-add, PATCH, DELETE; plan ordering), `/api/pause`, `/api/projects` (Work), `/api/pprojects` (Personal Projects), `/api/history`, `/api/budget`, `/api/cal`, `/api/gcal`, `/api/glance`, `/api/ics` (event, task feed, bill feed), `/api/saver`, `/api/settings`.
Env vars (Vercel only): `SUPABASE_URL`, `SUPABASE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; optional `GLANCE_LAT/LON/PLACE`, `CAL_ICS_URL`.

## 5. Key data flows
- **Quick add** (Shortcut or app): `POST /api/todos {text}` -> shorthand parsed server-side (days, months, times, list/category) -> `todo_add`.
- **Work ordering**: client `cmpWork` sorts the Work column; `Ot/At` maps from `setProjects` break ties by project order; board order saved via `PATCH /api/projects?id`.
- **Pause**: `POST /api/pause?id {paused,on}` -> `todo_pause`. Pausing stamps `paused_at`; resuming adds elapsed whole days to `due_date` and accumulates `paused_secs`. Paused tasks are excluded from Overdue/counts and from `todo_history` durations. Resume then best-effort re-syncs Apple/Google calendars.
- **Calendars**: personal timed tasks -> Apple CalDAV (only events with UID suffix `@luc-todo` are ever touched). Timed Work tasks -> Google Calendar when the editor choice is "yes" (per-task choice stored via `/api/gcal` `sched`).
- **Personal Projects** (v1041): separate from Work projects and from the Personal `category` label (which stays a free label driving chips/filters). `GET /api/pprojects` -> `pproj_list` (counts incl. `done_old` = finished >7 days ago, since `todo_list` only returns the last 7 days of done tasks); `POST`/`PATCH` -> `pproj_save`; task link via `PATCH /api/todos {pproject_id}` (or `POST /api/todos {title, pproject_id}`). `todo_update` keeps `pproject_id` only for Personal tasks (cleared on a move to Work) and copies it to the next copy of a repeating task. In `core.js`, `isShelved(t)` = open Personal task whose project is not Active: treated like a paused Work task (out of Overdue, badges, stats, category counts, Today's order, review nudges, Insights open/behind) and listed in a collapsed "On-hold projects" group. Rail item "My projects" sits under Personal; the Work board keeps "Projects".
- **Shopping**: removed from this app on 1 Nov 2026 (v1040). The list lives only in holmlodge-shop.vercel.app.

## 6. Deployment
Push to `main` -> Vercel production build (no build step beyond static + functions). Region dub1. HTML is `no-cache`. **1 Nov 2026: the `luc-todo.vercel.app` alias now follows git pushes** (confirmed on a test push after the domain was re-added and the project's auto-assign-domains setting was set to true). Earlier manual alias assignments had left it pinned. After any push, still confirm the newest production deployment is READY and that the alias points at it; if not, run `assign_alias` for `luc-todo.vercel.app`.

## 7. Known nuances
- **Config keys are whitelisted** in `cfg_get`/`cfg_set` (`db/setup13.sql`): budget, caldav, caldav_state, saver, shop, gcal, projects. A new key needs a migration that edits both lists.
- `todos.category` (the project name) is capped at 40 characters; `title` at 500.
- `todos.created_at/updated_at` predate `db/setup01.sql`; rebuilding the database from `db/` alone would need the base `todos` table first.
- `todo_update` does not clear `paused` when a task is marked done (history handles it); check board/list code if a done task ever shows as paused.
- `db/setup01.sql` holds a placeholder for the access-token hash. Never commit the real hash.
- Repo `public/js` is readable source; earlier manual deploys were terser-minified. Cache buster `?v=` must be bumped in `build.py` args when JS/CSS change.
- Vercel MCP file-content reads truncate at ~2 KB; get source from the repo instead.
- Pause/Blocked/board features are mock-tested only; not yet exercised on physical iPad 2.
- Test folders (t8-t12), old index versions and `.token` are intentionally not in the repo.
- Time zone is fixed to Europe/London in `api/todos.js`.
