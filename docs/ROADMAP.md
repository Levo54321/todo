# luc-todo — roadmap

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
