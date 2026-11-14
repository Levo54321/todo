// Jobs tab handler, reached as /api/pprojects?jobs=... (api/pprojects.js hands the request over). The file name starts with
// "_" so Vercel does not count it as a function (the Hobby plan allows 12 per deployment). Auth: x-todo-token (or ?t=).
// Needs db/setup26.sql. A "job" is one posting/application; stages are the pipeline columns (editable).
//   GET   ?jobs=1                 -> { stages:[{id,name,color,kind,follow_days,pos}], jobs:[{id,company,role,location,mode,
//                                    salary,url,source,stage_id,contact,cv_variant,notes,next_step,next_on,applied_on,pos,
//                                    created_at,updated_at}] }   the first call creates the default stages
//                                    (Saved, Applied, Screening, Interview, Offer, Closed). jobs are in column order.
//   GET   ?jobs=1&id=<uuid>       -> { job, events:[{at,kind,text}] }   kind 'added' | 'stage', newest first
//   POST  ?jobs=1 {company?, role?, location?, mode?, salary?, url?, contact?, cv_variant?, notes?, next_step?, next_on?,
//                  applied_on?, stage_id?}           -> 201 { job }   goes to the top of stage_id (default: first stage)
//   PATCH ?jobs=1&id=<uuid> {same fields}            -> { job }   only the fields sent change; a new stage_id moves the card
//                                    to the top of that column, logs the move and sets applied_on the first time a job
//                                    leaves the first stage
//   DELETE ?jobs=1&id=<uuid>      -> { ok:true }
//   POST  ?jobs=stages {stages:[{id?, name, color, kind, follow_days?}]}  -> { stages, jobs }   replaces the whole list in
//                                    this order (1 to 12). Entries without an id are new; stages left out are removed and
//                                    their jobs move to the stage before. color: sand clay ochre sage moss stone rose slate;
//                                    kind: active | won | lost (won/lost end the pipeline); follow_days 1 to 60 or null.
//   POST  ?jobs=quick {url?, text?}                  -> 201 { job } or 200 { job, duplicate:true }   for the iPhone "Save to Jobs"
//                                    Shortcut (Share sheet). The link is taken from url or from text; the rest of text becomes
//                                    the role ("Role at Company" and "Role - Company" are split). A LinkedIn job link is cleaned
//                                    to its short form so the same job is not saved twice. source = linkedin | adzuna | share.
//   GET   ?jobs=stats            -> { stats:{ summary:{total,applied,heard,rate,offers,closed,active}, funnel:[{name,color,kind,count}],
//                                    weeks:[{start,n}] (last 8, Monday start, by applied_on), time:[{name,color,days,n}] (average days
//                                    spent in each stage), sources:[{source,total,applied,heard,rate}], lost, today } }  (v1075, needs setup27.sql)
//                                    "heard back" = an applied job that reached the 3rd stage or later (Screening onwards by default).
//   GET   ?jobs=leads            -> { leads:[{id,source,role,company,location,mode,url,fit,why,salary,created_at}] } best fit first  Discover: recommended postings not yet saved (v1076, setup28.sql)
//   POST  ?jobs=leads {id, action:'save'|'dismiss'|'like'|'dislike'} -> save: { job, lead_id } (a job in the first stage, source kept), dismiss/dislike: { ok }, like: { ok, vote:1 }
//                                    like/save add weight to the words of that posting's title and company, dislike/dismiss take some away (api/_joblearn.js, job_feed_cfg.learn);
//                                    GET ?jobs=leads then lists with fit moved by that boost (max +/-25, returned as `boost`), best first. vote:1 marks a lead already liked.
//   POST/PATCH ?jobs=1 also accept apply_how (text up to 300: a link, email or form note), kept in details.apply_how
//   POST  ?jobs=feed {force?}    -> { added, skipped, failed, last_run } | { skipped:true, last_run, added }   Reed search (v1077, setup29.sql), London 15 miles + remote postings, scored against the skills list;
//                                    runs at most once per 20 h unless force; needs env REED_API_KEY (503 if missing); results go into job_leads with source 'reed', fit 0-100, why, salary
//   GET   ?jobs=feedcfg          -> { cfg:{keywords:[...],skills:[...],last_run,last_added,last_err} }     POST ?jobs=feedcfg {keywords:[1-10], skills:[0-40]} -> { cfg }
//   GET   ?jobs=lead&id=<uuid>   -> { lead:{...,details}, detail_error }   one Discover posting in full; Reed postings get Reed's job details (full text, contract, closing date, apply link) fetched on first open and kept (v1078, setup30.sql)
//   POST  ?jobs=enrich {id}      -> { details, cached? }   Gemini reads a saved job's description once: details.ai = {summary, requirements[], nice_to_have[], skills[]}; 503/502/504 if Gemini is down
//                                    details (jsonb) = description, contract, job_type, salary_type, salary_year, posted, expires (YYYY-MM-DD), applicants, apply_url, ai. The board list never carries details; GET ?jobs=1&id= does.
//   POST  ?jobs=email {text, links:[{url,text}]}  -> { added, skipped, seen }   for the Google Apps Script that reads LinkedIn job-alert emails
//                                    (docs/jobs/linkedin-alerts.gs). Gemini reads the text and says which link is which job; only LinkedIn job links
//                                    from the email are used; only London or remote jobs are kept; postings already saved or already offered are
//                                    skipped. Gemini trouble -> 429/502/503/504 so the script tries again later. GET list also carries new_leads.
//   To-do links (v1075): next_on (+ optional next_at HH:MM) makes ONE Personal to-do "Job: <next step> · <role> at <company>" (category
//   "Job hunt", due next_on, reminder next_at); changing or clearing the next step updates or removes it, and moving the job to a stage of
//   kind lost removes it. Entering a stage that has follow_days (kind active) makes a to-do "Follow up: <role> at <company>" due that many
//   days later; leaving the stage removes the old one. The to-dos are made by the API (calling todo_add/todo_update/todo_delete); a failure
//   there never fails the save. Replies carry tasks:{next:'created'|'updated'|'removed', follow:'created'|'removed'} when something changed.
// mode: remote | hybrid | onsite | '' ; url must be http(s); dates YYYY-MM-DD or '' (clears). Text fields are cut to their
// column sizes (company 120, role 160, location 120, salary 60, contact 120, cv_variant 80, notes 4000, next_step 120); next_at HH:MM or ''.
var todos = require('./todos.js');
var jobmail = require('./_jobmail.js');
var jobfeed = require('./_jobfeed.js');
var jobdetail = require('./_jobdetail.js');
var joblearn = require('./_joblearn.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var TEXT = { company: 120, role: 160, location: 120, salary: 60, contact: 120, cv_variant: 80, notes: 4000, next_step: 120 };
var COLORS = ['sand', 'clay', 'ochre', 'sage', 'moss', 'stone', 'rose', 'slate'], KINDS = ['active', 'won', 'lost'];

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  var b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  var s = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
  try { var j = JSON.parse(s); return (j && typeof j === 'object') ? j : { text: String(j) }; }
  catch (e) { return { text: s }; } // plain text body (handy for Shortcuts)
}
function realDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function cleanUrl(u) {
  u = typeof u === 'string' ? u.trim() : '';
  return /^https?:\/\/\S+$/i.test(u) ? u.slice(0, 1000) : '';
}
// only the keys that were sent are returned, so a PATCH never blanks the rest
function clean(b) {
  var out = {}, k;
  for (k in TEXT) if (Object.prototype.hasOwnProperty.call(TEXT, k) && k in b) out[k] = typeof b[k] === 'string' ? b[k].trim().slice(0, TEXT[k]) : '';
  if ('mode' in b) out.mode = ['remote', 'hybrid', 'onsite'].indexOf(b.mode) >= 0 ? b.mode : '';
  if ('url' in b) out.url = cleanUrl(b.url);
  if ('next_on' in b) out.next_on = realDate(b.next_on) ? b.next_on : '';
  if ('next_at' in b) out.next_at = typeof b.next_at === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(b.next_at.trim()) ? b.next_at.trim() : '';
  if ('applied_on' in b) out.applied_on = realDate(b.applied_on) ? b.applied_on : '';
  if ('stage_id' in b) out.stage_id = typeof b.stage_id === 'string' && UUID.test(b.stage_id) ? b.stage_id : '';
  return out;
}
function cleanStages(a) {
  if (!Array.isArray(a) || a.length < 1 || a.length > 12) return null;
  var out = [], i, s, name, fd;
  for (i = 0; i < a.length; i++) {
    s = a[i] || {};
    name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name || name.length > 40) return null;
    fd = parseInt(s.follow_days, 10);
    out.push({
      id: typeof s.id === 'string' && UUID.test(s.id) ? s.id : '', name: name,
      color: COLORS.indexOf(s.color) >= 0 ? s.color : 'sand', kind: KINDS.indexOf(s.kind) >= 0 ? s.kind : 'active',
      follow_days: fd >= 1 && fd <= 60 ? fd : null
    });
  }
  return out;
}
// "Role at Company", "Role - Company", plus the link, from what the Share sheet sends
function parseShare(b) {
  var text = typeof b.text === 'string' ? b.text : '', url = cleanUrl(b.url);
  var m = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (m) text = text.replace(m[0], ' ');
  if (!url && m) url = cleanUrl(m[0]);
  var lm = /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^\/?#]*-)?(\d{6,})/i.exec(url);
  if (lm) url = 'https://www.linkedin.com/jobs/view/' + lm[1] + '/';
  text = text.replace(/\s+/g, ' ').replace(/^check out (?:this|the) job(?: posting)?:?\s*/i, '').replace(/^[\s:|–—-]+|[\s:|–—-]+$/g, '');
  var role = text, company = '';
  var p = /^(.{3,160}?)\s+(?:at|@)\s+(.{2,120})$/i.exec(text) || /^(.{3,160}?)\s+[|–—-]\s+(.{2,120})$/.exec(text);
  if (p) { role = p[1]; company = p[2]; }
  var source = /linkedin\.com/i.test(url) ? 'linkedin' : /adzuna\./i.test(url) ? 'adzuna' : 'share';
  return { job: { role: (role || 'Saved job').slice(0, 160), company: company.slice(0, 120), url: url }, source: source };
}


/* ---------- to-do links ---------- */
var TZ = 'Europe/London';
function todayISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function label(j) { var r = (j.role || '').trim(), c = (j.company || '').trim(); return (r && c ? r + ' at ' + c : r || c || 'job').slice(0, 120); }
function nextTitle(j) { return ('Job: ' + ((j.next_step || '').trim() || 'Next step') + ' · ' + label(j)).slice(0, 200); }
function tryRpc(name, args) { return todos.rpc(name, args).then(function (r) { return r; }, function () { return null; }); }
async function addTask(token, title, due, remind) {
  var r = await todos.rpc('todo_add', { p_token: token, p_title: title, p_due: due, p_category: 'Job hunt', p_recur: null, p_session: false, p_remind: remind || null, p_list: 'personal' });
  return r && r.id ? r.id : null;
}
// keeps the linked to-dos in step with the job. `sent` = the keys the caller changed; `created` = a new job. Never throws.
async function syncLinks(token, row, sent, created) {
  var out = {}, nextId = row.next_todo || null, followId = row.follow_todo || null, st = null, moved, i, l;
  try {
    moved = created || ('stage_id' in sent && row.prev_stage !== undefined && row.stage_id !== row.prev_stage);
    if (moved || row.next_on) { l = await todos.rpc('job_list', { p_token: token }); for (i = 0; i < ((l && l.stages) || []).length; i++) if (l.stages[i].id === row.stage_id) st = l.stages[i]; }
    var kind = st ? st.kind : 'active';
    var want = !!row.next_on && kind !== 'lost';
    var rel = created || 'next_on' in sent || 'next_at' in sent || 'next_step' in sent || 'role' in sent || 'company' in sent;
    if (want && !nextId) { nextId = await addTask(token, nextTitle(row), row.next_on, row.next_at); out.next = 'created'; }
    else if (want && rel) {
      var u = await tryRpc('todo_update', { p_token: token, p_id: nextId, p_patch: { title: nextTitle(row), due_date: row.next_on, remind_time: row.next_at || '' } });
      if (!u) { nextId = await addTask(token, nextTitle(row), row.next_on, row.next_at); out.next = 'created'; } else out.next = 'updated';
    } else if (!want && nextId) { await tryRpc('todo_delete', { p_token: token, p_id: nextId }); nextId = null; out.next = 'removed'; }
    if (moved) {
      if (followId) { await tryRpc('todo_delete', { p_token: token, p_id: followId }); followId = null; out.follow = 'removed'; }
      if (st && st.kind === 'active' && st.follow_days) { followId = await addTask(token, ('Follow up: ' + label(row)).slice(0, 200), addDays(todayISO(), st.follow_days), null); out.follow = 'created'; }
    }
    if (nextId !== (row.next_todo || null) || followId !== (row.follow_todo || null)) await todos.rpc('job_link', { p_token: token, p_id: row.id, p_next: nextId, p_follow: followId });
  } catch (e) { console.error('jobs link error', e.code, e.message); }
  return out;
}
function publicRow(row) { var r = {}, k; for (k in row) if (Object.prototype.hasOwnProperty.call(row, k) && k !== 'details' && k !== 'prev_stage' && k !== 'next_todo' && k !== 'follow_todo') r[k] = row[k]; return r; }

// teaches the Discover ranking from what Luc did with a lead; never throws
async function learnFrom(token, lead, action) {
  try {
    var cfg = await todos.rpc('job_feed_get', { p_token: token });
    await todos.rpc('job_learn_put', { p_token: token, p_learn: joblearn.learn((cfg && cfg.learn) || {}, lead, action) });
  } catch (e) { /* the ranking just does not learn this time */ }
}
// the "how to apply" note (link, email or form) lives in details.apply_how; never throws
async function saveApplyHow(token, id, b) {
  if (!b || typeof b.apply_how !== 'string') return;
  try { await todos.rpc('job_details_set', { p_token: token, p_id: id, p_details: { apply_how: b.apply_how.trim().slice(0, 300) } }); } catch (e) { /* the job itself was saved */ }
}
// Reed postings get their full details (text, contract, apply link) the first time a lead is opened or saved; never throws
async function ensureLeadDetails(token, ld) {
  if (ld.source !== 'reed' || (ld.details && ld.details.description)) return { lead: ld, error: '' };
  if (!process.env.REED_API_KEY) return { lead: ld, error: 'REED_API_KEY is not set in Vercel' };
  try {
    var det = await jobdetail.fetchReed(ld.url, process.env.REED_API_KEY);
    if (!det) return { lead: ld, error: 'Reed has no details for this posting' };
    return { lead: await todos.rpc('job_lead_details_set', { p_token: token, p_id: ld.id, p_details: det }), error: '' };
  } catch (e) { return { lead: ld, error: String(e.message).slice(0, 120) }; }
}

/* ---------- analytics ---------- */
var HEARD_IDX = 2; // the 3rd stage onwards counts as "heard back" (Screening in the default pipeline)
function computeStats(list, events, nowMs) {
  var stages = (list && list.stages) || [], jobs = (list && list.jobs) || [], i, j, k, e, byName = {}, byId = {}, evs = {}, today = new Date(nowMs).toISOString().slice(0, 10);
  for (i = 0; i < stages.length; i++) { if (!(stages[i].name in byName)) byName[stages[i].name] = i; byId[stages[i].id] = i; }
  for (i = 0; i < (events || []).length; i++) { e = events[i]; (evs[e.job_id] = evs[e.job_id] || []).push(e); }
  var funnel = [], reach = [], tin = [], srcs = {}, sum = { total: jobs.length, applied: 0, heard: 0, rate: null, offers: 0, closed: 0, active: 0 }, lost = 0;
  for (i = 0; i < stages.length; i++) { reach.push(0); tin.push({ sum: 0, n: 0 }); }
  var wk = [], mon = new Date(today + 'T00:00:00Z'), dow = (mon.getUTCDay() + 6) % 7;
  mon.setUTCDate(mon.getUTCDate() - dow);
  for (i = 7; i >= 0; i--) { var d0 = new Date(mon.getTime() - i * 7 * 86400000); wk.push({ start: d0.toISOString().slice(0, 10), n: 0 }); }
  for (i = 0; i < jobs.length; i++) {
    j = jobs[i]; var vis = {}, cur = byId[j.stage_id], list2 = (evs[j.id] || []).slice().sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }), seq = [], nm, ix;
    if (cur !== undefined) vis[cur] = true;
    for (k = 0; k < list2.length; k++) {
      nm = list2[k].kind === 'added' ? String(list2[k].text).split(' · ')[0] : list2[k].text; ix = byName[nm];
      if (ix !== undefined) { vis[ix] = true; seq.push({ ix: ix, t: Date.parse(list2[k].at) }); }
    }
    var top = -1, heard = false, applied = !!j.applied_on;
    for (k in vis) { ix = parseInt(k, 10); if (stages[ix].kind !== 'lost') { if (ix > top) top = ix; } }
    for (k = 0; k <= top; k++) reach[k]++;
    if (applied) { sum.applied++; if (top >= HEARD_IDX) { heard = true; sum.heard++; } }
    var cs = cur !== undefined ? stages[cur] : null;
    if (cs && cs.kind === 'won') sum.offers++; else if (cs && cs.kind === 'lost') { sum.closed++; lost++; } else if (cs && j.stage_id !== (stages[0] || {}).id) sum.active++;
    for (k = 0; k < seq.length; k++) {
      var end = k + 1 < seq.length ? seq[k + 1].t : (cs && cs.kind === 'active' ? nowMs : null);
      if (end != null && stages[seq[k].ix].kind === 'active' && end >= seq[k].t) { tin[seq[k].ix].sum += (end - seq[k].t) / 86400000; tin[seq[k].ix].n++; }
    }
    if (j.applied_on) { for (k = wk.length - 1; k >= 0; k--) if (j.applied_on >= wk[k].start) { if (j.applied_on < new Date(Date.parse(wk[k].start) + 7 * 86400000).toISOString().slice(0, 10)) wk[k].n++; break; } }
    var sname = j.source || 'manual', so = srcs[sname] = srcs[sname] || { source: sname, total: 0, applied: 0, heard: 0, rate: null };
    so.total++; if (applied) so.applied++; if (heard) so.heard++;
  }
  for (i = 0; i < stages.length; i++) if (stages[i].kind !== 'lost') funnel.push({ name: stages[i].name, color: stages[i].color, kind: stages[i].kind, count: reach[i] });
  var time = [];
  for (i = 0; i < stages.length; i++) if (tin[i].n) time.push({ name: stages[i].name, color: stages[i].color, days: Math.round(tin[i].sum / tin[i].n * 10) / 10, n: tin[i].n });
  var sl = []; for (k in srcs) if (Object.prototype.hasOwnProperty.call(srcs, k)) { srcs[k].rate = srcs[k].applied ? Math.round(srcs[k].heard / srcs[k].applied * 100) : null; sl.push(srcs[k]); }
  sl.sort(function (a, b) { return b.total - a.total; });
  sum.rate = sum.applied ? Math.round(sum.heard / sum.applied * 100) : null;
  return { summary: sum, funnel: funnel, weeks: wk, time: time, sources: sl, lost: lost, today: today };
}

module.exports = async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t, what = String(q.jobs || '1'), m = req.method, id, b, job;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (what === 'quick') {
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var sh = parseShare(readBody(req));
      if (sh.job.url) {
        var all = await todos.rpc('job_list', { p_token: token }), i;
        for (i = 0; i < ((all && all.jobs) || []).length; i++) if (all.jobs[i].url === sh.job.url) return send(res, 200, { job: all.jobs[i], duplicate: true });
      }
      var qrow = await todos.rpc('job_put', { p_token: token, p_job: sh.job, p_source: sh.source }), qt = await syncLinks(token, qrow, sh.job, true);
      return send(res, 201, { job: publicRow(qrow), tasks: qt });
    }
    if (what === 'leads') {
      if (m === 'GET') {
        var lraw = await todos.rpc('job_leads_list', { p_token: token }), lcfg = null;
        try { lcfg = await todos.rpc('job_feed_get', { p_token: token }); } catch (ce) { if (ce.code === '28000') throw ce; }
        return send(res, 200, { leads: joblearn.rank(lraw || [], (lcfg && lcfg.learn) || {}) });
      }
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var lb = readBody(req);
      if (!UUID.test(String(lb.id || '')) || ['save', 'dismiss', 'like', 'dislike'].indexOf(lb.action) < 0) return send(res, 400, { error: 'id and action (save, dismiss, like or dislike) needed' });
      var lead0 = await todos.rpc('job_lead_get', { p_token: token, p_id: String(lb.id) }), lr;
      if (lb.action === 'like') {
        if (lead0.vote !== 1) { await todos.rpc('job_lead_vote', { p_token: token, p_id: lead0.id, p_vote: 1 }); await learnFrom(token, lead0, 'like'); }
        return send(res, 200, { ok: true, lead_id: lead0.id, vote: 1 });
      }
      if (lb.action === 'save') await ensureLeadDetails(token, lead0);   // never throws; saving does not wait on Reed failing
      lr = await todos.rpc('job_lead_act', { p_token: token, p_id: String(lb.id), p_action: lb.action === 'dislike' ? 'dismiss' : lb.action });
      await learnFrom(token, lead0, lb.action);
      if (lb.action === 'save' && lr && lr.job && !lr.again) { var lt = await syncLinks(token, lr.job, {}, true); lr.job = publicRow(lr.job); lr.tasks = lt; }
      else if (lr && lr.job) lr.job = publicRow(lr.job);
      return send(res, 200, lr);
    }
    if (what === 'feedcfg') {
      if (m === 'GET') return send(res, 200, { cfg: await todos.rpc('job_feed_get', { p_token: token }) });
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var fb = readBody(req), fk = jobfeed.cleanList(fb.keywords, 10), fs = jobfeed.cleanList(fb.skills, 40);
      if (!fk || !fs || !fk.length) return send(res, 400, { error: 'keywords (1 to 10) and skills needed' });
      return send(res, 200, { cfg: await todos.rpc('job_feed_put', { p_token: token, p_cfg: { keywords: fk, skills: fs } }) });
    }
    if (what === 'feed') {
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var gb = readBody(req), cfg = await todos.rpc('job_feed_get', { p_token: token });   // also refuses a bad token
      if (!gb.force && !jobfeed.stale(cfg, Date.now())) return send(res, 200, { skipped: true, last_run: cfg.last_run, added: cfg.last_added });
      if (!process.env.REED_API_KEY) return send(res, 503, { error: 'REED_API_KEY is not set in Vercel' });
      var fr;
      try { fr = await jobfeed.search(cfg, process.env.REED_API_KEY, todayISO()); }
      catch (fe) { await todos.rpc('job_feed_ran', { p_token: token, p_added: 0, p_err: String(fe.message).slice(0, 200) }); return send(res, fe.status || 502, { error: String(fe.message).slice(0, 200) }); }
      var fa = fr.leads.length ? await todos.rpc('job_leads_add', { p_token: token, p_leads: fr.leads, p_source: 'reed' }) : { added: 0, skipped: 0 };
      var fc = await todos.rpc('job_feed_ran', { p_token: token, p_added: fa.added, p_err: fr.failed ? fr.failed + ' of ' + fr.calls + ' searches failed' : '' });
      return send(res, 200, { added: fa.added, skipped: fa.skipped, failed: fr.failed, last_run: fc.last_run });
    }
    if (what === 'lead') {                // one Discover posting in full; fetches the Reed details the first time it is opened
      if (m !== 'GET') return send(res, 405, { error: 'method not allowed' });
      if (!UUID.test(String(q.id || ''))) return send(res, 400, { error: 'bad id' });
      var ld = await todos.rpc('job_lead_get', { p_token: token, p_id: String(q.id) }), en = await ensureLeadDetails(token, ld);
      ld = en.lead; var derr = en.error;
      return send(res, 200, { lead: ld, detail_error: derr });
    }
    if (what === 'enrich') {              // Gemini reads the saved job's description once (summary, requirements, skills); cached in details.ai
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var nb = readBody(req);
      if (!UUID.test(String(nb.id || ''))) return send(res, 400, { error: 'bad id' });
      var nj = await todos.rpc('job_get', { p_token: token, p_id: String(nb.id) }), nd = (nj.job && nj.job.details) || {};
      if (nd.ai) return send(res, 200, { details: nd, cached: true });
      if (!nd.description) return send(res, 200, { details: nd, nothing: true });
      var ai;
      try { ai = await jobdetail.analyse(nj.job.role || '', nj.job.company || '', nd.description, jobmail.ask); }
      catch (ne) { return send(res, ne.status || 502, { error: String(ne.message).slice(0, 200) }); }
      var nr = await todos.rpc('job_details_set', { p_token: token, p_id: String(nb.id), p_details: { ai: ai } });
      return send(res, 200, { details: nr.details });
    }
    if (what === 'email') {
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var eb = readBody(req), rd;
      await todos.rpc('job_leads_add', { p_token: token, p_leads: [], p_source: 'linkedin' }); // refuses a bad token BEFORE Gemini is called
      try { rd = await jobmail.read(eb); }
      catch (ee) { if (ee && ee.status) return send(res, ee.status, { error: String(ee.message).slice(0, 200) }); throw ee; }
      var er = rd.leads.length ? await todos.rpc('job_leads_add', { p_token: token, p_leads: rd.leads, p_source: 'linkedin' }) : { added: 0, skipped: 0 };
      return send(res, 200, { added: er.added, skipped: er.skipped, seen: rd.seen });
    }
    if (what === 'stats') {
      if (m !== 'GET') return send(res, 405, { error: 'method not allowed' });
      var sl = await todos.rpc('job_list', { p_token: token }), sev = await todos.rpc('job_events_all', { p_token: token });
      return send(res, 200, { stats: computeStats(sl, sev, Date.now()) });
    }
    if (what === 'stages') {
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var st = cleanStages(readBody(req).stages);
      if (!st) return send(res, 400, { error: 'stages must be 1 to 12 entries with a name of up to 40 characters' });
      return send(res, 200, await todos.rpc('job_stages_put', { p_token: token, p_stages: st }));
    }
    if (m === 'GET') {
      if (q.id !== undefined) {
        if (!UUID.test(String(q.id))) return send(res, 400, { error: 'bad id' });
        return send(res, 200, await todos.rpc('job_get', { p_token: token, p_id: String(q.id) }));
      }
      return send(res, 200, await todos.rpc('job_list', { p_token: token }));
    }
    if (m === 'POST') {
      var cbody = readBody(req), cb = clean(cbody), crow = await todos.rpc('job_put', { p_token: token, p_job: cb, p_source: 'manual' }), ct = await syncLinks(token, crow, cb, true);
      await saveApplyHow(token, crow.id, cbody);
      return send(res, 201, { job: publicRow(crow), tasks: ct });
    }
    if (m === 'PATCH' || m === 'DELETE') {
      id = String(q.id || '');
      if (!UUID.test(id)) return send(res, 400, { error: 'bad id' });
      if (m === 'DELETE') {
        try { var old = await todos.rpc('job_get', { p_token: token, p_id: id }), oj = (old && old.job) || {}; // take its to-dos with it
          if (oj.next_todo) await tryRpc('todo_delete', { p_token: token, p_id: oj.next_todo });
          if (oj.follow_todo) await tryRpc('todo_delete', { p_token: token, p_id: oj.follow_todo }); } catch (de) { if (de.code === 'P0002' || de.code === '28000') throw de; }
        return send(res, 200, await todos.rpc('job_del', { p_token: token, p_id: id }));
      }
      b = readBody(req); job = clean(b); job.id = id;
      var prow = await todos.rpc('job_put', { p_token: token, p_job: job, p_source: 'manual' }), pt = await syncLinks(token, prow, job, false);
      await saveApplyHow(token, id, b);
      return send(res, 200, { job: publicRow(prow), tasks: pt });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23514' || e.code === '22P02' || e.code === '22007' || e.code === '22008') return send(res, 400, { error: 'invalid input' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup26.sql first' });
    console.error('jobs api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
module.exports._t = { computeStats: computeStats, clean: clean, cleanStages: cleanStages, parseShare: parseShare, realDate: realDate };
