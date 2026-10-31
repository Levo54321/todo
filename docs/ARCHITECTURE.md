# luc-todo — current state and architecture

_Snapshot: 31 Oct 2026. Repo `Levo54321/todo`, live at https://luc-todo.vercel.app._

## 1. Big picture
```
iPad 2 (iOS 9) / iPhone  --XHR-->  /api/*.js (Vercel Node, dub1)  --RPC-->  Supabase Postgres (security-definer functions)
        |                                   |--> Apple iCloud CalDAV  (api/cal.js)
        |                                   |--> Google Calendar OAuth (api/gcal.js)
        |                                   `--> Open-Meteo / iCal feed (api/glance.js)
        `-- iframe --> holmlodge-shop.vercel.app  (separate project, same Supabase)
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
| `public/js/projects.js` | Manage Projects (priority, status, rename) |
| `public/js/workcal.js` | "Add to Google work calendar?" prompt in the editor for timed Work tasks |
| `public/js/budget.js`, `saver.js`, `calendar.js`, `shopping.js` | Budget, screensaver, calendar view, shop iframe |
| `api/*.js` | one endpoint each (see section 4) |
| `db/setup01..12.sql` | ordered migrations; idempotent (`if not exists`, `create or replace`) |
| `public/add.html` | minimal add page |

## 3. Data model
`todos` (RLS on, accessed only by RPCs). Key fields: `list` personal/work; `category` is the project for Work; `prio` 0-3; flags `must`, `quick`, `low`, `blocked`, `paused`; recurrence `recur` (daily, weekdays, weekly, fortnightly, monthly, yearly) with `recur_until` and `series_id`; session tasks use `is_session` + `items` jsonb; `plan_date/plan_order` drive day planning; calendar sync fields `cal_uid/etag/sig`.
Other tables: `app_config(key,value)`, `budget_entries(entry_date,kind,amount)`, `saver_images`. Shop tables (`shop_*`) share the database but belong to holmlodge-shop.

## 4. API surface
`/api/todos` (GET list, POST add/quick-add, PATCH, DELETE; plan ordering), `/api/pause`, `/api/projects`, `/api/history`, `/api/budget`, `/api/cal`, `/api/gcal`, `/api/glance`, `/api/ics` (event, task feed, bill feed), `/api/saver`, `/api/settings`, `/api/shopping` (legacy).
Env vars (Vercel only): `SUPABASE_URL`, `SUPABASE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; optional `GLANCE_LAT/LON/PLACE`, `CAL_ICS_URL`.

## 5. Key data flows
- **Quick add** (Shortcut or app): `POST /api/todos {text}` -> shorthand parsed server-side (days, months, times, list/category) -> `todo_add`.
- **Work ordering**: client `cmpWork` sorts the Work column; `Ot/At` maps from `setProjects` break ties by project order; board order saved via `PATCH /api/projects?id`.
- **Pause**: `POST /api/pause?id {paused,on}` -> `todo_pause`. Pausing stamps `paused_at`; resuming adds elapsed whole days to `due_date` and accumulates `paused_secs`. Paused tasks are excluded from Overdue/counts and from `todo_history` durations. Resume then best-effort re-syncs Apple/Google calendars.
- **Calendars**: personal timed tasks -> Apple CalDAV (only events with UID suffix `@luc-todo` are ever touched). Timed Work tasks -> Google Calendar when the editor choice is "yes" (per-task choice stored via `/api/gcal` `sched`).
- **Shopping tab**: iframe to holmlodge-shop; key in localStorage `shopKey`.

## 6. Deployment
Push to `main` -> Vercel production build (no build step beyond static + functions). Region dub1. HTML is `no-cache`. `luc-todo.vercel.app` alias did **not** auto-move on the first git deploy and was assigned manually; verify after each push. Manual path: Vercel MCP `create_deployment` then `assign_alias`.

## 7. Known nuances
- Repo `public/js` is readable source; earlier manual deploys were terser-minified. Cache buster `?v=` must be bumped in `build.py` args when JS/CSS change.
- Vercel MCP file-content reads truncate at ~2 KB; get source from the repo instead.
- Pause/Blocked/board features are mock-tested only; not yet exercised on physical iPad 2.
- Test folders (t8-t12), old index versions and `.token` are intentionally not in the repo.
- Legacy `api/shopping.js` and shopping.js "Beta" copy predate the separate shop project.
- Time zone is fixed to Europe/London in `api/todos.js`.
