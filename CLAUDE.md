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
  (with `-webkit-` prefixes) or floats. Tap targets ≥ 44px; 12px minimum font.
- Backend: Vercel Node serverless functions in `api/` (one file per endpoint, CommonJS, Node 22) calling
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
- `shell.html` → `python3 tools/build.py <ver> budget saver calendar insights projects workcal board pprojects`
  → `public/index.html`. Module load order matters. **Bump `<ver>` (the `?v=` cache buster) on every
  frontend change**; the current version is in `public/index.html`.
- `public/js/core.js` (~100 KB) is the shell: `window.App`, view registry `App.register(name,{title,render,show})`,
  state, editor sheet, task lists. Modules: budget, saver (screensaver), calendar, insights, projects (Manage
  Projects, Work), workcal (Google work-calendar prompt), board (Projects board, Work), pprojects (My projects).
- One document-level click handler dispatches `data-act`; modules use their own attributes: `data-bd` (board),
  `data-pj` (projects), `data-wc` (work calendar), `data-pp` (My projects), `data-sv` (screensaver settings).
- Design: warm paper `--bg:#f4eee1`, alert `--alert:#b8432b`, Georgia serif headings, 8px radius, 4px spacing unit,
  76px left rail (bottom bar on phones), night theme via `html.night`. CSS in `public/app.css`, `public/work.css`;
  board.js and pprojects.js inject their own `<style>`.

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
   module as ES5. Extend the mock and add a test module for new work. Cover the new work plus the existing flows that
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
- core.js reloads tasks and calls `App.render()` every 15 s, so a module's `paint()` runs constantly. It must be a no-op
  when nothing changed: use `App.setHTML`'s return value and, when false, write nothing (no `.value`, `focus()`,
  `scrollTop`, style heights). iOS 9 moves the cursor to the start when `.value` is set (even to the same text) and
  repaints touch-scroll areas on scrollTop/height writes (flicker). Desktop Chrome hides both, so tests spy on the
  writes (`idle_checks` in `tests/t_projects.py`). On a real redraw, restore focus and `setSelectionRange`.
- My projects has an agreed 4-deploy plan in `docs/ROADMAP.md`; follow it and stop after each deploy for Luc to test.
- Fetching a protected Vercel URL with `web_fetch_vercel_url` creates a temporary shareable bypass link on the
  alias; avoid it unless needed and tell Luc if it happens.

## Amendments log
Newest first. One line each: date — what changed in how sessions should work.
- 2026-11-01 — Vault (`api/vault.js`): never log, return, or put in URLs/activity any vault value, name, password or pass; POST only; Luc sets the vault password in the app and `VAULT_PEPPER` in Vercel himself (never ask for or handle either). Run `node tests/vault_node.js` after touching the vault.
- 2026-11-01 — My projects `meta` is replaced whole on save: any form that saves meta must carry over keys it does not edit (e.g. `reason`). Never serve or store SVG icons (script risk); stored images are checked by magic bytes. Tests can whitelist deliberate console errors with `h.allow`.
- 2026-11-01 — Project costs have their own table (`personal_project_costs`); never write Budget's config from My projects (read-only name match only). Playwright `inner_text` applies CSS text-transform: compare uppercase labels case-insensitively in tests.
- 2026-11-01 — My projects: the Idea lane shows only when it holds a project (In progress is first otherwise). Background redraws must write nothing (see Pitfalls).
- 2026-11-01 — Personal project statuses live in four places: DB check + `pproj_save` (latest `db/setupNN.sql`), `api/pprojects.js` STATUS, `core.js` PP_SHELF, `pprojects.js` STAT/LABEL/SHELF/REASON/NOTLIVE/fold. Change all together.
- 2026-11-01 — My projects reordering must be drag and drop (Luc dislikes up/down arrows); reuse board.js touch drag.
- 2026-11-01 — Fixed-height panes use JS heights from innerHeight, not vh (see Pitfalls).
- 2026-11-01 — Moved all detailed instructions and context into this repo (CLAUDE.md, docs/, docs/API.md,
  docs/claude-project/). The Claude Project keeps only short stable instructions pointing here; skills are thin
  pointers to this file. Claude updates this file instead of asking Luc to re-upload docs.
