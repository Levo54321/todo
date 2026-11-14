# Jobs: LinkedIn job alerts and "Save to Jobs" (set-up for Luc)

## A. LinkedIn alert emails -> Jobs > Discover (about 10 minutes, once)
1. **LinkedIn**: search the jobs you want (e.g. "AI data operations manager", location London, or Remote), tap **Set alert**, choose **Email**, frequency Daily. Add one alert per search.
2. Go to **script.google.com** (signed in to the Google account that receives the alerts) > **New project**. Delete the sample code and paste in `linkedin-alerts.gs` from this folder. Name it "luc-todo job alerts".
3. **Project Settings** (cog) > **Script properties** > **Add script property**: name `TODO_TOKEN`, value = the same access token your iPhone Shortcuts use. (It stays in your Google account, not in the code.)
4. Choose the function **run** > **Run**. Google asks you to allow Gmail access: it needs to read mail and add one label (`jobs-sent`). It never deletes or archives anything.
5. Open **Execution log**: it says how many emails were sent and how many new postings were found. Then open luc-todo > Jobs > Discover.
6. Run **installTrigger** once: it then checks every 3 hours by itself.
If the log says 0 emails, your alerts come from a different sender: change the `SEARCH` line at the top (open one alert email > "Show original" to see the From address).

## B. "Save to Jobs" on the iPhone Share sheet
1. **Shortcuts** > **+** > name it **Save to Jobs**. Tap the (i) > turn on **Show in Share Sheet**; accepted types: **URLs** and **Text** only.
2. Add action **Get Contents of URL**:
   - URL: `https://luc-todo.vercel.app/api/pprojects?jobs=quick&t=` followed by your token (copy the URL part from your existing to-do Shortcut)
   - Show More > Method **POST**, Request Body **File**, File = **Shortcut Input**
3. Add action **Show Notification**: "Saved to Jobs".
4. In the LinkedIn app (or Safari), open a job > Share > **Save to Jobs**. It lands in the Saved column of the Board. If LinkedIn only shares the link, the card says "Saved job" with the link: tap it and add the role and company.
