# Tests (mocked, no real data)

- `harness.py` serves `public/` in Chromium and answers every `/api/*` from an in-memory mock (tasks, Work projects,
  Personal Projects, Vercel picker, deploy status). It fails if the page throws or tries to reach another site.
- `t_core.py`: the flows that must never break (no Shopping tab, quick add / Shortcut POST, recurring tick, Work
  list with paused and blocked, board, Insights, Budget, Tomorrow, Settings, screensaver).
- `t_projects.py`: My projects (runs `t_core` first): statuses incl. Idea, reason, still-live warning, drag order
  (mouse and synthetic touch), project costs, account labels and icons, the vault UI, Vercel picker, fixed-height layout at 1024×768, 768×1024 and 390×844, and idle checks that
  spy on value/focus/scroll writes during the 15 s background refresh (Chrome hides iOS 9's cursor and flicker issues).
- `es5.js`: parses every `public/js/*.js` as ES5 and warns about iOS 9 gaps.
- `vault_node.js`: the vault's server-side crypto with an in-memory database (`node tests/vault_node.js`): ciphertext only,
  locked state, pass expiry, lockout, wrong pepper, reset, nothing sensitive in logs.

```
npm i --no-save acorn && node tests/es5.js public/js/*.js
pip install playwright && python3 tests/harness.py . tests/t_projects.py
```
Extend the mock in `harness.py` (`H.api`) when an endpoint changes. Add expected console errors (e.g. a deliberate 422) to
`h.allow` so real errors still fail the run. Real iPad 2 / iPhone checks are Luc's.
