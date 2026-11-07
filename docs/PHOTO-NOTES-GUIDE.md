# Writing notes the scanner can read (v1067)

Write on paper, photograph it, run the Shortcut (pick Work or Personal first). The scan reads your page, then you review the cards in the app before anything is added.

## The rules (one line each)
| You write | The app does |
|---|---|
| A bullet (`-`, `•`, `*`, `☐`, `1.`) at the start of a line | One task per bullet |
| A task that runs onto a second line, no new bullet | Joined into the same task |
| A short line with no bullet above some bullets (underline it or end with `:`) | A heading = the task's category / project |
| A heading that is a day or date: `Today`, `Tomorrow`, `Friday`, `14 Nov` | Not a project: it becomes the due date of every task below it |
| A day or date inside a task: `tomorrow`, `by Friday`, `12th` | Due date; the words are removed from the title |
| A time inside a task: `at 3pm`, `15:00`, `9.30am` | Reminder time (and due today if no day) |
| A project name inside a task: `update Firstwork data` | Work tasks go to that project (must be one of your real Work projects; the words stay in the title) |
| `!` / `!!` / `!!!` at the end | Priority 1 / 2 / 3 (also the words `urgent`, `asap` = 3, `high` = 2) |
| `every Monday`, `daily`, `weekdays`, `monthly`, `fortnightly`, `yearly` | Repeat |
| `⚡` or the word `quick` | Quick win |
| `MDT` or `must do today` | Must do today |
| Text in (brackets) or after `note:` | Notes on the task |
| Smaller indented bullets under a task | Sub-tasks of that task |
| Crossed out or ticked off | Ignored |

## Tips
- Write the date or time words in plain English, close to the task. A date written inside a task beats the heading date.
- Leave a small gap above each heading so it is not mistaken for a wrapped line.
- Don't use a heading unless you mean a project/category: no heading = no project.
- After the scan, use "Project for all" at the top of the review to set one project on every task in one tap.
- Dark pen, flat page, whole page in shot. Ink showing through from the back is ignored.

## Dummy list to test everything
Copy this onto paper (a Saturday 7 Nov test; swap `Firstwork` for one of your real Work projects):

```
Tomorrow
- email Sam the revised quote
- sign documents by Friday at 3pm
- !!! chase the invoice
  (ask for the PO number)

Friday
- send weekly update to the team
  every Friday
- quick call with Priya ⚡

Calls:
- update Firstwork data !!
- book the meeting room for the
  all-hands next Tuesday at 10am
- plan Q1 priorities high
  - list the top 3 goals
  - check budget
- renew the licence on 20 Nov  note: card is in the drawer
- reply to Dan MDT
- ~~old thing~~  (crossed out: should be ignored)
```

## What you should see in the review (Work)
| Task | Due | Time | Project | Other |
|---|---|---|---|---|
| Email Sam the revised quote | tomorrow (Sun 8 Nov) | | none | |
| Sign documents | Fri 13 Nov | 15:00 | none | |
| Chase the invoice | tomorrow | | none | priority 3, notes "ask for the PO number" |
| Send weekly update to the team | Fri 13 Nov | | none | repeats weekly |
| Call with Priya | Fri 13 Nov | | none | quick |
| Update Firstwork data | none | | Firstwork | priority 2 |
| Book the meeting room for the all-hands | Tue 10 Nov | 10:00 | none | wrapped line joined |
| Plan Q1 priorities | none | | none | priority 2, 2 sub-tasks |
| Renew the licence | Fri 20 Nov | | none | notes "card is in the drawer" |
| Reply to Dan | none | | none | must do today |

Anything that differs: tell Claude which line and what you expected.
