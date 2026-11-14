# Tests (mocked, no real data)

- `harness.py` serves `public/` in Chromium and answers every `/api/*` from an in-memory mock (tasks, Work projects,
  Personal Projects, Vercel picker, deploy status). It fails if the page throws or tries to reach another site.
- `t_core.py`: the flows that must never break (no Shopping tab, quick add / Shortcut POST, recurring tick, Work
  list with paused and blocked, board, Insights, Budget, Tomorrow, Settings, screensaver).
- `t_projects.py`: My projects (runs `t_core` first): statuses incl. Idea, reason, still-live warning, drag order
  (mouse and synthetic touch), project costs, account labels and icons, the vault UI, Vercel picker, fixed-height layout at 1024×768, 768×1024 and 390×844, and idle checks that
  spy on value/focus/scroll writes during the 15 s background refresh (Chrome hides iOS 9's cursor and flicker issues).
- `t_deploya.py` (v1050, chains `t_projects`): late token (3 s and 15 s) still loads every module with one `/api/projects` fetch, Work board writes no scroll on idle ticks, board error + Try again, header not clipped at 1024/768/390. Run this one for the full suite (only needed for shared-behaviour changes; small UI changes use targeted checks).
- `deploy_d()` in `t_deploya.py` (v1052): "same" replies (list and page untouched), a change elsewhere comes through, a local edit forces the full list, a failed delete heals, 30 s refresh, idle every 10 minutes, calendar sync every 5 minutes, and the minute redraw (calendar event greys out), on Playwright's fake clock. The mock (`harness.py`) answers `GET /api/todos?v=` like the server (`h.same` counts "same" replies) and has `h.fail_delete`. Gotchas: `clock.install(time=)` reads a bare number as seconds (pass a `datetime`); `h.calls` is shared by every open page.
- `todos_node.js` (v1052): the server side of that, no network: full first time, `same` when unchanged, full after a change or with no/junk `?v=`, `?t=` still works, bad token refused, Shortcut `POST {text}` unchanged.
- `todos_node.js` also covers the Jarvis API (12 Nov 2026, no network, fake database with update/delete/project list/log): `?jarvis=1` fields, filters, order (focus/overdue/today/later/undated/low; Work by priority, project priority, board order; Personal by clock time), `q` matching (typo, stem, filler, project words), `id` (full notes, items, recur), `?activity=1`, the `x-source` log (update/add/delete, only changed fields, invalid tags ignored, failing or missing log never fails the change), and that the plain GET, its fingerprint, `?v=` "same", `?t=` and the Shortcut `POST {text}` are unchanged.
- `gcal_node.js` (v1051): Google sign-in start/state with no network (token not in the address, tampered state refused, old GET start retired).
- `t_install.py` (v1058, standalone: `python3 tests/t_install.py`): serves `public/` on `http://localhost` (secure, unlike the harness's `todo.test`) in a normal non-incognito Chromium profile and checks the manifest, icons, `Page.getInstallabilityErrors` is empty, the worker registers, and it caches/answers nothing.
- `bulk_node.js` + `t_import.py` (v1059): CSV import. Node: every row rule and the `?bulk=1` endpoint (dry run, all-or-nothing, part-way failure, 101 rows). Browser (runs last inside `t_deploya.py`; standalone `python3 tests/harness.py . tests/t_import.py`): template download, faulty file, good file with quoted commas/line breaks/UK dates, semicolons, server failure, and no Import tab on iPad 2 / iPhone user agents.
  v1060 adds: preview panel and mapping (LLM-style file with Row/Other details, alias headers), previous-imports list, Undo with confirm, node tests for `preview`, batch logging, `?imports=1`, `import_undo` (404/409/400) and a failing log never failing the import.
- `ics_node.js` (v1071): calendar event description (notes, sub-tasks, project, priority, escaping, size cap), no network.
- `jobs_node.js` + `t_jobs.py` (v1074): Jobs tab. Node: `api/_jobs.js` with a fake database (field cleaning, share-text parsing, LinkedIn link clean-up and no duplicates, stage list rules, error mapping). Browser (chains `t_core`; standalone `python3 tests/harness.py . tests/t_jobs.py`): side-menu tab, dark theme, add/edit/move/delete, history, stage editor (rename, two-tap remove, add, colour, drag reorder), phone layout, 44px targets, no sideways overflow, error + Try again, idle redraw writes nothing. Saves screenshots to `tests/out/`.
- `es5.js`: parses every `public/js/*.js` as ES5 and warns about iOS 9 gaps.
- `vault_node.js`: the vault's server-side crypto with an in-memory database (`node tests/vault_node.js`): ciphertext only,
  locked state, pass expiry, lockout, wrong pepper, reset, nothing sensitive in logs.

```
npm i --no-save acorn && node tests/es5.js public/js/*.js
pip install playwright && python3 tests/harness.py . tests/t_projects.py
```
Extend the mock in `harness.py` (`H.api`) when an endpoint changes. Add expected console errors (e.g. a deliberate 422) to
`h.allow` so real errors still fail the run. Real iPad 2 / iPhone checks are Luc's.
