/**
 * LinkedIn job-alert emails -> luc-todo Jobs > Discover.
 * Runs inside Luc's Google account (script.google.com). It only READS alert emails that match the search below,
 * sends their text and job links to luc-todo, then tags the email with the Gmail label "jobs-sent" so it is never sent twice.
 * It does not delete, archive or change any email. It never contacts LinkedIn.
 *
 * Set-up: see docs/jobs/SETUP.md. The access token is NOT in this file: it lives in Project Settings > Script properties as TODO_TOKEN.
 */
var SITE = 'https://luc-todo.vercel.app';
var SEARCH = '(from:jobalerts-noreply@linkedin.com OR from:jobs-listings@linkedin.com OR from:jobs-noreply@linkedin.com) newer_than:7d -label:jobs-sent';
var LABEL = 'jobs-sent';
var MAX_THREADS = 15;

function run() {
  var token = PropertiesService.getScriptProperties().getProperty('TODO_TOKEN');
  if (!token) throw new Error('Add the script property TODO_TOKEN first (Project Settings > Script properties).');
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(SEARCH, 0, MAX_THREADS), added = 0, skipped = 0, sentOk = 0, failed = 0;
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages(), allOk = true;
    for (var m = 0; m < msgs.length; m++) {
      var res = send_(token, msgs[m]);
      if (res.ok) { added += res.added; skipped += res.skipped; sentOk++; } else { allOk = false; failed++; Logger.log('Not sent (' + res.code + '): ' + res.body); }
    }
    if (allOk) threads[t].addLabel(label);   // only tag it when luc-todo accepted every message, otherwise the next run tries again
    Utilities.sleep(800);
  }
  Logger.log('Emails sent: ' + sentOk + ', failed: ' + failed + ', new postings: ' + added + ', already known: ' + skipped);
}

function send_(token, msg) {
  var html = msg.getBody(), links = [], re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, a;
  while ((a = re.exec(html)) !== null) {
    var url = a[1].replace(/&amp;/g, '&');
    if (/linkedin\.com\/(comm\/)?jobs\/view\//i.test(url)) links.push({ url: url, text: a[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() });
  }
  var out = { ok: false, code: 0, body: '', added: 0, skipped: 0 };
  if (!links.length) { out.ok = true; return out; }   // not a postings email (welcome, settings...): nothing to send
  var r = UrlFetchApp.fetch(SITE + '/api/pprojects?jobs=email', {
    method: 'post', contentType: 'application/json', headers: { 'x-todo-token': token }, muteHttpExceptions: true,
    payload: JSON.stringify({ text: msg.getPlainBody().slice(0, 24000), links: links.slice(0, 60) })
  });
  out.code = r.getResponseCode(); out.body = r.getContentText().slice(0, 200);
  if (out.code === 200) { var j = JSON.parse(r.getContentText()); out.ok = true; out.added = j.added || 0; out.skipped = j.skipped || 0; }
  return out;
}

/** Run once by hand: makes the script run every 3 hours. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyHours(3).create();
}
