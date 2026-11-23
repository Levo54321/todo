# Handover: Work Projects redesign (Mac + iPhone)

Written 23 Nov 2026 for one Claude Code session in the To-Do project. Commit this file to the repo as
`docs/handover/WORK-PROJECTS-REDESIGN.md` at the start of the session, and keep it up to date as decisions land.

## 1. Why this exists
Prompts 1 to 5 of the "Work project amendments" plan were built incrementally, one at a time and within the iPad 2 (ES5) limits.
They work, but Luc's verdict is that the project UX is poor: it reads like a form with hyperlinks, not a dedicated
work application. This session redesigns and rebuilds the whole Work Projects section from first principles,
as a world-class product designer and engineer would. Keep all existing data.

**Luc's goal in one line:** open any project and immediately understand its tasks, status, details and progress,
and jump to every resource (Linear, Slack, Prolific, Qualtrics, Sheets) in one click.

## 2. What exists today (built 22 Nov 2026, v1083 to v1087)
Read CLAUDE.md (amendment lines dated 22 Nov), docs/ARCHITECTURE.md section 3 and the v1083+ notes, and docs/ROADMAP.md "Work project amendments".
- **Data**: `work_projects` (+ `work_project_events`) since `db/setup33.sql`; `meta` jsonb (shape in the header of
  `api/_wpmeta.js`): owner/requester/recruiter (ids into `work_people`), goal, success, rag r/a/g,
  dates {requested, started, target, due}, links {slack [{n,u,init?}], groups, studies, other}, codes [{n,c}],
  client (id into `work_clients`, icons in `work_client_icons`). Status updates: `work_project_updates`,
  `work_status_state` (`db/setup36.sql`). `projects` config key is still mirrored (`wproj_mirror`) as a rollback fallback.
- **API**: everything inside `api/projects.js` (routes `?page|meta|cards|people|clients|clienticon|statusparse|updates|export`),
  helpers `api/_wpmeta.js`, `_wclients.js`, `_wstatus.js`. Still exactly 12 serverless functions.
  `GET /api/projects` keeps the OLD config-key shape. Every caller depends on it (board, Manage Projects, cmpWork, quick
  add + Shortcut `assign`, import, scan `matchProjects`, `_jarvis.js`).
- **UI (ES5)**: `public/js/board.js` (Work board), `projects.js` (Manage projects, people, clients, `App.clientLogo`),
  `wproject.js` (project page + Edit details), `wstatus.js` (Copy for Claude, Paste updates review), styles in `work.css`.
- **Format**: `docs/work-status-format.md` = `todo-status` v1 (in) and `todo-projects` v1 (out), tested by `tests/wstatus_node.js`.
- **Not built**: old Prompt 4 (Next task flag, Slack message link on Work tasks). It is now part of this redesign.

## 3. Decisions already made with Luc
- **Devices**: the Work Projects section (board, project page, edit, paste/review of updates) is for a **modern Mac
  (primary) and modern iPhone only**. The iPad 2 keeps the Work and Personal to-do lists, but the
  projects section does not need to run there. Give the iPad a clean fallback, for example Projects hidden or a short
  "Open on your Mac or iPhone" note. Personal "My projects" is out of scope.
- **Tech freedom**: modern JS/CSS is allowed for this section (ES2020+, CSS grid, sticky, container queries,
  `fetch`, clipboard API), kept separate from the ES5 app so `tests/es5.js` and the iPad stay safe. A suggested route
  for the session to weigh in its plan: a module loaded with `<script type="module">` inside the same shell (iOS 9 ignores it), so
  token, rail, polling, `App.api` and the task editor are shared. A separate page is the alternative. Same repo, API,
  token and database either way, and still 12 functions.
- **Redesign depth**: drastic. Not limited by today's layout, classes or data shape, and it may go deeper than HTML
  (data model, API, export/import contract). It must not lose data.
- **Next task**: one per project (stored on the project), pinned at the top of its column/page, with no change to
  Work list ordering or counts. When it is completed, deleted or moved, it is cleared and the app offers "pick the next task".
- **Slack message link on Work tasks**: optional, https, shown as an icon that opens the link. Keep it on repeat copies.
- RAG stays Luc's call: a pasted update only *suggests* it.

## 4. Luc's feedback (23 Nov), to design against
1. Optimise for a modern Mac, not the iPad 2.
2. Links are hidden below the details. Both links and details are used constantly, so the layout must surface both. The session should scope this (e.g. a resource bar, a two-pane layout or a sidebar).
3. The initial-request Slack link needs no name: call it **Request link**.
4. Linking works, but it looks bad as bare hyperlinks. The whole left details panel should look like a dedicated app (service
   icons/favicons, labelled chips, copy buttons, IDs shown).
5. Editing is Mac-only and today's Edit details form is bulky and ugly. Make editing fast and light (inline editing,
   keyboard-friendly, paste-to-fill).
6. **Linear issue is a first-class field**. Links always look like
   `https://linear.app/prolific/issue/HDOR-394/uber-users-in-new-orleans-and-san-fran`. Pasting one auto-fills
   **Issue ID** `HDOR-394` (the link's display name) and **request title** from the slug
   ("Uber users in New Orleans and San Fran"; the slug loses capitals, so work Claude may correct the exact title later).
   Pattern: `/issue/(HDOR-\d+)/(slug)`. Allow other team prefixes defensively.
7. Work Claude (Prolific account, Slack + Linear connectors, skills only, no custom connectors) will later fill fields
   from the ticket and threads: requester, deadline, started/target/due dates, revenue, description (kept verbatim, and also
   parsed for extra facts), ticket status, SLA deadline, latest metrics. It reads the full Slack thread via the Linear
   comments and any linked channels. **Progress metric**: e.g. requested 100, last Slack message says 50 delivered, so 50%.
8. Pull in the **Linear ticket status** and **SLA deadlines**.
9. The skill will also **write to Linear**: move the ticket status when Slack says delivered, and fill the ticket's
   "Participants provided/supplied" section in this exact format:
   ```
   Participants provided/supplied
   - Number: Sacramento: 530 participants (396 ID approved); New Orleans: 261 participants (195 ID approved)
   - Group ID (s):
   - Participant Source:
   Relevant Links
   - Qualtrics:
   - Prolific:
   - Google Sheet:
   ```
   The links data flows from the app to Claude (export), then to Linear. Slack delivers the counts, which go to both the ticket and the app.
10. The whole Work projects experience should feel professionally designed, intuitive and useful on Mac and iPhone.
11. Audit the current UX first and be honest about it.

Feature ideas Luc mentioned as examples only, not a spec: "last update", "last Slack message sent". The session
should propose its own improvements too.

## 5. Data the redesign must support (session finalises names and shape)
Existing fields stay. Additions to scope:
- **Linear**: issue id, url, title, ticket status, SLA due, revenue, description (verbatim), last synced at.
- **Deliverables / progress**: a list of segments, e.g. `[{segment:"Sacramento", requested:600, provided:530, approved:396}]`,
  with totals and % shown. Accept a single total when there are no segments.
- **Participants section inputs**: Group ID(s) (plain codes, several), Participant Source, Qualtrics link(s), Prolific
  link(s) (today's groups/studies links may map here, so check with Luc), Google Sheet link(s).
- **Request link** (unnamed) + related Slack channels/threads (named).
- **Activity signals**: last update (date + headline), last Slack message (when, who, where, link) as reported by Claude,
  last task activity, field provenance (who or what set each value: Luc, or Claude plus its source link, and when).
- Next task pointer; per-task Slack link.
- Migration: map old meta into the new shape with nothing dropped (e.g. `slack[init]` becomes the request link, an
  `other` link matching `linear.app/.../issue/` becomes the Linear field). Do a dry run and show Luc a before/after.

## 6. The contract with work Claude (design it here; the skill is built later in another thread)
- **Export (todo-projects v2)**: everything Claude needs to read the ticket and threads and to write the Participants
  section: project id, name, Linear id/url, request link, related Slack, group IDs, participant source, Qualtrics /
  Prolific / Sheet links, current field values with their provenance, last sync time, deliverable segments.
- **Import (todo-status v2)**: the status update (as v1) **plus field proposals**: `{field, value, source link, note}`
  for any field (dates, requester, revenue, Linear status, SLA, deliverables, last Slack message), and a record of
  what Claude wrote back to Linear (status change, Participants text) so the app can show "Ticket updated".
  The review screen should show a per-field diff (current vs proposed, source link, accept toggle), quick to scan on Mac and usable on iPhone.
- Keep `v1` pastes accepted for at least one release; bump the version for the breaking change; update
  `docs/work-status-format.md` and `tests/wstatus_node.js` together.
- Write `docs/work-claude-skill-brief.md`: a self-contained brief for the later thread that builds the work-Claude
  skill (inputs, what to read in Linear/Slack, the exact output block, the Linear write-back rules and the Participants format
  above, scheduled weekly run with the export pasted into the task prompt, never invent numbers, cite sources).

## 7. Constraints that still apply
- Shared Supabase database: never touch `shop_*` or the `shop` config key. Record shop row counts and the latest
  holmlodge-shop production deployment before and after any migration.
- 12 serverless functions max: add routes to existing files, with shared code in `api/_*.js`.
- Work to-do list, quick add + iPhone Shortcut (`POST /api/todos`, `POST /api/projects {name, assign}`), cmpWork,
  pause/blocked, calendar sync, import, scan and the Jarvis API keep working, including on the iPad 2.
- Keep the `GET /api/projects` response shape (or change every caller deliberately and test each).
- Next numbered `db/setupNN.sql` (37 onwards), idempotent, tested in `begin; … rollback;` first.
- Commit with the GitHub-linked identity; confirm READY + alias after each push; bump `?v=`.
- Update CLAUDE.md (amendment line + new rules for the modern section), ARCHITECTURE, ROADMAP, API.md.

## 8. Session log (kept current)
- 23 Nov 2026 — Stage 1 (audit) done: `docs/handover/AUDIT-WORK-PROJECTS.md` with screenshots in `docs/handover/audit/`. Waiting for Luc's OK before stage 2 (design proposal).
- Skills loaded this session: luc-todo-maintainer, frontend-design, apple-design, dashboard-design.
- 23 Nov 2026 — Stage 2 (design proposal) done: `docs/handover/DESIGN-PROPOSAL.md`, mock-ups in `docs/handover/mockups/` (A Split desk, B Briefing, C Night ledger). Recommendation: A layout in warm paper, C as night theme, ES module inside the shell, additive data v2, contract v2. Waiting for Luc's pick (six decisions in section 9) before stage 3.
- 23 Nov 2026 — Luc's answers to stage 2: direction A (list always visible; clicking a project replaces the overview on the right, the list stays); the overview shows the **deadline** (`dates.due`), not the SLA; keep the task columns as a second view but redesign them cleaner and closer to UI best practice; Groups/Studies links become Prolific group/study links whose IDs are read from the link (text after the last `/`, optionally followed by `/overview`) and can be edited by hand; progress = delivered / requested; slug title with place-name capitals is fine; the legacy ES5 build must keep working on the same data (so the iPad can still reach it).
- 23 Nov 2026 — Stage 3(a) built, NOT applied: the Supabase connector refused every query (permission), so no live baseline, backup, dry run or apply yet. Design change to keep the legacy UI on the same data: no new resources table; link kind/ID live on the existing `meta.links` rows, plus `meta.linear/particip/deliver/activity/prov`; SQL is only `db/setup37.sql` (field log + `next_task_id`). Code: `api/_wlinks.js`, `api/_wv2.js`, `_wpmeta.js`, `projects.js` (enrich on save), `tools/wv2_migrate.js`, `tests/wv2_node.js`. Steps for when the connector works: `docs/handover/MIGRATION-V2-RUNBOOK.md`.
- 23 Nov 2026 — Connector back. Baseline, backup (verified), dry run on the real 15 projects (3 change, 0 links lost) and a rolled-back test of setup37 + the apply script all done; waiting for Luc's OK to apply. Projects without links are no longer touched.
