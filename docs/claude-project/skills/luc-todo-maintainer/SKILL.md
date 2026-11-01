---
name: "luc-todo-maintainer"
description: "Use when changing, debugging or deploying Luc's luc-todo app (ES5 iPad/iPhone to-do, Vercel + Supabase, Levo54321/todo)."
---

# luc-todo maintainer

The detailed, current instructions live in the repo, not in this skill, so this skill rarely needs changing.

## Start of every session
1. Attach the private repo `Levo54321/todo` and clone it (shallow is fine).
2. Read `CLAUDE.md` at the repo root first. It holds the hard constraints, stack, workflow, test approach,
   commit identity, deploy checks, pitfalls and Luc's standing instructions (Amendments log).
3. Then read what the task needs from `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/API.md` and `db/`.
   Trust the repo over anything older (project knowledge files, earlier chats, memory).

## Non-negotiables (repeated here in case CLAUDE.md cannot be read)
- Frontend ES5 only; it must run on an iPad 2 (iOS 9.3.5). Bump the `?v=` cache buster on frontend changes.
- Browser → `/api/*` → Supabase security-definer RPCs only. Secrets only in Vercel env vars.
- The Supabase project is shared with holmlodge-shop: never touch `shop_*` objects, the `shop` config key, its
  endpoints, repo or Vercel project.
- Test with mocked Playwright before pushing; after pushing confirm the deployment is READY and that
  `luc-todo.vercel.app` points at it.

## End of every change
Update `CLAUDE.md` (standing instructions, pitfalls, Amendments log), `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
and regenerate `docs/API.md` (`python3 tools/gen_api_doc.py`) in the same commit or a small docs commit. Never ask
Luc to re-upload docs to the Claude Project.

If CLAUDE.md asks for something this skill does not mention, follow CLAUDE.md. If this skill itself needs to
change, update `docs/claude-project/skills/luc-todo-maintainer/SKILL.md` in the repo and tell Luc to paste it into
the plugin.
