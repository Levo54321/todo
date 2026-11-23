# Design proposal: Work Projects redesign (stage 2, 23 Nov 2026)

Input: `WORK-PROJECTS-REDESIGN.md` and `AUDIT-WORK-PROJECTS.md`. Nothing is built yet.
Mock-ups (static HTML with Prolific-style mock data; open them in a browser): `mockups/A-split-desk.html`, `mockups/B-briefing.html`, `mockups/C-night-ledger.html`.
Each shows the Mac overview, the Mac project page and two iPhone screens. PNGs of every screen sit beside them.
Names, numbers and links in the mock-ups are invented (placeholder service tiles stand in for real icons).

## 1. Recommendation in five lines
1. **Layout A (Split desk)**: a project list that stays on screen, the project in the middle, a details inspector on the right, resources in a bar pinned under the title.
2. **Skin**: the app's own warm paper and Work green (not A's cool grey), so Projects does not feel like a different app. C's dark palette becomes the night theme.
3. **Overview replaces the column board** as the default screen: one row per project with progress, ticket, SLA, next task, last update. The task columns stay available as a second view ("Task board").
4. **Linear is a field.** Paste a Linear URL anywhere on a project: Issue ID and title fill themselves.
5. **Modern ES module inside the existing shell**, one new migration, contract v2 with a per-field review. Still 12 functions.

## 2. Information architecture

### Where things live
| Thing | Where | Why |
|---|---|---|
| All projects, at a glance | **Overview** (list rows: client icon, name, RAG, ticket ID, SLA, delivered bar and %, next task, days since update) | The first question is "which project needs me", answered without opening anything |
| Switching project | The list stays at the left of the project page | One click, no Back button |
| Title, RAG, ticket status, SLA countdown, requester, owner, revenue | **Header facts line** of the project page | Read in one glance, editable inline |
| **Resources** (Request link, Linear, Slack threads, Prolific, Qualtrics, Sheets) | **Resource bar pinned under the title** (always visible, does not scroll away); each chip = service icon + label/ID + open; copy on hover/right-click | Links are used constantly, so they are never below the fold |
| **Details** (dates, people, ticket block, Participants inputs, goal) | **Inspector at the right**, always visible on a Mac | Details and links both on screen together |
| Progress | **Card at the top of the main column**: total %, delivered vs requested vs ID-approved, one bar per segment | Core number of the job |
| Next task and tasks | Main column: Next up card pinned first, then the task list | The work itself |
| Latest update, last Slack message | Main column under tasks | "What changed" |
| History | Collapsed "Activity" at the end, now including field changes with who set them | Audit trail |

### Overview
- Default: **List** (rows sorted by SLA, then RAG). Optional **Table** (C's sortable ledger) and **Task board** (today's columns, rebuilt: narrow chrome, Next up pinned, same ordering and drag).
- Filters: client chips, status (Active / On hold / Done), search. Keyboard: `/` search, `J`/`K` move, `Enter` open.
- A "Needs attention" strip: SLA within 3 days, red projects, no update for 7+ days, overdue tasks.
- The big clock/greeting header is hidden on this section; the rail stays.

### Project page structure (Mac 1440x900, no scrolling needed to see all of the following)
```
| list 340 | ‹ Work projects › Uber                                         E Edit |
|          | [U] Uber users in New Orleans and San Fran      ● Amber               |
|          | HDOR-394 [In progress]  SLA Fri 27 Nov · 4 days  Requester  Owner  $   |
|          | [Request link][HDOR-394][#ops-recruitment][3 studies][Qualtrics][Sheet] |
|          | 79%  791 of 1,000   SF 530/600 ▮▮▮▯   NOLA 261/400 ▮▮▯▯   | DETAILS    |
|          | Tasks (Next up pinned)                                      | Dates      |
|          | Latest update · Last Slack message                          | Ticket     |
|          |                                                             | Participants|
```
Sections of the page, in order of importance for Luc: facts + resources + progress, then tasks, then update, then the rest.

## 3. Visual directions (rendered in `mockups/`)
| | A. Split desk | B. Briefing | C. Night ledger |
|---|---|---|---|
| Idea | Mac-native master-detail | A brief you read top to bottom | Dense ops tool |
| Resources | Horizontal bar under the title | Shelf of 6 cards (open, copy) | Permanent vertical rail on the left, grouped by service |
| Details | Right inspector | Strip of three cards + brief block | Right panel |
| Overview | List + "needs attention" | Card grid | Sortable ledger table |
| Look | Cool light, system sans, green accent | Warm paper, serif titles, today's identity | Graphite, mono IDs, green/amber/red |
| Strength | Fastest switching and scanning; links and details always in view | Most readable; calm | Densest; ID-first; reads like Linear |
| Weakness | List column uses 340px of width | Shelf is big; the page needs scrolling on small Macs; overview shows less | Heaviest to look at all day; wider rail leaves less room for tasks |

**My pick: A's layout, in the app's warm paper tokens, with C as the night theme and B's shelf idea kept as an option inside the resource bar (card view when a project has many links).** Reason: the audit's top problem is "links and details not one glance away"; A solves it with the least scrolling and best switching, and C's rail is a stronger version of the same idea that I can offer as a setting later.

## 4. Editing model (Mac)
- **Everything is click-to-edit in place.** Click the status pill, SLA, requester, a date, revenue, goal: it becomes an input where it sits; `Enter` or click away saves that one field, `Esc` cancels; `Tab` goes to the next field. No form, no Save button. Each save shows a small "Undo" toast (the app already has `App.toast(msg, undo)`).
- **Paste anywhere** (`Cmd+V` when no field is focused, or the "+ Paste a link" chip) classifies the URL:
  - Linear `…/issue/HDOR-394/slug`: sets Linear URL, **Issue ID** `HDOR-394` (the chip's label) and **title** from the slug.
  - Slack message/thread: asks one question inline: "Request link" or "Related thread" (first Slack link defaults to Request).
  - `app.prolific.com`: study or group chip (group ID extracted when the URL has one).
  - Qualtrics, Google Sheets: chip with the right icon.
  - Anything else: "Other link", with the host as label.
- **Request link needs no name** (Luc #3). Other links get an auto label (host, ID or page title) that can be renamed by clicking.
- **Deliverables**: click a segment's numbers to edit (`requested / provided / approved`), `+ segment` adds a row; with no segments, a single total.
- **Group IDs**: type or paste several (space, comma or newline); each becomes a copyable code chip.
- **Keyboard**: `N` new task, `E` edit title, `L` focus resource paste, `[`/`]` previous/next project, `Cmd+K` jump to a project or action, `?` shortcut sheet. All shortcuts are Mac only.
- **Provenance dots** next to a value (grey = Luc, purple = Claude, hover shows the source link and date). They are quiet by default.
- **Priority, Status and RAG** become small menus in the header (rarely changed), not 400px of segmented controls.
- Today's "Edit details" button and form are removed. Manage projects (rename, people, clients, new project) stays, restyled.

## 5. iPhone (390x844)
- **Overview** = project cards: icon, name, RAG, ticket + SLA, delivered bar and %, **Next task**. Tap opens the project.
- **Project page**: compact header (icon, title, `HDOR-394` + status, RAG, SLA). **Resource chips scroll sideways and stay pinned** under the header, one tap opens each. Segmented tabs **Tasks | Details | Updates**; Tasks is the default, with progress then Next up. A floating `+` adds a task.
- Details and the latest update live in their tabs; no 2,900px scroll.
- Editing on iPhone is allowed for simple things (tick, add task, RAG, copy a link, paste a link into the chip, accept an import diff) but the full inline editor is a Mac feature; Luc said editing is Mac-only. Tap targets stay 44px.
- Pasting a Linear/Slack link on iPhone works through the "+ Paste a link" chip (clipboard permission prompt on iOS).

## 6. iPad 2 fallback
- The Work and Personal lists, quick add, pause/blocked, Jarvis, calendar, import and scan are untouched.
- The **Projects** rail tab on an iPad 2 (no ES module support) opens a plain page: "Projects is available on your Mac and iPhone." with a link back to the Work list. Feature test, not user-agent: `'noModule' in HTMLScriptElement.prototype` is false on iOS 9 and old Safari.
- Quick add's project picker and the Shortcut `assign` keep reading `GET /api/projects` (unchanged shape).
- My projects (Personal) is out of scope and unchanged.

## 7. My own ideas (all optional, none in the build unless you say so)
1. **Copy "Participants" text**: one button that writes the exact Linear block (`Participants provided/supplied`, Number: ... , Group ID (s), Participant Source, Relevant Links) from the app's own numbers and links. Useful even before the work-Claude skill exists.
2. **SLA countdown and stale flag**: "4 days to SLA", and "No update in 9 days" on the overview. Sort by SLA.
3. **Open all resources** (one click, Mac) and **copy all links** as text.
4. **Command palette `Cmd+K`** (jump to a project, add a link, copy a resource).
5. **Monday view**: the overview filtered to "needs me this week" with last Slack message and delta since last Monday.
6. **Delivery pace**: a projected finish date from progress against started date ("at this pace: 2 Dec, SLA 27 Nov"). Only shown when there are at least two data points; never invents numbers.
7. **Dark theme** using C's palette (the app already has `html.night`).
8. **Table view** with sortable columns (C's overview).

## 8. Technical plan

### 8.1 Modern module or separate page? (decision for the plan)
**Recommendation: an ES module inside the existing shell**, in a new folder `public/wp/` (so `tests/es5.js` over `public/js/*.js` is untouched), loaded from `shell.html` with `<script type="module" src="/wp/main.js?v=<ver>">`.
- Shared for free: token (`App.token()`), rail and navigation, 30 s polling and `App.todos()`, the task editor sheet, ticking and `cmpWork` ordering, toasts, night theme.
- iOS 9 ignores `type="module"`, so the iPad never loads it and the shell shows the fallback page. The modules use ES2022 and `fetch`, so they must pass a new check: `acorn` with `ecmaVersion: 2022, sourceType: "module"`, added next to `es5.js`.
- Alternative (separate `work.html`): cleaner isolation, but it would need its own task editor, ordering and polling, and duplicated token handling. More code, more drift from the Work list. Rejected unless you prefer it.
- Old ES5 files `board.js`, `wproject.js`, `wstatus.js` (and the Work parts of `projects.js`) stay in place, hidden on Mac, until the new section has run for about two weeks, then are removed in a small cleanup deploy. That keeps rollback to one config flip.

### 8.2 Data model v2 (`db/setup37.sql` onward; additive, nothing dropped)
New or changed (all idempotent, RLS on, reached only through token-checked RPCs; no `shop_*` objects touched):
- `work_projects`: add `next_task_id uuid` (nullable), `d jsonb` (v2 scalar fields: `linear{id,url,title,status,sla_due,revenue,description,synced}`, `particip{source,group_ids[]}`, `activity{last_slack{at,who,where,url,text}}`) and `prov jsonb` (`{field path: {by:"luc"|"claude"|"auto", src?, at}}`). `meta` is **kept** (owner, requester, recruiter, goal, success, rag, dates, client, codes, old links) and stays the source for those fields; `d` holds only what is new.
- `work_resources(id, project_id, kind, label, url, ext_id, role, pos, by, src, at)`: typed links. `kind` in `request | slack | linear | prolific_group | prolific_study | qualtrics | sheet | other`; `ext_id` is the Linear ID or a Prolific ID; exactly one `request` per project.
- `work_deliverables(id, project_id, segment, requested, provided, approved, pos, by, src, at)`.
- `work_field_log(id, project_id, field, old jsonb, new jsonb, by, src, note, at)`: every field change with who made it (this is also what shows "Ticket updated" after an import).
- `todos.slack_url text` (nullable, https, at most 500 characters).
- **Mirror for rollback**: for one release, edits made in the new section to shared fields are also written back into `meta` and `meta.links` (same idea as `wproj_mirror`), so rolling back loses nothing.
- **Next task rule**: stored as `next_task_id`; validated on read (the task must exist, be open, and still be in this project). If not, it is treated as cleared and the app offers "Pick the next task". No change to the hot `todo_*` RPCs, Work ordering or counts.
- **Slack link on a task and repeats**: the repeat-copy lives inside the live `todo_update` function. I will read the live definition first, re-create it with `slack_url` copied, and test inside `begin; … rollback;`. `api/todos.js` POST/PATCH accept and return `slack_url`; the Jarvis API and polling fingerprint stay as they are (checked by `node tests/todos_node.js`). The ES5 task editor gets one optional field for Work tasks.
- RPCs (new): `wp2_overview`, `wp2_get`, `wp2_patch` (field list with `by`/`src`, logs each change), `wp2_res_save/remove/order`, `wp2_deliv_save`, `wp2_next_set`, plus `wp2_migrate_dry` for the preview.

### 8.3 Migration (dry run before anything is written)
| Old | New |
|---|---|
| `links.slack[init=true]` | `work_resources` kind `request` (no name) |
| other `links.slack` | kind `slack`, label kept |
| `links.groups` / `links.studies` | kind `prolific_group` / `prolific_study`, label kept (**to confirm**, see section 9) |
| `links.other` matching `linear.app/.../issue/` | `d.linear` (id, url, title from slug) and kind `linear` |
| `links.other`, host `*.qualtrics.com` / `docs.google.com/spreadsheets` | kind `qualtrics` / `sheet` |
| any other `links.other` | kind `other`, label kept |
| `codes` | unchanged in `meta` (shown as "Campaign codes") |
| owner, requester, recruiter, goal, success, rag, dates, client | unchanged in `meta` |
Steps: (1) back up every `work_*` table to `work_bak_20261123_*` copies; (2) record `shop_*` row counts and the latest holmlodge-shop production deployment; (3) run `wp2_migrate_dry()` in a rolled-back transaction and show **before/after for every project**; (4) apply on your OK; (5) re-count and compare; (6) every old link must appear in exactly one new place (a test counts them).

### 8.4 Linear link parsing
Pattern `/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/([^/?#]+))?/` (any team prefix, not only `HDOR`). Issue ID is upper-cased. Title comes from the slug: hyphens to spaces, first letter capital, then a small list capitalises known place names and acronyms (New Orleans, San Fran, UK, US, ...). With that list `uber-users-in-new-orleans-and-san-fran` gives "Uber users in New Orleans and San Fran" (your example). A slug cannot recover every capital, so the title is stored with provenance `auto`, shown as "from link", and work Claude can correct it later. The same fixture table runs against the browser and server copies of the parser.

### 8.5 Contract v2 (summary; the full format goes in `docs/work-status-format.md` at stage 4)
- **Export `todo-projects` v2**: per project: id, name, status, rag, client, owner, requester, recruiter, goal, success, dates, `linear{id,url,title,status,sla_due,revenue,synced}`, `request`, typed `resources[]`, `group_ids[]`, `source`, `deliverables[]`, `last`, `last_slack`, and `prov` (per field: by, source, date). Enough for work Claude to read the ticket and threads and to write the Participants section.
- **Import `todo-status` v2**: everything in v1 plus per project `fields:[{field, value, source, note}]` and `linear_writeback:{status:{from,to}, participants_text, at, source}`. Field names are an allow-list (dates, requester by name, revenue, Linear status/SLA/title/description, deliverables, last Slack message, source, group IDs).
- **Review screen**: one row per proposed field: current value (and who set it) against the proposal, source link, an accept toggle (on by default for empty fields, **off** by default where a value Luc set would be overwritten). RAG is still only a suggestion. "Ticket updated" appears from `linear_writeback`.
- `v1` pastes keep being accepted for at least one release; `v` other than 1 or 2 is refused. Parser, format doc and `tests/wstatus_node.js` change together.

### 8.6 Functions, tests and deploy order
- **Still 12 functions**: new routes inside `api/projects.js` (`?v2=…`, `?res=`, `?deliv=`, `?next=`), code in new `api/_wv2.js` and `api/_wlinks.js`.
- **Deploys (each can be rolled back)**: (a) migration + API only (no UI change); (b) new section: overview, project page, inline editing, Next task, Slack link on Work tasks, iPad fallback; (c) contract v2 export/import and review; (d) polish and docs.
- **Tests**: node tests for the migration mapping, Linear parsing (including your HDOR-394 example), contract v1 + v2 parsing, next-task validation; Playwright (mocked `/api`) at 1440x900 and 390x844 for the new section; the full existing suite (this touches shared data); `es5.js` on `public/js/*.js` plus the new module syntax check.
- **Cannot be tested here**: your real data in the live database (the dry run shows it), the real iPad 2 fallback, iPhone clipboard prompt, real Mac Safari rendering, real work-Claude output.

## 9. Decisions I need from you
1. **Direction**: A layout in warm paper (my pick), or B, or C? Mix welcome.
2. **Task board**: keep today's task columns as a second view next to the overview (my pick), or drop them?
3. **Groups and Studies links**: map them to the new Prolific resources (groups to Prolific group, studies to Prolific study, labels kept)? And do you want "Group IDs" to be typed codes only, with no automatic extraction from URLs?
4. **iPad**: Projects shows a short note and the old ES5 pages stay hidden for two weeks before deletion (my pick), or hide nothing until you say?
5. **Progress %** = delivered / requested, with ID-approved shown beside it (my pick). Say if you want approved/requested as the headline instead.
6. **Linear title**: OK to store the slug title with a small capitals list, marked "from link, may be corrected by work Claude"?
