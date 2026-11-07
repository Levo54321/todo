# Scanner stress test 2 (written for Saturday 7 Nov 2026)

Run it in **Work** mode. Swap `GenMedia`, `Human Signal`, `Firstwork` for real Work projects of yours if any are missing (otherwise those rows will correctly show no project).
Write it as set out: bullets, indents, underlines on headings, and a gap above each heading. Use three lines for the long task.

## The page to copy onto paper

```
Monday                          (underline)
☐ Prep board pack by Wed 3pm !!
☐ Call Priya 9.30am
     (bring last quarter numbers)
☐ Review Human Signal onboarding
  doc and send comments to the
  whole team before lunch
☐ Book travel for 20 Nov

Tonight                         (underline)
1. Pay supplier invoice MDT !!!
2. ⚡ Reply to the recruiter
3. Back up laptop every Sunday

Next week                       (underline)
- Send GenMedia report fortnightly !
- chase firstwork about the Q4 numbers
- Quarterly review in 3 days at 14:00
     - draft agenda
     - invite the team
     - book room   (cross this one out)

Planning                        (underline)
- Renew passport urgent (check expiry first)
- Gym ✓   (tick it)
- Send thank you note to the team!
- Standup every weekday at 9:15
- ~~Old task~~   (cross it out)
```

## What a perfect scan shows (14 tasks)

| # | Task (title) | Due | Time | Project | Other |
|---|---|---|---|---|---|
| 1 | Prep board pack | Wed 11 Nov | 15:00 | none | priority 2 |
| 2 | Call Priya | Mon 9 Nov | 09:30 | none | note "bring last quarter numbers" |
| 3 | Review Human Signal onboarding doc and send comments to the whole team before lunch | Mon 9 Nov | | **Human Signal** | one-line title (3 lines joined) |
| 4 | Book travel | Fri 20 Nov | | none | date words removed |
| 5 | Pay supplier invoice | Sat 7 Nov (Tonight) | | none | priority 3, must do today |
| 6 | Reply to the recruiter | Sat 7 Nov | | none | quick |
| 7 | Back up laptop | Sat 7 Nov | | none | repeats weekly |
| 8 | Send GenMedia report | Mon 9 Nov (Next week) | | **GenMedia** | priority 1, repeats fortnightly |
| 9 | Chase firstwork about the Q4 numbers | Mon 9 Nov | | **Firstwork** | lower-case name still matches |
| 10 | Quarterly review | Tue 10 Nov | 14:00 | none | 2 sub-tasks: draft agenda, invite the team |
| 11 | Renew passport | none | | Planning | priority 3, note "check expiry first" |
| 12 | Send thank you note to the team! | none | | Planning | **no** priority (the `!` is just punctuation) |
| 13 | Standup | none | 09:15 | Planning | repeats weekdays |

Not present at all: Gym (ticked), Old task (crossed out), book room (crossed out), draft agenda / invite the team as separate tasks.
(That is 13 cards; the 14th "task" in the count is sub-tasks living inside #10.)

## What each row is testing
| Row | Challenge |
|---|---|
| 1 | Date + time + `!!` all in one line, checkbox bullet |
| 2 | Time with a dot (9.30am), note on a separate bracketed line, heading date (Monday) as the due date |
| 3 | 3-line wrapped task, no bullets on lines 2 and 3, project name inside the text |
| 4 | Date written as `20 Nov` overriding the Monday heading |
| 5-7 | Heading "Tonight" = today; numbered bullets; MDT, `!!!`, ⚡, `every Sunday` |
| 8 | Project name + `!` + repeat word |
| 9 | Project in lower case, "Next week" heading as the date |
| 10 | "in 3 days" + 24-hour time overriding the heading, indented sub-bullets, one crossed out |
| 11-13 | Real heading (not a date) = category; `urgent` word; note in brackets; `!` at the end of normal text must NOT become priority; `every weekday` + time |

## Scoring
13 cards right = pass. Note any wrong row by number and what it showed instead; that tells me whether it is the handwriting read (Gemini) or my rules.
Heads-up on likely wobbles: "Next week" is read as the coming Monday (9 Nov), `9.30am` and `9:15` depend on clear digits, and the ⚡ must look like a bolt, not a squiggle.
