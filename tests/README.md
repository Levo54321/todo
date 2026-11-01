# Tests (mocked, no real data)

- `harness.py` serves `public/` in Chromium and answers every `/api/*` from an in-memory mock (tasks, Work projects,
  Personal Projects, Vercel picker, deploy status). It fails if the page throws or tries to reach another site.
- `t_core.py`: the flows that must never break (no Shopping tab, quick add / Shortcut POST, recurring tick, Work
  list with paused and blocked, board, Insights, Budget, Tomorrow, Settings, screensaver).
- `t_projects.py`: My projects (runs `t_core` first).
- `es5.js`: parses every `public/js/*.js` as ES5 and warns about iOS 9 gaps.

```
npm i --no-save acorn && node tests/es5.js public/js/*.js
pip install playwright && python3 tests/harness.py . tests/t_projects.py
```
Extend the mock in `harness.py` (`H.api`) when an endpoint changes. Real iPad 2 / iPhone checks are Luc's.
