# Audit: Work Projects section as built at v1087 (23 Nov 2026)

Stage 1 of `WORK-PROJECTS-REDESIGN.md`. Report only: nothing was changed in the app.

**How this was done.** The real built app (`public/index.html`, v1087) ran in Chromium with every `/api/*` call mocked. The mock held 7
Prolific-style projects (Uber drivers NOLA + SF, Gig workers US panel, ...), 3 to 6 tasks each, two clients, people, a
Linear `HDOR-` link, Slack/Prolific/Qualtrics/Sheet links, dates, codes and one status update. Screens were captured at Mac 1440x900 and
iPhone 390x844 (light theme). Measurements come from the same run. Screenshots are in `docs/handover/audit/`.
Not tested: a real Mac Safari/Chrome session on Luc's own data, a real iPhone.

## Verdict
**Works, but it is a form with hyperlinks, as Luc said.** Nothing is broken; the structure is wrong. The project page is a
narrow details sidebar next to a task list, with the resources hidden at the bottom of a second scroller. The board
shows a task list per project but nothing about progress, the ticket, or where the work lives. Editing is one 30-field form.
The data model stores everything in a loose `meta` blob, which cannot carry progress, the ticket, provenance or a field-by-field import.

## What works (keep)
- The Board column idea: one column per project, tasks in their own order, Next up marker, RAG dot, client chip, overdue/due-today pills. It is a sound base.
- The client icon, the people list and the "Copy for Claude / Paste updates" flow exist and are tested.
- Task ticking, add-task box, drag order, Move to... reuse core and keep Work list behaviour identical. These stay.
- Status updates are stored per project with the suggested RAG, and "Accept RAG" is opt-in. That rule is right and stays.

## Ranked problems (worst first)

### 1. Links and details are not one glance away (Luc's #2). Severity: high
Evidence (`audit/mac-page.jpg`, `audit/mac-page-scrolled.jpg`): the left details panel is 1451 px tall inside a 737 px viewport
pane. The Slack, Prolific Groups and Other links headings start at 826, 952 and 1161 px down. At 1440x900 that means **none of
the resources are visible on opening a project**; Luc has to scroll a second, nested scroller. On iPhone the whole page is 2944 px tall and
the links are under RAG, Priority, Status, People, Dates, Goal and Success.
Why: the sidebar is ordered by data type (RAG, priority, status, people, dates, goal, success, then links), not by how often it is used.
Resources are not a first-class object, they are a list under a heading.

### 2. Links look like bare hyperlinks (Luc's #4). Severity: high
Evidence (`audit/mac-edit-scrolled.jpg` left panel): each link is a blue bold word ("Linear", "Qualtrics", "Sheet") with a hairline between.
No service icon, no ID, no host, no copy button, no "opens Linear" cue. The Linear link shows "Linear", not `HDOR-394`. Slack links all
look the same whatever they are. You cannot tell a Qualtrics form from a Google Sheet without clicking.

### 3. The Linear ticket is not a field (Luc's #6). Severity: high
It is "an Other link named Linear". No issue ID, no title, no ticket status, no SLA, no revenue. Pasting a Linear URL
does nothing: the user types a name and pastes the URL into two separate boxes (`mac-edit-scrolled.jpg`). The `HDOR-394` and the title that is already in the URL are thrown away.

### 4. Editing is a bulky form (Luc's #5). Severity: high
Evidence (`audit/mac-edit.jpg`): Edit details replaces the whole main area with 30 inputs, 1719 px tall (2346 px on iPhone). It has a separate
Save/Cancel at the very bottom, one label + one name box + one URL box + one red x per link, and dates as native pickers. You edit everything or nothing,
one save for the lot. There is no keyboard flow, no paste-to-fill, no per-field saving, no undo.

### 5. The board shows tasks, not projects. Severity: high
Evidence (`audit/mac-board.jpg`): at 1440x900 the first project column starts at y=299, so **a third of the screen is chrome**
(clock, title, Work|Personal, Board|Insights, three buttons, a client filter row, counts, a legend, an instruction sentence). Columns are 310 px wide, so
titles and tasks wrap onto 2 to 3 lines (task rows are 152 px tall on Mac). Four columns fit. A project header carries a RAG dot, priority pill, open count, owner first name, due, client; there is no progress, no ticket status, no last update,
no resource links, no "what is the next thing". To see how a project is doing you open the page.

### 6. The project page has no "state of play". Severity: medium-high
Order on the page: RAG/priority/status selectors, people, dates, goal, then the task list, then status updates, then activity.
Nothing summarises "where is this and what is next". The latest update (the most useful content) is below the task list. Three selectors (RAG, Priority, Status) are
giant segmented controls taking ~400 px of the sidebar even though they change rarely.

### 7. No progress or numbers anywhere (Luc's #7). Severity: medium-high
There is no place for "requested 600, provided 530, 396 ID approved". It cannot be shown, edited, imported or exported.

### 8. Paste updates is a dead end screen. Severity: medium
Evidence (`audit/mac-paste.jpg`): an empty screen with one sentence and two buttons. After a paste you get review cards that offer Accept RAG and Save only.
There is no per-field diff, because the format has nothing but a status update. No way to see "what Claude changed in Linear".

### 9. Chrome and structure details. Severity: medium
- The app clock/date header (about 100 px) sits above the page on Mac and is repeated on every project screen; the Work|Personal switch
  and Board|Insights tabs add two more rows before content.
- The project name appears three times on the page (title bar, sidebar, add-task placeholder).
- The "Done in the last 30 days" toggle and the "Activity" log are default-open noise at the bottom.
- Sources of an update are rendered as two lines per link with large gaps (`mac-page-scrolled.jpg`).
- The Back button and Edit details are far apart at the page edges; Edit details is a plain tint, not an obvious action.
- Dead space: the page content area is 970 px wide on a 1440 screen but the update card stretches full width, so lines run to ~150 characters.

### 10. iPhone. Severity: medium
Evidence (`audit/iphone-sheet.jpg`): the board is one very long vertical column list with the toolbar taking the first 485 px
(the first project starts at y=485 of 844). The project page is one long scroll with details first and tasks, updates last.
Tap targets are fine (44 px, previously enforced). The page is readable but not designed for a phone: nothing is reachable in one tap.

### 11. Not built: Next task flag and Slack link per task. Severity: medium
The old Prompt 4 items are absent; they are part of this redesign.

## Constraint that explains a lot (and goes away)
Everything is written for iOS 9: no CSS grid, sticky, container queries, `fetch`. That is why the page is a floated sidebar plus main,
with nested scrollers and button-based segmented controls, and why a calm multi-pane layout was never tried. Luc has now
released the Work Projects section from that, so layout (grid, sticky headers, a split view) and interaction (inline editing, keyboard, popovers) can be done properly.

## Grade: data model against brief sections 4 to 6

| Area | Grade | Why |
|---|---|---|
| Project identity, status, priority, task order | **A-** | Proper table, ids, events. Task link by name (`todos.category`) is fragile but works and must stay for the iPad lists. |
| `meta` jsonb for details | **C** | Flexible, but one blob: no per-field provenance, no history of values, no types for Linear, deliverables or ticket status. A value cannot say "Claude set this from this link on this date". `wproj_meta_put` merges top-level keys only, so one stale form can overwrite a nested key. |
| Links | **D** | Four buckets of `{n,u}`. Meaning is carried by the label text the user typed ("Linear", "Request"). No service type, no id, no copy. The Initial request is a flag on a Slack row. |
| Linear / SLA / ticket status / revenue | **F** | Not modelled (brief #6, #8). |
| Deliverables / progress | **F** | Not modelled (brief #7). |
| Participants-section inputs (Group IDs, Source, Qualtrics, Prolific, Sheet) | **D** | Groups and Studies links exist; Group IDs (plain codes), Participant Source, Qualtrics and Sheet have no field. "Campaign codes" is the nearest thing. |
| Activity signals (last Slack message, last sync) | **D** | Only "last update" exists, and it is derived from status updates. No last Slack message, no field provenance. |
| Event log | **B-** | Logs that `details` changed, with the key names but not old/new values, so no real history of a field. |
| Status updates table | **B+** | Good and reusable: headline, lists, suggested RAG, sources. Keep and extend. |
| Export `todo-projects` v1 | **C-** | Gives id, name, status, rag, owner/requester names, Slack list, "links", last update. Missing: Linear id/url, dates, goal, Prolific/Qualtrics/Sheet links as distinct things, group IDs, source, deliverables, provenance, last sync. Work Claude cannot write the Participants section from it. |
| Import `todo-status` v1 | **C** | Safe parser, caps, all-or-nothing. But it can only carry a status update. No field proposals, no source link per value, no record of what Claude wrote to Linear, so no per-field diff. |
| API / functions | **B+** | Clean routes, 12 functions kept, shape of `GET /api/projects` preserved. Needs new routes added to existing files only. |

## What this means for the design (input to stage 2)
1. Resources need to be a permanent bar or panel, always visible, with service icons, IDs, copy and open. Details beside them, same screen.
2. Linear becomes a typed first-class field (id, title, url, status, SLA, revenue) filled by pasting one URL.
3. Add deliverable segments and a progress figure, and show them on the board header.
4. Replace the 30-field form with inline editing, field by field, with paste-to-fill.
5. Give every value a provenance (Luc, or Claude plus a source link and date) so imports can be reviewed per field.
6. Move the data from the `meta` blob to a v2 shape (still in `meta`, or new columns/tables); decide in stage 2.
7. Contract v2: export everything Claude needs, import status update plus field proposals plus a "written to Linear" record; keep v1 accepted.
