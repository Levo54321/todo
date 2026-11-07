# Tests (mocked, no real data)

- `harness.py` serves `public/` in Chromium and answers every `/api/*` from an in-memory mock (tasks, Work projects,
  Personal Projects, Vercel picker, deploy status). It fails if the page throws or tries to reach another site.
- `t_core.py`: the flows that must never break (no Shopping tab, quick add / Shortcut POST, recurring tick, Work
  list with paused and blocked, board, Insights, Budget, Tomorrow, Settings, screensaver).
- `t_projects.py`: My projects (runs `t_core` first): statuses incl. Idea, reason, still-live warning, drag order
  (mouse and synthetic touch), project costs, account labels and icons, the vault UI, Vercel picker, fixed-height layout at 1024×768, 768×1024 and 390×844, and idle checks that
  spy on value/focus/scroll writes during the 15 s background refresh (Chrome hides iOS 9's cursor and flicker issues).
- `t_deploya.py` (v1050, chains `t_projects`): late token (3 s and 15 s) still loads every module with one `/api/projects` fetch, Work board writes no scroll on idle ticks, board error + Try again, header not clipped at 1024/768/390. Run this one for the full suite.
- `deploy_d()` in `t_deploya.py` (v1052): "same" replies (list and page untouched), a change elsewhere comes through, a local edit forces the full list, a failed delete heals, 30 s refresh, idle every 10 minutes, calendar sync every 5 minutes, and the minute redraw (calendar event greys out), on Playwright's fake clock. The mock (`harness.py`) answers `GET /api/todos?v=` like the server (`h.same` counts "same" replies) and has `h.fail_delete`. Gotchas: `clock.install(time=)` reads a bare number as seconds (pass a `datetime`); `h.calls` is shared by every open page.
- `todos_node.js` (v1052): the server side of that, no network: full first time, `same` when unchanged, full after a change or with no/junk `?v=`, `?t=` still works, bad token refused, Shortcut `POST {text}` unchanged.
- `gcal_node.js` (v1051): Google sign-in start/state with no network (token not in the address, tampered state refused, old GET start retired).
- `t_install.py` (v1058, standalone: `python3 tests/t_install.py`): serves `public/` on `http://localhost` (secure, unlike the harness's `todo.test`) in a normal non-incognito Chromium profile and checks the manifest, icons, `Page.getInstallabilityErrors` is empty, the worker registers, and it caches/answers nothing.
- `bulk_node.js` + `t_import.py` (v1059): CSV import. Node: every row rule and the `?bulk=1` endpoint (dry run, all-or-nothing, part-way failure, 101 rows). Browser (runs last inside `t_deploya.py`; standalone `python3 tests/harness.py . tests/t_import.py`): template download, faulty file, good file with quoted commas/line breaks/UK dates, semicolons, server failure, and no Import tab on iPad 2 / iPhone user agents.
- `es5.js`: parses every `public/js/*.js` as ES5 and warns about iOS 9 gaps.
- `vault_node.js`: the vault's server-side crypto with an in-memory database (`node tests/vault_node.js`): ciphertext only,
  locked state, pass expiry, lockout, wrong pepper, reset, nothing sensitive in logs.

```
npm i --no-save acorn && node tests/es5.js public/js/*.js
pip install playwright && python3 tests/harness.py . tests/t_projects.py
```
Extend the mock in `harness.py` (`H.api`) when an endpoint changes. Add expected console errors (e.g. a deliberate 422) to
`h.allow` so real errors still fail the run. Real iPad 2 / iPhone checks are Luc's.
