# CLAUDE.md — working instructions for luc-todo

This is the living instruction file for any Claude session working on this repo. The Claude Project's own
instructions are short and stable; **everything detailed lives here** and in `docs/`. When this file and the
Project instructions disagree, this file wins (it is newer).

**Claude keeps this file current.** When Luc gives a standing instruction ("from now on…", "always…"), when a
decision changes how the app works, or when a session learns a pitfall the next session needs, update this file
in the same commit as the work (or a small docs commit) and add a dated line to the Amendments log at the bottom.
Keep it short: facts and rules, not history.

## Who and how to talk
- Luc Evans, Cardiff (Europe/London). Not a developer: explain outcomes in plain English first, then detail.
- Concise, scannable answers; direct honest assessment over hedging.
- After shipping, give a short "what changed / what to try on your devices" note and say plainly what could not be
  tested (Luc tests on his real iPad 2 and iPhone 13).

## Efficiency (Luc asked for lower usage and faster replies, 1 Nov 2026)
- Read this file first, then only the doc sections the task needs (grep `docs/ARCHITECTURE.md` / `docs/ROADMAP.md`); do not read whole docs, `core.js` or `app.css` unless editing them. Use Grep for targeted reads.
- Batch independent tool calls in one turn; no sub-agents; poll deploys sparingly (one check after ~60 s).
- While building run targeted checks only; run the full suite (`python3 tests/harness.py . tests/t_deploya.py`) once before push, with the node suites. Skip before/after measuring unless the task is performance, and skip mutation proofs unless the change is risky.
- One screenshot sheet per design batch; short notes, no recaps of steps.

## Where things are (read these at the start of a session)
| File | What it holds |
|---|---|
| `CLAUDE.md` (this file) | Rules, constraints, workflow, pitfalls, amendments |
| `docs/ARCHITECTURE.md` | Current state: layout, data model, flows, deployment, known nuances |
| `docs/ROADMAP.md` | What's next (P0–P3) and what's done |
| `docs/API.md` | API contracts, generated from the header comment of each `api/*.js` (`python3 tools/gen_api_doc.py`) |
| `db/setup01..NN.sql` | Every database change, in order (the live schema = all of them applied) |
| `tests/` | Mock test harness and suites (`tests/README.md`) |
| `docs/claude-project/` | The Claude Project instructions text and the two skills (source of truth for what is pasted into claude.ai) |

## Hard constraints
- **Frontend is ES5 only** (`public/js/*.js`, `shell.html`): no arrow functions, let/const, template literals,
  classes, CSS `grid`, `position:sticky`, `fetch` or Promises; no `Array.prototype.includes`, `Object.assign`,
  `startsWith`. Targets: **iPad 2 on iOS 9.3.5** (Safari 9) and iPhone 13. Use `var`, XHR via `App.api`, flexbox
  (with `-webkit-` prefixes) or floats. Tap targets ≥ 44px (chips and buttons are now 44px); 12px minimum font.
- Backend: Vercel Node serverless functions in `api/` (one file per endpoint, max 12 files: see Pitfalls; CommonJS, Node 22) calling
  **Supabase RPCs only** (security-definer SQL functions). The browser never talks to Supabase.
- Secrets only as Vercel env vars (`SUPABASE_URL`, `SUPABASE_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `VERCEL_TOKEN`, `VAULT_PEPPER`, …).
  Never put keys, the access token or its hash in code, docs, commits or chat.
- Auth: one access token, header `x-todo-token` (or `?t=`), checked by `todo_check`.
- **Shared database**: Supabase project `ulcenfhbxvxbkxybldfp` also holds the separate shopping app
  (holmlodge-shop). Never create, alter, drop or write `shop_*` objects or the `shop` config key, never call the
  shop's endpoints, never touch the holmlodge-shop repo or Vercel project from here.

## Stack and repo
- Repo `Levo54321/todo` (private). Branch `main` auto-deploys to Vercel project `luc-todo` (team `teamevo`, region
  dub1). Live: https://luc-todo.vercel.app.
- `shell.html` → `python3 tools/build.py <ver> budget saver calendar insights projects workcal board pprojects csvimport`
  → `public/index.html`. Module load order matters. **Bump `<ver>` (the `?v=` cache buster) on every
  frontend change**; the current version is in `public/index.html`.
- `public/js/core.js` (~100 KB) is the shell: `window.App`, view registry `App.register(name,{title,render,show})`,
  state, editor sheet, task lists. Modules: budget, saver (screensaver), calendar, insights, projects (Manage
  Projects, Work), workcal (Google work-calendar prompt), board (Projects board, Work), pprojects (My projects).
- One document-level click handler dispatches `data-act`; modules use their own attributes: `data-bd` (board),
  `data-pj` (projects), `data-wc` (work calendar), `data-pp` (My projects), `data-sv` (screensaver settings).
- Design (v1056/57): warm paper `--bg:#f5f2eb`, one accent per mode (navy Personal, green Work), sans-serif only, radii 8/12/16,
  4px spacing unit, type scale 12/14/16/17/20/28, 76px left rail (icon-only bottom bar on phones), night theme via
  `html.night`. `public/app.css` is ONE ordered file (tokens, base, shell, header, lists, tags/chips/buttons, sheets and
  editor, views, saver/gate, breakpoints) and owns everything shared; `work.css` = Work board and manager only,
  `pprojects.css` = My projects only. Do not restyle an `app.css` class from another file: later files win at equal
  specificity and that is how the old layers piled up.

## How to work
1. Read the files involved before editing; keep changes surgical. Feature order: SQL migration (if needed) → RPC →
   `api/*.js` (update its header comment, it is the contract) → UI module → bump `?v=`.
2. Non-trivial work: give a plan (≤ 15 lines) and wait for Luc's OK. Ask at most a few questions, only where a
   wrong guess is expensive; otherwise decide and say what you assumed.
3. Several independent changes → separate commits and deploys, so each can be rolled back.
4. **Database changes**: next numbered `db/setupNN.sql` (idempotent: `if not exists`, `create or replace`), applied
   to Supabase with `apply_migration`. Test risky SQL first inside `begin; … rollback;` with `execute_sql`.
   When a change alters values the live page reads (e.g. statuses), apply it right before pushing the matching
   frontend and keep the old value accepted for a release.
5. **Tests** (`tests/`, see `tests/README.md`): Playwright with every `/api/*` mocked (`tests/harness.py`), the built
   `public/index.html` in Chromium, real clicks and DOM assertions; `node tests/es5.js public/js/*.js` parses every
   module as ES5; `node tests/todos_node.js`, `vault_node.js` and `gcal_node.js` cover the server side without a network. Extend the mock and add a test module for new work. Cover the new work plus the existing flows that
   must not break: quick add and the iPhone Shortcut (`POST /api/todos {text}`), recurring tasks, Work ordering
   (`cmpWork`), pause and blocked, projects/board, calendar prompts, budget, Insights, screensaver. Check iPad
   (1024×768) and iPhone (390×844) widths for horizontal overflow. Set localStorage `railOpen=1` and
   `pvSeen=<today>` in the harness or overlays block clicks.
6. **Commit** as the GitHub-linked identity (Vercel blocks deploys from unlinked authors):
   `git config user.name Levo54321` and `git config user.email 316761085+Levo54321@users.noreply.github.com`.
7. **After each push**: confirm the new production deployment is READY and that `luc-todo.vercel.app` points at it
   (`get_alias`; if stale, `assign_alias`). For anything near the shared database, record `shop_*` row counts and
   the latest holmlodge-shop production deployment before, and confirm both unchanged after.
8. **Docs**: update `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, regenerate `docs/API.md`, and amend this file in the
   same change. The Claude Project does not hold copies of these any more, so nothing needs re-uploading.

## Pitfalls learned
- Dates are `YYYY-MM-DD` strings in Europe/London, not UTC (time zone fixed in `api/todos.js`).
- board.js's submit handler grabs any form with class `bdadd`; other modules must use their own form class
  (My projects uses `ppadd`).
- Task rows from `App.listHTML` carry `data-act` and are handled by core; a module's own click handler must stop
  walking up at elements with `data-act` or `<a>` links.
- Config keys are whitelisted in `cfg_get`/`cfg_set` (`db/setup13.sql`); a new key needs a migration editing both.
- Vercel MCP file reads truncate at ~2 KB: read source from the repo. The workspace shell cannot reach the public
  internet (allowlist), so live-site checks go through the Vercel/Supabase tools or Luc.
- Vercel tokens cannot be read-only; `VERCEL_TOKEN` is scoped to team teamevo with an expiry.
- iPad Safari 9 `vh` is unreliable and nested scrollers in two directions fight over swipes. For fixed panes, turn the
  outer `.scrollview` off and set px heights from `window.innerHeight` in JS on paint/resize/orientationchange (see
  `layout()` in `pprojects.js`); give each scroll area `-webkit-overflow-scrolling:touch`, and the sideways strip
  `overflow-y:hidden`. Keep scroll positions across repaints (`App.setHTML` replaces innerHTML).
- core.js checks for changes every 30 s and calls `App.render()` whenever the list came back in full, and about once a
  minute otherwise (see "Polling" below), so a module's `paint()` runs constantly. It must be a no-op
  when nothing changed: use `App.setHTML`'s return value and, when false, write nothing (no `.value`, `focus()`,
  `scrollTop`, style heights). iOS 9 moves the cursor to the start when `.value` is set (even to the same text) and
  repaints touch-scroll areas on scrollTop/height writes (flicker). Desktop Chrome hides both, so tests spy on the
  writes (`idle_checks` in `tests/t_projects.py`). On a real redraw, restore focus and `setSelectionRange`.
- **Polling (v1052)**: `GET /api/todos?v=<fingerprint>` answers `{same:true,today,now}` when the list is unchanged, else
  the full list plus its fingerprint `v` (no `?v=` always means the full list: older cached apps, Shortcuts, the
  `?open=latest` check in `shell.html`). In core.js `load()` sends `v` only while nothing was edited here since the list
  it belongs to (`vMut === lastMutation`). Rules that keep the screen honest: (1) code that changes `todos` locally must set
  `lastMutation` (`App.mutated()`); (2) every "refresh and trust the server over what is on screen" path must call
  `forceLoad()` (clears `v`), never `lastMutation = 0; load()`, or a failed save would be answered "same" and stay wrong;
  (3) a "same" reply skips `render()` except when offline/not loaded/day changed/the minute moved on, because the glance
  strip greys finished events and the "new" quick-chips expire by the clock; (4) the idle counter counts 30 s ticks
  (20 = 10 minutes), `CAL_EVERY` (5 min) governs Apple calendar sync and its 30 s retry. Run `node tests/todos_node.js`
  after touching `api/todos.js` GET.
- Playwright's `clock.install(time=...)` reads a bare number as **seconds** (a millisecond value puts the page in year
  58804); pass a `datetime`. `h.calls` in the harness is shared by every open page: count a page's own requests with
  `pg.on('request')` when timing matters.
- **Vercel Hobby plan: max 12 serverless functions per deployment** (every `api/*.js` is one; there are 12). A 13th file
  makes the deploy fail with `exceeded_serverless_functions_per_deployment` while the old version stays live. Add new
  endpoints as a route inside an existing file, with shared code in `api/_name.js` (a leading `_` is not a function).
- My projects has an agreed 4-deploy plan in `docs/ROADMAP.md`; follow it and stop after each deploy for Luc to test.
- **Chips and pills keep a 44px tap area** with a transparent 6px border plus `background-clip:padding-box` (the visible pill is 32px). Therefore colour them with `background-color`, never the `background` shorthand (it resets the clip and the border shows). Same trick: `.pplk`, `.ppmv`, `.weekbtn`, `.bdnum`.
- Fetching a protected Vercel URL with `web_fetch_vercel_url` creates a temporary shareable bypass link on the
  alias; avoid it unless needed and tell Luc if it happens.
- **Desktop "Install app" (v1058)**: `public/manifest.webmanifest` + `public/sw.js` + `icon-192.png`/`icon-512.png`. `sw.js` is deliberately a do-nothing pass-through (no caching, no `respondWith`): the iPad must always load the latest deploy, so never add caching without Luc asking. It is a static file, not an API function (the 12-function limit is untouched). Chrome only offers install on https/localhost and never in incognito. `node`-free check: `python3 tests/t_install.py` asks Chromium itself (`Page.getInstallabilityErrors`). Keep the manifest `<link>` and the register snippet in `shell.html`; change icons in all three sizes together.

## Amendments log
Newest first. One line each: date — what changed in how sessions should work.
- 2026-11-07 — v1065: photo scan (handwritten notes -> tasks). `POST /api/todos?scan=1` runs `api/_scan.js` (Gemini) and stages the CSV in `todo_scans` (`db/setup23.sql`, applied); the app shows a "Scan ready" bar once at startup and `?open=scan` jumps to the review cards. `GEMINI_API_KEY` / `GEMINI_MODEL` are Vercel env vars Luc sets himself: never ask for, print or handle the key (the Shortcut no longer holds it). The token is checked before Gemini is called. Free Gemini tier lets Google use the content to improve products: Luc was told, keep it in mind when he scans confidential pages. Targeted tests: `node tests/scan_node.js`, scan block in `tests/t_import.py`, es5.
- 2026-11-07 — v1064 shipped (task-editor look in import cards, 16px inputs, update-after-edit fix). Three known import bugs/ideas are logged for later in `docs/ROADMAP.md` under "Open import issues" (update must link by id; iPad 2 one-tap copy; the "Paste CSV" mode button does nothing). Read that section before touching `csvimport.js`.
- 2026-11-07 — v1063: import upgrade (see ARCHITECTURE "v1063 import upgrade"). Optional 12th column `id` (export) makes a row update that task; the `todo-import-builder` skill (claude.ai) should learn: words are accepted (tomorrow, mon, 9 Nov, 9am, high, every week), `\|` for a pipe in a sub-task, and that `id` exists only in exports. Luc: keep data use low (cards re-check one row at a time; the full list is fetched only at the duplicate check and on Export). Targeted tests only: `bulk_node.js`, `t_import.py`, es5.
- 2026-11-07 — v1062: Previous imports rows have Copy and Download (all devices). The page saves a clean 11-column CSV of what was understood (`canonCSV()` in csvimport.js) with the first chunk (`csv`), stored in `todo_imports.csv` (`db/setup22.sql`, applied; RPCs `todo_import_csv_set/get`, `GET /api/todos?import_csv=<id>`). Imports made before v1062 have no copy (no buttons). iOS 9 cannot save or copy by script, so those fall back to a select-all text box. Targeted tests only: `bulk_node.js`, `t_import.py`, es5.
- 2026-11-07 — v1061: import has an 11th column `subtasks` (items split on `|`/line breaks, `[x]` = done, saved as the task's `items`), a Paste CSV mode and now works on phones/iPad (no file picker or template download on iOS; `canFile` in csvimport.js), card-style review UI, and notes get a light-markdown preview in the editor (`App.md`, `#eNotesMd` in core.js/shell.html). Luc asked to conserve usage: targeted tests only (`bulk_node.js`, `t_import.py`, es5). Skill must now output BOTH a downloadable file and a copyable CSV code block, add notes only from real context, and include `subtasks`.
- 2026-11-07 — v1060: import preview panel, header aliases, Previous imports + Undo (`db/setup21.sql` = new table `todo_imports` + 3 RPCs, applied; `GET /api/todos?imports=1`, `POST ?import_undo=<id>`). The `todo-import-builder` skill (claude.ai, not in repo) must keep the same 10 columns/rules as `api/_bulk.js`; if columns change, update `_bulk.js`, `csvimport.js` (COLS, TEMPLATE, ALIAS), `docs/import/*`, tests and tell Luc to update the skill. Harness mock mirrors the new RPCs (`h.imports`).
- 2026-11-07 — v1059: desktop-only CSV import (Settings > Import, `public/js/csvimport.js`, `api/_bulk.js`, `POST /api/todos?bulk=1`; no DB change). Build line now ends `… pprojects csvimport`. Row rules live ONLY in `_bulk.js`; if columns change update `docs/import/*` and `TEMPLATE` in csvimport.js too. Tests: `node tests/bulk_node.js` and `tests/t_import.py` (chained at the end of `t_deploya.py`; the harness mock runs the real `_bulk.js` through node). `load()` is paused while Settings is open, so anything added from a settings tab uses `App.reloadWhenSettingsClose()`.
- 2026-11-02 — v1058: desktop Chrome/Edge "Install app" (manifest, pass-through service worker, 192/512 icons, `tests/t_install.py`). No JS module, API or database change; iPad/iPhone behaviour unchanged (old Safari ignores the service worker).
- 2026-11-01 — Redesign Batches A+B (v1056, v1057; Luc asked for two big batches and skipped the full suite): `app.css` rewritten as one ordered design-system file (override layers merged; list tags, editor sheet and segmented controls moved in from `work.css`); `work.css`/`pprojects.css` trimmed to board/My projects only. Chip/pill look unified (`.cat .qk .mst .blk .pau .bdh .bdp .pplk`: categories and states are pills, times/repeats plain text; only Must-today is solid). Board rows: coloured edge bar instead of tinted rows. Phones: Glance and category filters are one sideways-scrolling line. Checked with a Playwright audit (tap targets, font size, overflow at 1024x768, 768x1024, 390x844, 1440x900) and screenshots, not the mock suites. No JS or API changes.
- 2026-11-01 — Deploy G (v1055) UI round 3: `--serif` token now points at the sans stack (no serif/italic headings, gate, editor title, saver clock); Insights bar-chart labels every other bar (viewBox text is scaled, so keep SVG text >= 14 units); `.fsbtn` hidden under 700px. SVG text size is NOT covered by the min-font check (it measures CSS size, not scaled size). Luc once saw the iPad load slowly with only Personal/Work/Tomorrow tabs right after a deploy; it cleared by itself (likely the old page loading while the new files arrived), so wait and reload before debugging.
- 2026-11-01 — Deploy F (v1054) UI round 2: board.js/pprojects.js no longer inject CSS — styles are in `public/work.css` and `public/pprojects.css` (linked in `shell.html`); board/pprojects colours use tokens (`--warnink --warnbg --alertbg --pz --pzbg --pzink`, night variants in `app.css`). 44px targets via the "round 2" block at the end of `app.css` (uses `body .bdnum` etc. to beat later-loaded work.css: later files override app.css at equal specificity). Overdue "Move to" is one button (`data-act=moveopen`, `moveOpen` in core.js) that reveals the chips. Board priority numbers stay beside rows (side by side with the grip). Flex items with an input need `min-width:0` or they overflow narrow phones. Budget/Insights/editor/saver/gate not individually restyled.
- 2026-11-01 — Deploy E (v1053) design batch: one **Projects** rail tab (`#nProjects`, data-view `projects`) with a Work | Personal switch (`#projSwitch`, `#psW`/`#psP`) that opens the existing `board` / `pprojects` views (`navTo` maps `projects`; last choice in localStorage `projMode`). `#nBoard`, `#nPprojects`, `#nWorkouts` and the `soon` handler are gone; tests click `#nProjects` (+ `#psP`). Phone bar is icons only (labels hidden, `aria-label` set); phone header compact; Idea lane after In progress on phones (`ppl-<status>` classes). Visual layer = end of `app.css` ("v1053 premium layer"), sans-serif, `--sh` shadow token, muted text darkened for contrast, no text under 12px. Still open: chips are 36px, board tab/number buttons 26–30px (not 44px). Efficiency rules added above.
- 2026-11-01 — Audit Deploy D (v1052, polling diet C5) done: `GET /api/todos?v=` "same" replies, 30 s refresh (idle still 10 min), Apple calendar sync every 5 min; rules in Pitfalls "Polling (v1052)". Two things beyond the approved plan, both to keep behaviour: `forceLoad()` for every refresh-and-trust-server path, and a "same" reply still redraws once a minute (clock-driven bits). New `tests/todos_node.js`; Deploy D browser checks are `deploy_d()` in `tests/t_deploya.py`. `docs/audit-2026-11/scripts/audit_calls.py` now also reports bytes. Next: Luc picks from `docs/AUDIT-2026-11.md` section 5 after testing v1052.
- 2026-11-01 — Luc's iPhone Shortcuts use `?t=`: do NOT remove `?t=` support from any endpoint until he says (tabled with C1 token rotation). Anything that needs work from Luc (rotation, updating Shortcuts, env changes) is tabled until he asks. Google sign-in now starts by POST (v1051); run `node tests/gcal_node.js` after touching `api/gcal.js`.
- 2026-11-01 — Modules needing the token use `App.whenToken(fn)` (never poll with retries); `/api/projects` is fetched via `App.getProjects(cb)` (shared in-flight). Audit Deploy A (v1050) done; B (token safety), C (rotation), D (polling) wait for Luc's go-ahead after he tests each. New test module `tests/t_deploya.py` (chains t_projects); run it instead of t_projects.
- 2026-11-01 — Audit `docs/AUDIT-2026-11.md` (findings + prioritised list; Luc picks what gets fixed). Its measuring scripts live in `docs/audit-2026-11/scripts/` (they import `tests/harness.py` minus its last `main()` line); re-run them before/after performance work.
- 2026-11-01 — Vault (`api/_vault.js`, via `POST /api/pprojects?vault=1`): never log, return, or put in URLs/activity any vault value, name, password or pass; POST only; Luc sets the vault password in the app and `VAULT_PEPPER` in Vercel himself (never ask for or handle either). Run `node tests/vault_node.js` after touching the vault.
- 2026-11-01 — My projects `meta` is replaced whole on save: any form that saves meta must carry over keys it does not edit (e.g. `reason`). Never serve or store SVG icons (script risk); stored images are checked by magic bytes. Tests can whitelist deliberate console errors with `h.allow`.
- 2026-11-01 — Project costs have their own table (`personal_project_costs`); never write Budget's config from My projects (read-only name match only). Playwright `inner_text` applies CSS text-transform: compare uppercase labels case-insensitively in tests.
- 2026-11-01 — My projects: the Idea lane shows only when it holds a project (In progress is first otherwise). Background redraws must write nothing (see Pitfalls).
- 2026-11-01 — Personal project statuses live in four places: DB check + `pproj_save` (latest `db/setupNN.sql`), `api/pprojects.js` STATUS, `core.js` PP_SHELF, `pprojects.js` STAT/LABEL/SHELF/REASON/NOTLIVE/fold. Change all together.
- 2026-11-01 — My projects reordering must be drag and drop (Luc dislikes up/down arrows); reuse board.js touch drag.
- 2026-11-01 — Fixed-height panes use JS heights from innerHeight, not vh (see Pitfalls).
- 2026-11-01 — Moved all detailed instructions and context into this repo (CLAUDE.md, docs/, docs/API.md,
  docs/claude-project/). The Claude Project keeps only short stable instructions pointing here; skills are thin
  pointers to this file. Claude updates this file instead of asking Luc to re-upload docs.
