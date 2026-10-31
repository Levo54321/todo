# luc-todo — roadmap

## P0 — confirm and protect
1. **Alias check on push**: make a trivial commit and confirm `luc-todo.vercel.app` follows the git deploy (otherwise fix the project's production-domain assignment in Vercel).
2. **Real-device pass** on iPad 2 and iPhone 13 for Pause, Blocked, board drag/number reorder, Insights and the Google work-calendar prompt.
3. **Restore tests into the repo**: add a `tests/` folder with the Playwright mock harness (shot5/shot7 style) and a `npm test` script.
4. **Delete the Vercel token "pull-shop"** (created for the shop export).

## P1 — cleanup
5. Remove legacy `api/shopping.js` and the Shopping Beta wording; keep only the iframe tab.
6. Add a build/minify step (terser `--ecma 5`) in a `tools/` script so deployed JS is small again, and a lint check that rejects ES6 syntax in `public/js`.
7. Single `docs/` source of truth; keep PROJECT_INSTRUCTIONS in sync with each feature.
8. Add a GitHub Action: ES5 lint + `build.py` smoke test on PRs.

## P2 — features
9. Undo for complete/delete/pause (toast with Undo).
10. Paused tasks: optional "chase on <date>" reminder that resurfaces them.
11. Insights: per-project cycle time, paused-time breakdown ("waiting on whom").
12. Notes/attachments on Work tasks; weekly review prompt.
13. Offline queue (like the shop app's `shopQ`) so adds made without signal sync later.
14. Make time zone configurable.

## P3 — nice to have
15. Shortcuts for pause/resume and "what's due today" voice readout.
16. Split `core.js` (~100 KB) into smaller modules.
17. Surface shop shortcuts/notifications summary inside the to-do glance.
