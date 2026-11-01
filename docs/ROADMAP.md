# luc-todo — roadmap

_Audit 1 Nov 2026: see `docs/AUDIT-2026-11.md` for findings and a prioritised list (C1–C6, W1–W10, P1–P8). Items move here once Luc approves them._
_Done: v1050 (Deploy A) C3, C4, W3, W4, P1; v1051 (Deploy B) C2 and the `#t=` half of W2. Tabled by Luc (needs work from him): C1 token rotation and the `?t=` restriction (his Shortcuts use `?t=`). Next: Deploy D (polling diet, C5), plan APPROVED by Luc, not yet built (v1052):_

**Deploy D plan (approved 1 Nov 2026; build, test, push, then stop for Luc to test)**
1. `api/todos.js` GET: fingerprint the `todo_list` result (hash, excluding `now`); if the request has `?v=<fingerprint>` and it matches, reply `{same:true, today, now}` (about 0.2 KB) instead of the full list (about 82 KB). Always include the fingerprint (`v`) in full replies. No `?v=` (old cached app, Shortcuts) means the full list exactly as today. Update the file's header comment, regenerate `docs/API.md`.
2. `core.js` `load()`: send the last `v`; on `same`, keep `todos`, update `today` and `serverOffset`, and call `render()` only if `online` flipped or `today` changed. `lastMutation` guard stays.
3. Foreground refresh 15 s to 30 s (`setInterval` near line 1673); resume, focus, `pageshow`, visibilitychange and after-edit refreshes stay immediate; idle slowdown unchanged. Luc was asked about 30 s and said "sounds good".
4. `maybeCalSync`: 2 minutes to 5 minutes (as its comment says).
5. Honest numbers (correcting the audit's "90%"): calls about -50%, bytes about -99%. Re-run `docs/audit-2026-11/scripts/audit_calls.py` before and after and report the measured figures.
6. Tests: new `tests/todos_node.js` (stub `rpc` like `tests/gcal_node.js`: full first time, `same` when unchanged, full after a change, full with no `?v=`, Shortcut `POST {text}` unchanged); a browser test in `tests/t_deploya.py` (a `same` reply leaves the list and screen untouched; the harness mock in `tests/harness.py` needs `?v` support); plus `node tests/es5.js public/js/*.js`, `node tests/vault_node.js`, `node tests/gcal_node.js`, and `python3 tests/harness.py . tests/t_deploya.py`.
7. After the push: deployment READY and `luc-todo.vercel.app` pointing at it; update CLAUDE.md amendments, ARCHITECTURE.md and this file.

Tabled (needs work from Luc, only when he asks): C1 token rotation, the `?t=` restriction (his Shortcuts use `?t=`), C6 server-only key. After D, remaining audit items are in `docs/AUDIT-2026-11.md` section 5 (W1 to W10, P1 to P8); Luc picks.

## P0 — confirm and protect
1. ~~Alias does not follow pushes~~ Fixed 1 Nov 2026 (see ARCHITECTURE section 6). Keep checking after each push for a few more deploys; do not assign the alias by hand unless it is stale.
2. **Real-device pass** on iPad 2 and iPhone 13 for Pause, Blocked, board drag/number reorder, Insights and the Google work-calendar prompt.
3. ~~Restore tests into the repo~~ Done 1 Nov 2026: `tests/` has the Playwright mock harness, core and My projects suites and an ES5 check. Still to do: an `npm test` script / CI.
4. **Delete the Vercel token "pull-shop"** (created for the shop export).

5a. Decide whether to make the repo private and rotate the access token (the old token hash was committed in `db/setup01.sql` while the repo was public).
5b. Add a `todos` base-table migration so the database can be rebuilt from `db/` alone.

## My projects plan (agreed 1 Nov 2026, one deploy each, Luc tests between)
- ~~Deploy 1: layout/scroll fixes, icon kept on failed lookup, Vercel picker replaces its own domains~~ Done v1044.
- ~~Deploy 2: Idea status (shelved, tasks default to Backlog), Reason field (Idea/Paused/Not pursued/Shut down, logged), "paused but live on Vercel" warning, manual order within a lane by **drag and drop** (reuse board.js touch drag, not arrows), stored in a new `pos` column (not meta), new projects at top.~~ Done v1045 (`db/setup17.sql`); v1046 fixes: empty Idea lane hidden, no flicker/cursor jump on background refresh.
- ~~Deploy 3: subscriptions/costs per project in their own table (Budget bills have no ids and are monthly-only, so not reused; show "also in Budget" on a name match).~~ Done v1047 (`db/setup18.sql`).
- Follow-up (offered, not built): cross-project cost totals (per month / per year across all projects), and optionally a cost reminder feed like the Budget bills calendar feed.
- Deploy 4a: ~~account labels in meta; stored icon copies (custom upload + cached site icons)~~ Done v1048 (`db/setup19.sql`).
- ~~Deploy 4b: per-project vault (server-side AES-GCM, key from vault password + env `VAULT_PEPPER`)~~ Done v1049 (`db/setup20.sql`).
- Deploy 4c research (1 Nov 2026, Supabase docs): personal access tokens belong to an **account**, not a project. A *classic* token has full access to every organisation and project that account belongs to (now and future); *scoped* tokens (public alpha) can be limited to chosen orgs/projects/permissions (e.g. read-only). One token covers all organisations of one account, so two accounts = two tokens. The Management API's "List all projects" (account-wide read) would let a Supabase picker fill the project link and org like the Vercel picker, and a health dot is possible. If built: scoped, read-only tokens only, stored as Vercel env vars (e.g. `SUPABASE_PAT_1`, `SUPABASE_PAT_2`), never a classic token (it could change this shared database). Not built.
- Vault follow-ups (not built): change the vault password (re-encrypt everything), export.

## P1 — cleanup
5. ~~Remove legacy `api/shopping.js` and the Shopping tab~~ Done 1 Nov 2026 (v1040).
6. Add a build/minify step (terser `--ecma 5`) in a `tools/` script so deployed JS is small again, and a lint check that rejects ES6 syntax in `public/js`.
7. ~~Single `docs/` source of truth~~ Done 1 Nov 2026: `CLAUDE.md` + `docs/` in the repo are the source of truth; the Claude Project only points here.
8. Add a GitHub Action: ES5 lint + `build.py` smoke test on PRs.
8a. Work board lanes: replace `max-height: calc(100vh - 290px)` with the JS-height pattern My projects uses (v1044).

## P2 — features
9. Undo for complete/delete/pause (toast with Undo).
10. Paused tasks: optional "chase on <date>" reminder that resurfaces them.
11. Insights: per-project cycle time, paused-time breakdown ("waiting on whom").
12. Notes/attachments on Work tasks; weekly review prompt.
13. Offline queue (like the shop app's `shopQ`) so adds made without signal sync later.
14. Make time zone configurable.
14a. Personal Projects follow-ups: quick-add shorthand for a project (e.g. `@hub`, ideally straight to Backlog), delete/merge a project in the UI (API already supports DELETE), Personal Projects in Insights, optional Supabase health dot (needs a Supabase access token), drag cards between status columns, Supabase project picker (needs a Supabase access token).

## P3 — nice to have
15. Shortcuts for pause/resume and "what's due today" voice readout.
16. Split `core.js` (~100 KB) into smaller modules.
17. Surface shop shortcuts/notifications summary inside the to-do glance.
