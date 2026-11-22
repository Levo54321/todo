# Work status update format (todo-status v1)

How a weekly status update gets from work Claude into Luc's to-do app. Work Claude writes one readable update per project, then ONE fenced block tagged `todo-status` with the same facts as JSON. Luc pastes the whole reply into the app (Work board > Paste updates, or a project's Paste update box). The app reads only the block. The readable part is for Luc.

## The reply, in order
1. A short readable update per project: a heading with the project name and RAG, the headline, then the sections below as bullets. Leave out a section that is empty.
2. One fenced block, exactly ```` ```todo-status ````, holding the JSON below. One block only, with every project in it. Valid JSON: double quotes, no comments, no trailing commas.

## The JSON
```
{
  "v": 1,
  "exported": "YYYY-MM-DD",
  "updates": [ { ...one object per project... } ]
}
```
`v` must be `1`. If it is anything else the app refuses the paste and says so.

Per project (all lists may be `[]`; only `headline` and a way to find the project are required):

| key | what |
|---|---|
| `id` | the project id from Luc's project list (the `todo-projects` export). Use it whenever you have it. |
| `name` | the project name exactly as in the list; used only if the id is missing or not recognised |
| `rag` | your suggested status: `"red"`, `"amber"` or `"green"` (or `"r"`, `"a"`, `"g"`). A suggestion only: Luc decides whether it changes the project. |
| `headline` | ONE line, at most 200 characters: where the project stands this week |
| `period` | optional, e.g. `"w/e 2026-11-20"` |
| `done` | what got done since the last update (short bullets, one line each) |
| `next` | what happens next |
| `blockers` | things stopping progress now |
| `risks` | things that might go wrong |
| `decisions` | decisions Luc (or his manager) needs to make |
| `asks` | `[{"who": "Sam", "what": "Approve the extra budget"}]`: what is needed from other people |
| `sources` | `{"slack": [{"n": "short label", "u": "https://..."}], "linear": [{"n": "ENG-123", "u": "https://..."}]}`: the threads and issues the update came from |

Rules:
- Each list holds at most 12 items; each item is one line of at most 300 characters. Short beats complete: it is read on a phone.
- Links must start with `https://`; anything else is dropped.
- Never invent a project. If an update is about something that is not in the project list, leave it out of the block and say so in the readable part.
- One entry per project per paste (a second one for the same project is skipped).
- Do not put secrets, passwords or personal data in an update.

## What the app does with it
- Matches each entry by `id`, else by exact `name` (capital letters do not matter). Entries it cannot match are listed and skipped.
- Shows one review card per project. Nothing is saved until Luc taps Save.
- Stores every saved update in the project's history. The project's RAG changes only if Luc turned on "Accept" for that card.

## Full example
````
## Panel Refresh Study (Amber)
Recruitment is behind plan; the launch date holds if the extra recruiter starts Monday.
- Done: invites sent to 400 participants; screener approved
- Next: launch pilot on 25 Nov
- Blocker: Group B list still not with the recruiter
- Ask Sam: approve the extra recruiter budget

## Onboarding Survey (Green)
On track for the 2 Dec deadline.
- Done: final copy signed off
- Next: build in Prolific

```todo-status
{
  "v": 1,
  "exported": "2026-11-22",
  "updates": [
    {
      "id": "4969add1822d",
      "name": "Panel Refresh Study",
      "rag": "amber",
      "period": "w/e 2026-11-20",
      "headline": "Recruitment behind plan; launch holds if the extra recruiter starts Monday",
      "done": ["Invites sent to 400 participants", "Screener approved"],
      "next": ["Launch pilot on 25 Nov"],
      "blockers": ["Group B list still not with the recruiter"],
      "risks": ["Low response in the 25-34 group"],
      "decisions": ["Extend the pilot by two days?"],
      "asks": [{"who": "Sam", "what": "Approve the extra recruiter budget"}],
      "sources": {
        "slack": [{"n": "#panel-refresh thread", "u": "https://example.slack.com/archives/C0123/p1700000000000100"}],
        "linear": [{"n": "OPS-212", "u": "https://linear.app/example/issue/OPS-212"}]
      }
    },
    {
      "id": "b7c1e0a9d2f4",
      "name": "Onboarding Survey",
      "rag": "green",
      "headline": "On track for the 2 Dec deadline",
      "done": ["Final copy signed off"],
      "next": ["Build the survey in Prolific"],
      "blockers": [],
      "risks": [],
      "decisions": [],
      "asks": [],
      "sources": {"slack": [], "linear": [{"n": "OPS-230", "u": "https://linear.app/example/issue/OPS-230"}]}
    }
  ]
}
```
````

## The project list work Claude is given (todo-projects v1)
Luc's app has a "Copy for Claude" button on the Work board. It copies a short text with a fenced block tagged `todo-projects`:
```
{"v":1,"exported":"2026-11-22","projects":[
{"id":"4969add1822d","name":"Panel Refresh Study","status":"active","rag":"a","owner":"Sam Lee","requester":"Ana Ruiz","slack":[{"n":"Request","u":"https://...","init":true}],"links":[{"n":"Linear","u":"https://..."}],"last":{"at":"2026-11-13","headline":"Screener drafted"}}
]}
```
- `status` is `active` or `hold`; `rag` is `r`/`a`/`g` and left out when not set; `owner` and `requester` are names.
- `slack` links are the project's Slack threads; the one marked `"init":true` is the initial request. `links` are the Linear project and other links.
- `last` is the most recent update the app already has (date and headline), so write what is NEW since then.
- Done projects are not in the list. Use these `id` values in `todo-status`.
