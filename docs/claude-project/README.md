# Claude Project setup (source of truth)

What is pasted into claude.ai for the "To-Do" Claude Project. Edit here first, then paste.

| File | Where it goes in claude.ai |
|---|---|
| `INSTRUCTIONS.md` | The Project's Instructions field (whole file). Short and stable: it points sessions at `CLAUDE.md`. |
| `skills/luc-todo-maintainer/SKILL.md` | The `luc-todo-maintainer` skill in Luc's plugin |
| `skills/todo-prompt-writer/SKILL.md` | The `todo-prompt-writer` skill in Luc's plugin |

The Project should hold **no knowledge files** about the app: they go stale. Sessions read the repo instead
(`CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/API.md`, `db/`). Detailed rules and any new standing
instructions go in `CLAUDE.md`, which Claude keeps up to date.
