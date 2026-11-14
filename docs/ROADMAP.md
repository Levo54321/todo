# luc-todo — roadmap

_Audit 1 Nov 2026: see `docs/AUDIT-2026-11.md` for findings and a prioritised list (C1–C6, W1–W10, P1–P8). Items move here once Luc approves them._
_Done: v1050 (Deploy A) C3, C4, W3, W4, P1; v1051 (Deploy B) C2 and the `#t=` half of W2; v1052 (Deploy D) C5 polling diet (built 1 Nov 2026, waiting for Luc's device test). Tabled by Luc (needs work from him): C1 token rotation and the `?t=` restriction (his Shortcuts use `?t=`)._

## Open import issues (Luc, 7 Nov 2026, after v1064: "works well enough to use", revisit later)
1. **Update should link by id, not by title.** When a card matches an existing task (title match) and Luc chooses Update, the link must be the task's unique id from that first match. Today, if he edits the title BEFORE choosing Update, the match is lost (the card is no longer a duplicate, so it is added as new) and a duplicate task appears. Fix idea: keep `it.dup` (the matched id) for the life of the card even if the title changes, keep offering Skip / Update it / Add as new, and show "linked to <old title>"; also consider matching on more than title (title + category/due date) so near-matches are caught. Related: `setup()` in csvimport.js drops `it.dup` when the new title no longer matches.
2. **iPad 2 (iOS 9.3.5): Copy buttons only open a select-all box.** Luc wants one-tap copy like the iPhone. `navigator.clipboard` does not exist there and `document.execCommand('copy')` only works from iOS 10, so it may not be possible on iOS 9; check before promising. The box now auto-selects on tap (v1064) but he must still tap Select All then Copy. Ideas: a bookmarklet/Shortcut, or accept the limit and say so in the UI.
3. **The "Paste CSV" button above the text box does nothing on iPhone or iPad** (Luc confirmed it is not the box or typing/pasting into the box, which work, and not the Copy buttons). It is the mode switch (`#impModePaste`, `data-imp="mpaste"`) which only switches to paste mode, so it is a no-op once already in paste mode (the only mode on iOS). Luc expects it to paste the clipboard into the box. Fix idea: on tap, try `navigator.clipboard.readText()` (iOS 14+, may prompt) and fill `#impPaste`, falling back to focusing the box with a "long-press and Paste" hint; confirm with Luc which button he means before building (the separate "Review pasted CSV" button works).
4. ~~Bigger idea~~ Partly built as v1065: photo of handwritten notes -> Gemini -> review cards (see ARCHITECTURE "v1065 photo scan"). Still open: adding tasks from Claude chat / other sources via the same `todo_scans` staging; an in-app progress indicator (the Shortcut waits ~10-20 s for the server); the Paste CSV button (#3) could also read the clipboard.

~~**Deploy D, polling diet (C5)**~~ Built as v1052, as approved (30 s refresh). Measured, mock data, one hour, Personal list open: calls 246 → 126 (-49%; with Apple calendar on 276 → 138, -50%), data downloaded 19.1 MB → 8 KB (-99.96%; the audit's "90%" was too low). Details in ARCHITECTURE section 5 "Polling". As built, two additions to the plan to keep behaviour: every refresh-and-trust-the-server path uses `forceLoad()` (a failed delete must heal even if nothing was edited first), and a "same" reply still redraws once a minute (finished calendar events grey out and the "new" chips expire by the clock). Idle refresh stays 10 minutes (counter 40 to 20 ticks); the calendar sync's 30 s failure retry was kept (`CAL_EVERY`).

Tabled (needs work from Luc, only when he asks): C1 token rotation, the `?t=` restriction (his Shortcuts use `?t=`), C6 server-only key. Remaining audit items are in `docs/AUDIT-2026-11.md` section 5 (W1 to W10, P1 to P8); Luc picks after testing v1052.

**Deploy E (v1053) design batch** built and approved 1 Nov 2026: single Projects tab with Work | Personal switch, Workouts removed, icon-only phone bar, compact phone header, premium visual layer, W5 partly (no text <12px; buttons 40-44px; chips 36px; board tabs/number buttons 26-30px still small) and P2 (contrast). Next candidates: finish 44px targets on the board, W8 injected CSS to files, P3 density option, W1 minify.

**Deploy F (v1054) UI round 2** done: CSS moved to files (W8), 44px targets (W5), night-safe board colours, Move to… collapse. Not restyled one by one: Budget, Insights, editor, screensaver, gate.

**v1058 desktop Install app** done 2 Nov 2026: Chrome/Edge on Mac and PC offer "Install To-Do" in the address bar (manifest, pass-through service worker, 192/512 icons). Waiting for Luc's check on his Mac/PC. Not done on purpose: offline mode (the app needs the network for every list).
**v1065 photo scan** done 7 Nov 2026: `POST /api/todos?scan=1` (photo -> Gemini -> CSV staged in `todo_scans`, `db/setup23.sql`), `GET ?scan=1`, `POST ?scan_done=<id>`, "Scan ready" bar + `?open=scan` in the app. Needs `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) set by Luc in Vercel. Tests: `tests/scan_node.js`, scan block in `tests/t_import.py`. Ideas left: progress bar, more sources for staged scans, handwriting corrections feedback.
**v1063 import upgrade** done 7 Nov 2026: editable review cards, one scroll area, skip bad rows, duplicate flags (skip/update/add), new-project flag with picker, id column + export for updates, forgiving words/times/priorities, `\|` escape. Idea left for later: add tasks straight from Claude via a share-sheet/Shortcut endpoint or connector (Luc interested).
**v1062 import copy/download of previous imports** done 7 Nov 2026.
**v1061 import: subtasks, paste mode (mobile), redesigned review, notes markdown preview** done 7 Nov 2026.
**v1060 import preview + undo** done 7 Nov 2026: preview panel (how columns were read + understood values), Previous imports list with Undo, header aliases, `db/setup21.sql`. Skill rewritten so any LLM makes a strict file.
**v1059 desktop CSV import** done 7 Nov 2026: Settings > Import on Mac/PC adds many tasks from a CSV (template download, checked before anything is added, all-or-nothing). Files for Luc: `docs/import/`. Not built (ask if wanted): recurrence end date, project-page links, duplicate detection, import of done tasks.

**Deploy G (v1055) UI round 3** done: one sans-serif look everywhere, readable Insights chart labels, full-screen button hidden on phones. Budget line-chart labels not changed.

**Deploys H and I (v1056, v1057) UI redesign** built 1 Nov 2026: Batch A (design system, lists, editor, nav) and Batch B (Work board, My projects, shared views). Not individually reworked: Budget/Insights internals, screensaver, gate (they pick up the new tokens and controls only). Next candidates: P3 density option, Work board JS heights (8a), a lighter project card, real-device pass.

## Jarvis voice-assistant API (12 Nov 2026, server only)
Done: `GET /api/todos?jarvis=1` (compact list + `q` + `id`), `GET ?activity=1`, `x-source` write log for POST/PATCH/DELETE (`db/setup25.sql`, `api/_jarvis.js`, `tests/todos_node.js`). Details: ARCHITECTURE section 5, header of `api/todos.js`.
Follow-ups Luc has not asked for yet (propose, do not build unasked):
1. **Undo**: `POST /api/todos?activity_undo=<id>` that PATCHes the logged `before` values back (or re-creates a deleted task), and logs the undo. Today the log shows what to send and Luc undoes by hand with a PATCH.
2. **Exact project names on PATCH**: canonicalise `category` for Work tasks (as POST and import do) at least for `x-source` calls. Luc's side looks names up first, so this is not needed yet.
3. **On-hold Personal Projects**: leave their tasks out of `?jarvis=1` (needs the `pproj_list` statuses), or flag them.
4. **Log more calls**: `POST ?bulk=1`, the plan save and `/api/pause` are not written to the log.
5. **A "complete by words" helper** (`POST ?jarvis=1` with words and an action) so the assistant needs one call instead of find + PATCH; only if two calls prove clumsy.
6. **One source of truth for ordering/matching**: the copies in `_jarvis.js` can drift from `core.js`/`csvimport.js`; a shared test fixture or generating one from the other would stop that.

## Jobs tab plan (agreed 14 Nov 2026, one deploy each, Luc tests between)
Dark earth-tone application tracker in the side menu. Design agreed from the mock-up sheet; stages are editable by Luc.
1. **Step 1 (v1074, built)**: tab, pipeline board with editable stages (add/rename/recolour/reorder by drag/remove, kind active/won/lost, optional follow-up days), job sheet (add/edit/move/delete, history), `POST /api/pprojects?jobs=quick` for the iPhone "Save to Jobs" Share Shortcut (not yet built on the phone: Luc sets it up), phone layout. Moving a card between stages is by tapping a stage chip in the sheet; drag-between-columns is not built.
2. **Step 2 (v1075, built; `db/setup27.sql`)**: Analytics (funnel, applications per week, time in stage, best sources, response rate) plus links to the to-do list: a next step with a date (and optional time) makes a Personal to-do (category "Job hunt"; the app's usual Apple-calendar sync handles timed ones), and a "Follow up" to-do is made `follow_days` after a job enters a stage that has it. Analytics = Board | Analytics switch on the Jobs tab, `GET ?jobs=stats`.
3. **Step 3**: LinkedIn job-alert emails read by a Google Apps Script (like the Gmail cleanup) and sent to `?jobs=quick`; Gemini (existing `GEMINI_API_KEY`) pulls role/company/place/link out of the email. No scraping or login to LinkedIn (no official jobs API; against its terms).
4. **Step 4**: Discover feed from the Adzuna API (free, env `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` set by Luc): searches for London or remote only, saved keywords, daily check, save/dismiss, fit score from Luc's skills.
5. **Step 5 (later)**: career profile (his CV facts per job, entered/edited in the app) and a "Tailor my CV" button on a job card using Gemini (free tier is fine, Luc agreed 14 Nov): may only use facts he entered, shows a diff, exports ATS and designed versions, stores the version used in `jobs.cv_variant`. Address on CVs must read "London". Never send the reference's phone number to Gemini. CV text lives in the database only, never in the repo. Luc's LinkedIn URL is `linkedin.com/in/luc-evans-10842a188`.
Searches and jobs are London or remote only.

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
