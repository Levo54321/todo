// /api/todos — thin, token-gated API in front of Supabase.
// The iPad (iOS 9) and phone only ever talk to this endpoint, never to Supabase directly.
// GET    /api/todos                 -> { today, now, v, todos: [...] }
// GET    /api/todos?v=<fingerprint> -> the same, unless the list is unchanged since the one with fingerprint v: then only
//                                      { same:true, today, now } (about 70 bytes instead of the full list, about 80 KB). v is a short hash
//                                      of the list (not of `now`) and comes back in every full reply. No ?v= (an older cached app, the
//                                      Shortcuts, the ?open=latest check) always gets the full list.
// POST   /api/todos                 -> body { text } (quick add, with shorthand) or { title, due_date, category, pproject_id?, pp_backlog? }
// POST   /api/todos?bulk=1          -> CSV import (desktop). body { rows: [ {row?, title, list, category, due_date, remind_time, repeat, priority, quick, must_today, notes, subtasks} ... up to 100 ], dry? }
//                                      A row with an `id` (an existing task) UPDATES that task using only the columns present; updates are not undone by Undo. Rows may also use words (tomorrow, Mon, 9 Nov, 9am, high, every week); write \| for a pipe inside a sub-task. dry:true only checks the rows. Reply { ok, dry, count, errors:[{row, messages:[...]}], added, cal }. Rules: api/_bulk.js, docs/import/.
//                                      A real run first checks every row and adds nothing if any row is wrong (400 with the same errors).
//                                      Every reply also carries preview:[{row, errors, value:{title,list,category,due_date,remind_time,recur,prio,quick,must,notes,subtasks:[{t,d}]}}] (the rows as the app understood them).
//                                      A real run may send batch:<uuid> (same id for every chunk of one file) and name:<file name>; the ids it added are logged under that batch so it can be undone.
// GET    /api/todos?imports=1       -> { imports: [{id, name, n, created_at, alive, undone_at, undone_n}] } latest 30 CSV imports, newest first (alive = how many of its tasks still exist)
// GET    /api/todos?import_csv=<uuid> -> { name, csv } the clean CSV saved with that import (404 if none); an import sends it as csv:<text> with its first chunk
// POST   /api/todos?import_undo=<uuid> -> deletes the tasks that import added (once). { ok, removed, added, cal }; 404 unknown import, 409 already undone
// POST   /api/todos?scan=1[&list=work|personal] -> photo (v1066: list forces that list on every task and no project is guessed; omit it and Gemini decides work/personal)  photo of handwritten notes -> tasks to review (v1065). Body: the photo itself (Shortcuts "File" body; JPEG, max 3.5 MB), or base64 text, or { image:"<base64>" }.
//                                      Checks the token, asks Gemini (key in env GEMINI_API_KEY, model GEMINI_MODEL, see api/_scan.js) to turn it into import CSV, and keeps the newest scan for review.
//                                      Reply { ok, rows, id } (rows 0 = nothing readable). Errors: 400 not a photo, 413 too big, 429 Gemini busy, 502 Gemini failed, 503 key not set. Nothing is added to the list by this call.
// GET    /api/todos?scan=1          -> { scan: { id, csv, n, created_at } | null } the newest scan still waiting for review (the app asks once when it opens, and for ?open=scan)
// POST   /api/todos?scan_done=<uuid> -> marks that scan reviewed (added or dismissed). { ok }
// PATCH  /api/todos?id=<uuid>       -> body { done?, title?, due_date?, category?, recur?, recur_until?, low?, remind_time?, list?, focus?, reviewed?, is_session?, items?, notes?, prio?, quick?, must?, blocked?, unblock_action?, pproject_id?, pp_backlog? }
// pproject_id links a Personal task to a Personal Project (see /api/pprojects); null unlinks. Ignored for Work tasks.
// pp_backlog: true keeps a project task on its project page only (Backlog), out of the Personal list.
// DELETE /api/todos?id=<uuid>
// Auth: header "x-todo-token: <token>" (or ?t=<token> as a fallback).

var crypto = require('crypto');
var bulk = require('./_bulk.js');

var SB_URL = process.env.SUPABASE_URL;
var SB_KEY = process.env.SUPABASE_KEY;
var TZ = 'Europe/London';

// Short fingerprint of the list the database returned, so the app can ask "has anything changed?" without downloading it all.
function fingerprint(list) { return crypto.createHash('sha1').update(JSON.stringify(list)).digest('hex').slice(0, 20); }

var DAYS = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7
};
var MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function toDate(iso) { return new Date(iso + 'T00:00:00Z'); }
function addDays(iso, n) {
  var d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(iso) { var g = toDate(iso).getUTCDay(); return g === 0 ? 7 : g; } // Mon=1 .. Sun=7
function pad(n) { return (n < 10 ? '0' : '') + n; }
function validYMD(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function fromDM(d, m, y, today) {
  var ty = parseInt(today.slice(0, 4), 10);
  var year = y ? (y < 100 ? 2000 + y : y) : ty;
  if (!validYMD(year, m, d)) return null;
  var iso = year + '-' + pad(m) + '-' + pad(d);
  if (!y && iso < today) {
    if (!validYMD(ty + 1, m, d)) return null;
    iso = (ty + 1) + '-' + pad(m) + '-' + pad(d);
  }
  return iso;
}

// Resolve a single date phrase ("fri", "tomorrow", "next week", "14/10", "14 oct", "in 3 days") or null.
function resolveDate(phrase, today) {
  var p = phrase.toLowerCase().replace(/[.,]+$/, '').trim();
  var m;
  if (p === 'today' || p === 'tonight') return today;
  if (p === 'tomorrow' || p === 'tmrw' || p === 'tmr') return addDays(today, 1);
  if (p === 'next week') return addDays(today, 8 - dow(today));
  if ((m = p.match(/^in (\d{1,2}) days?$/))) return addDays(today, parseInt(m[1], 10));
  if ((m = p.match(/^(next )?([a-z]+)$/)) && DAYS[m[2]]) {
    var diff = (DAYS[m[2]] - dow(today) + 7) % 7;
    if (diff === 0) diff = 7;
    if (m[1] && diff < 8 - dow(today)) diff += 7;
    return addDays(today, diff);
  }
  if ((m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return validYMD(+m[1], +m[2], +m[3]) ? p : null;
  }
  if ((m = p.match(/^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?$/))) {
    return fromDM(+m[1], +m[2], m[3] ? +m[3] : 0, today);
  }
  if ((m = p.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/)) && MONTHS[m[2]]) {
    return fromDM(+m[1], MONTHS[m[2]], 0, today);
  }
  return null;
}

// Trailing clock time: "3pm", "at 3:30pm", "at 15:30", "15:30". Returns "HH:MM" or null.
function parseTimeTail(text) {
  var m = text.match(/(^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)$/i), h, mi;
  if (m) {
    h = +m[2]; mi = m[3] ? +m[3] : 0;
    if (h < 1 || h > 12 || mi > 59) return null;
    if (/pm/i.test(m[4])) { if (h < 12) h += 12; } else if (h === 12) h = 0;
    return { time: pad(h) + ':' + pad(mi), index: m.index, len: m[0].length };
  }
  m = text.match(/(^|\s)(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m) return { time: pad(+m[2]) + ':' + m[3], index: m.index, len: m[0].length };
  return null;
}

var SESSION = /\bsession\b/i; // any title containing "session" becomes a checklist item


// Work-list ordering tags: "!" / "!!" / "!!!" (priority 1-3), "quick", "must" (or "must today"). Also "[quick]" / "[must]".
// Words are only taken from the END of the text, and at least one word of title is always kept, so "I must go" stays as typed.
function takeTags(text, st) {
  var m, guard = 0;
  while (guard++ < 12) {
    if ((m = text.match(/(^|\s)(!{1,3})(?=\s|$)/)) && text.length > m[0].length) {
      st.prio = Math.max(st.prio, m[2].length);
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else if ((m = text.match(/(\S)(!{2,3})$/))) {
      st.prio = Math.max(st.prio, m[2].length);
      text = text.slice(0, text.length - m[2].length).trim();
    } else if ((m = text.match(/(^|\s)\[(quick|must(?: today)?)\](?=\s|$)/i)) && text.length > m[0].length) {
      if (/^quick$/i.test(m[2])) st.quick = true; else st.must = true;
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else if ((m = text.match(/(^|\s)(must today|musttoday|quick|must)$/i)) && text.length > m[0].length) {
      if (/^quick$/i.test(m[2])) st.quick = true; else st.must = true;
      text = text.slice(0, m.index).trim();
    } else break;
  }
  return text;
}

// Quick-add shorthand: "#category" anywhere, "@date" anywhere, or a trailing date phrase.
// Examples: "call dentist fri", "pay council tax #money 14 oct", "buy milk @tomorrow".
function parseQuick(raw, today) {
  var text = String(raw || '').replace(/\s+/g, ' ').trim();
  var category = null, due = null, recur = null, remind = null, list = 'personal', m, tg = { prio: 0, quick: false, must: false };

  // Trailing "work" sends the task to the Work list and is removed from the title.
  if ((m = text.match(/(^|\s)work[.!]*$/i)) && text.length > m[0].length) {
    list = 'work';
    text = text.slice(0, m.index).trim();
  }
  text = takeTags(text, tg);
  if ((m = text.match(/(^|\s)#([A-Za-z][\w-]{0,39})(?=\s|$)/))) {
    category = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  }
  if ((m = text.match(/(^|\s)@([^\s]+(?: [^\s]+)?)(?=\s|$)/))) {
    // try two-word phrase first ("@next week"), then one word
    var two = resolveDate(m[2], today);
    var one = resolveDate(m[2].split(' ')[0], today);
    if (two) {
      due = two;
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else if (one) {
      due = one;
      var cut = m[0].length - (m[2].length - m[2].split(' ')[0].length);
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + cut)).replace(/\s+/g, ' ').trim();
    }
  }
  var tm = parseTimeTail(text);
  if (tm && text.length > tm.len) { remind = tm.time; text = text.slice(0, tm.index).trim(); }
  var RECUR = { daily: 'daily', 'every day': 'daily', weekdays: 'weekdays', 'every weekday': 'weekdays', weekly: 'weekly', 'every week': 'weekly',
    fortnightly: 'fortnightly', 'every fortnight': 'fortnightly', monthly: 'monthly', 'every month': 'monthly', yearly: 'yearly', 'every year': 'yearly' };
  var rm = text.match(/(^|\s)(daily|weekdays|weekly|fortnightly|monthly|yearly|every (?:day|weekday|week|fortnight|month|year))$/i);
  if (rm && text.length > rm[0].length) {
    recur = RECUR[rm[2].toLowerCase()];
    text = text.slice(0, rm.index).trim();
  }
  if (!due) {
    var tokens = text ? text.split(' ') : [];
    var sizes = [3, 2, 1];
    for (var i = 0; i < sizes.length && !due; i++) {
      var n = sizes[i];
      if (tokens.length > n) { // keep at least one word of title
        var d = resolveDate(tokens.slice(tokens.length - n).join(' '), today);
        if (d) { due = d; tokens = tokens.slice(0, tokens.length - n); }
      }
    }
    text = tokens.join(' ');
  }
  text = takeTags(text, tg);
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  var isSession = SESSION.test(text);
  if (isSession) { // "Home Clean Session" -> "Home Clean"
    var stripped = text.replace(/\bsession\b[:\-]?/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s:\-]+|[\s:\-]+$/g, '');
    if (stripped) text = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }
  if ((recur || isSession || remind || tg.must) && !due) due = today; // repeats and sessions start today unless told otherwise
  return { title: text, due_date: due, category: category, recur: recur, is_session: isSession, remind_time: remind, list: list, prio: tg.prio, quick: tg.quick, must: tg.must };
}

// On the Work list a #tag that matches one of your projects (any capitalisation) uses the project's exact name.
async function projectList(token) {
  try { var raw = await rpc('cfg_get', { p_token: token, p_key: 'projects' }), l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
async function canonProject(token, name) {
  var list = await projectList(token), i;
  for (i = 0; i < list.length; i++) if (String(list[i].name).toLowerCase() === String(name).toLowerCase()) return list[i].name;
  return name;
}

async function rpc(name, args) {
  var headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (SB_KEY && SB_KEY.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + SB_KEY;
  var r = await fetch(SB_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers, body: JSON.stringify(args) });
  var body = await r.text();
  var data = null;
  try { data = body ? JSON.parse(body) : null; } catch (e) { data = body; }
  if (!r.ok) {
    var err = new Error((data && data.message) || 'database error');
    err.code = data && data.code;
    err.status = r.status;
    throw err;
  }
  return data;
}

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
  catch (e) { return { text: s }; } // plain-text body (handy for Shortcuts)
}

// After a change, bring Apple Calendar up to date (only when it is connected). Returns 'ok', 'error' or null (not connected).
async function calHook(token) {
  try {
    var r = await Promise.race([require('./cal.js').syncIfEnabled(token), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('calendar timed out')); }, 8500); })]);
    return r ? 'ok' : null;
  } catch (e) { console.error('cal sync', e.message); return 'error'; }
}

// After a change, keep the Google work-calendar event for a task in step (only when that task was set to go there).
async function gcalHook(token, id, gone) {
  try {
    await Promise.race([require('./gcal.js').syncTask(token, id, gone), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('google timed out')); }, 6000); })]);
    return null;
  } catch (e) { console.error('gcal sync', e.message); return 'error'; }
}

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO = /^\d{4}-\d{2}-\d{2}$/;
var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
var RECURS = ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'];

// Remember which tasks an import added, so it can be undone. Best effort: the import itself never fails because of this.
async function logBatch(token, b, ids) {
  if (!ids.length || typeof b.batch !== 'string' || !UUID.test(b.batch)) return false;
  try { await rpc('todo_import_log', { p_token: token, p_batch: b.batch, p_name: typeof b.name === 'string' ? b.name.slice(0, 200) : '', p_ids: ids });
    if (typeof b.csv === 'string' && b.csv && b.csv.length <= 600000) await rpc('todo_import_csv_set', { p_token: token, p_batch: b.batch, p_csv: b.csv });
    return true; }
  catch (e) { console.error('import log', e.code, e.message); return false; }
}

// CSV import: validate every row first (nothing is written if any row is wrong), then add them one by one.
async function bulkImport(token, b, today, res) {
  var rows = Array.isArray(b.rows) ? b.rows : null, i, r, out = [], errors = [], vals = [], n, preview = [];
  if (!rows || !rows.length) return send(res, 400, { error: 'no rows' });
  if (rows.length > bulk.MAX_ROWS) return send(res, 400, { error: 'too many rows (max ' + bulk.MAX_ROWS + ' at a time)' });
  var haveIds = {}, anyId = false;
  for (i = 0; i < rows.length; i++) if (rows[i] && typeof rows[i].id === 'string' && rows[i].id) { anyId = true; break; }
  if (anyId) { // rows that carry an id update that task, so the id must exist
    try { var all0 = await rpc('todo_list', { p_token: token }); for (i = 0; i < (all0 || []).length; i++) haveIds[String(all0[i].id).toLowerCase()] = true; }
    catch (le) { console.error('bulk ids', le.message); return send(res, 500, { error: 'could not check the task ids' }); }
  }
  for (i = 0; i < rows.length; i++) {
    r = bulk.validateRow(rows[i], today);
    if (r.value.id && !haveIds[r.value.id]) r.errors.push('no task with that id (was it deleted?)');
    n = rows[i] && typeof rows[i].row === 'number' ? rows[i].row : i + 2;
    if (r.errors.length) errors.push({ row: n, messages: r.errors });
    preview.push({ row: n, errors: r.errors, value: r.value });
    vals.push(r.value);
  }
  if (errors.length) return send(res, 400, { ok: false, dry: b.dry === true, count: rows.length, errors: errors, added: 0, preview: preview });
  if (b.dry === true) return send(res, 200, { ok: true, dry: true, count: rows.length, errors: [], added: 0, preview: preview });

  var added = 0, updated = 0, anyRemind = false, newIds = [], logged = false;
  try {
    for (i = 0; i < vals.length; i++) {
      var v = vals[i], cat = v.category;
      if (cat && v.list === 'work') cat = await canonProject(token, cat);
      if (v.id) { // update an existing task: only the columns that were in the file; updates are not part of the import's Undo
        var up = {}, pr = v.present, M = { title: 'title', list: 'list', category: 'category', due_date: 'due_date', remind_time: 'remind_time', repeat: 'recur', priority: 'prio', quick: 'quick', must_today: 'must', notes: 'notes', subtasks: 'items' };
        for (var pi = 0; pi < pr.length; pi++) up[M[pr[pi]]] = pr[pi] === 'category' ? cat : pr[pi] === 'subtasks' ? v.subtasks : v[M[pr[pi]]]; // patch keys match the validated value's keys except items/subtasks
        if (pr.indexOf('due_date') < 0 && v.due_date && (pr.indexOf('repeat') >= 0 || pr.indexOf('remind_time') >= 0 || pr.indexOf('must_today') >= 0)) up.due_date = v.due_date;
        await rpc('todo_update', { p_token: token, p_id: v.id, p_patch: up });
        updated++;
        if (v.remind_time || up.due_date) anyRemind = true;
        continue;
      }
      var args = { p_token: token, p_title: v.title, p_due: v.due_date, p_category: cat, p_recur: v.recur, p_session: SESSION.test(v.title), p_remind: v.remind_time, p_list: v.list }, row;
      if (v.prio || v.quick || v.must) {
        try {
          args.p_prio = v.prio; args.p_quick = v.quick; args.p_must = v.must;
          row = await rpc('todo_add', args);
        } catch (ae) {
          if (ae.code !== 'PGRST202') throw ae; // database not updated yet (setup10.sql): add the task without its tags
          delete args.p_prio; delete args.p_quick; delete args.p_must;
          row = await rpc('todo_add', args);
        }
      } else row = await rpc('todo_add', args);
      if ((v.notes || v.subtasks.length) && row && row.id) {
        var ipatch = {}; if (v.notes) ipatch.notes = v.notes; if (v.subtasks.length) ipatch.items = v.subtasks;
        await rpc('todo_update', { p_token: token, p_id: row.id, p_patch: ipatch });
      }
      added++;
      if (row && row.id) newIds.push(row.id);
      if (v.remind_time) anyRemind = true;
    }
  } catch (e) {
    console.error('bulk import', e.message);
    await logBatch(token, b, newIds);
    return send(res, 500, { ok: false, error: 'stopped after ' + (added + updated) + ' of ' + vals.length + ' rows', added: added, updated: updated, count: vals.length, errors: [] });
  }
  logged = await logBatch(token, b, newIds);
  var cal = anyRemind ? await calHook(token) : null;
  return send(res, 201, { ok: true, dry: false, count: vals.length, errors: [], added: added, updated: updated, cal: cal, logged: logged });
}

// Photo of notes -> CSV waiting for review. The token is checked BEFORE Gemini is called (todo_scan_latest refuses a bad token), so nobody can spend the quota without it.
async function scanUpload(token, req, today, res) {
  var scan = require('./_scan.js'), buf, out, sv;
  try { await rpc('todo_scan_latest', { p_token: token }); }
  catch (ge) { if (ge.code === 'PGRST202') return send(res, 500, { error: 'database not updated yet (db/setup23.sql)' }); throw ge; }
  var raw = req.body;
  if ((raw == null || raw === '' || (typeof raw === 'object' && !Buffer.isBuffer(raw) && !raw.image)) && req.readable && !req.readableEnded) {
    raw = await new Promise(function (ok) { // body not handed over by the runtime: read the stream ourselves
      var ch = [], n = 0;
      req.on('data', function (c) { n += c.length; if (n < 6e6) ch.push(c); });
      req.on('end', function () { ok(Buffer.concat(ch)); });
      req.on('error', function () { ok(null); });
    });
  }
  try { buf = scan.imageFrom(raw); }
  catch (ie) {
    var ct = String(req.headers['content-type'] || 'none').slice(0, 40), cl = String(req.headers['content-length'] || '0').slice(0, 12);
    return send(res, ie.status || 400, { error: ie.message + (ie.status === 400 ? ' [type ' + ct + ', length ' + cl + ']' : '') });
  }
  var lst = String((req.query || {}).list || '').toLowerCase(), names = [];
  if (lst !== 'personal') { try { names = (await projectList(token)).map(function (p) { return p && p.name; }).filter(Boolean); } catch (pe) { names = []; } }
  try { out = await scan.readNotes(buf, { today: today, list: lst === 'work' || lst === 'personal' ? lst : '', projects: names }); }
  catch (se) { console.error('scan', se.status || '', se.message); return send(res, se.status || 502, { error: se.message }); }
  if (!out.rows) return send(res, 200, { ok: true, rows: 0, id: null });
  sv = await rpc('todo_scan_save', { p_token: token, p_csv: out.csv, p_n: out.rows });
  return send(res, 200, { ok: true, rows: out.rows, id: sv && sv.id });
}

module.exports = async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return send(res, 500, { error: 'server not configured' });

  var query = req.query || {};
  var token = req.headers['x-todo-token'] || query.t;
  if (!token) return send(res, 401, { error: 'missing token' });

  try {
    var today = todayISO();

    if (req.method === 'GET' && query.import_csv) {
      if (!UUID.test(String(query.import_csv))) return send(res, 400, { error: 'bad id' });
      var cr = await rpc('todo_import_csv_get', { p_token: token, p_id: query.import_csv }); // P0002 -> 404 below
      if (!cr || !cr.csv) return send(res, 404, { error: 'no copy saved for this import' });
      return send(res, 200, { name: cr.name, csv: cr.csv });
    }
    if (req.method === 'GET' && query.imports) {
      try { return send(res, 200, { imports: (await rpc('todo_import_list', { p_token: token })) || [] }); }
      catch (ie) { if (ie.code === 'PGRST202') return send(res, 200, { imports: [], unavailable: true }); throw ie; } // database not updated yet (setup21.sql)
    }

    if (req.method === 'GET' && query.scan) {
      try { return send(res, 200, { scan: (await rpc('todo_scan_latest', { p_token: token })) || null }); }
      catch (se) { if (se.code === 'PGRST202') return send(res, 200, { scan: null, unavailable: true }); throw se; } // database not updated yet (setup23.sql)
    }

    if (req.method === 'GET') {
      var list = await rpc('todo_list', { p_token: token }), fp = fingerprint(list), nowIso = new Date().toISOString();
      if (typeof query.v === 'string' && query.v === fp) return send(res, 200, { same: true, today: today, now: nowIso });
      return send(res, 200, { today: today, now: nowIso, v: fp, todos: list });
    }

    if (req.method === 'POST' && query.scan) return await scanUpload(token, req, today, res); // before readBody: the body is a photo
    if (req.method === 'POST' && query.scan_done) {
      if (!UUID.test(String(query.scan_done))) return send(res, 400, { error: 'bad id' });
      await rpc('todo_scan_done', { p_token: token, p_id: query.scan_done });
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST') {
      var b = readBody(req);
      if (query.bulk) return await bulkImport(token, b, today, res);
      if (query.import_undo) {
        if (!UUID.test(String(query.import_undo))) return send(res, 400, { error: 'bad id' });
        var ur;
        try { ur = await rpc('todo_import_undo', { p_token: token, p_id: query.import_undo }); }
        catch (ue) {
          if (ue.code === '23505') return send(res, 409, { error: 'already undone' });
          throw ue; // P0002 -> 404 and the rest are handled below
        }
        var undoCal = await calHook(token); // timed tasks that were in Apple Calendar go with them
        return send(res, 200, { ok: true, removed: ur.removed, added: ur.added, cal: undoCal });
      }
      if (Array.isArray(b.plan)) { // Daily Preview: save today's running order
        var ids = [];
        for (var pi = 0; pi < b.plan.length && pi < 200; pi++) if (typeof b.plan[pi] === 'string' && UUID.test(b.plan[pi])) ids.push(b.plan[pi]);
        var plist = b.list === 'work' ? 'work' : 'personal';
        var pdate = typeof b.date === 'string' && ISO.test(b.date) ? b.date : null; // Plan Tomorrow saves for a future date
        try {
          await rpc('todo_plan', pdate ? { p_token: token, p_ids: ids, p_list: plist, p_date: pdate } : { p_token: token, p_ids: ids, p_list: plist });
        } catch (pe) {
          if (pe.code !== 'PGRST202') throw pe; // database not updated yet (setup6.sql): fall back to the older functions
          if (pdate && pdate !== today) return send(res, 409, { error: 'run setup6.sql to plan other days' });
          try {
            await rpc('todo_plan', { p_token: token, p_ids: ids, p_list: plist });
          } catch (pe2) {
            if (pe2.code !== 'PGRST202') throw pe2;
            await rpc('todo_plan', { p_token: token, p_ids: ids });
          }
        }
        return send(res, 200, { ok: true });
      }
      var title, due = null, category = null, recur = null, isSession = false, remind = null, prio = 0, quick = false, must = false, listName = b.list === 'work' ? 'work' : 'personal';
      if (typeof b.text === 'string') {
        var q = parseQuick(b.text, today);
        title = q.title; due = q.due_date; category = q.category; recur = q.recur; isSession = q.is_session; remind = q.remind_time; prio = q.prio; quick = q.quick; must = q.must; if (q.list === 'work') listName = 'work';
      } else {
        title = typeof b.title === 'string' ? b.title.trim() : '';
        due = b.due_date && ISO.test(b.due_date) ? b.due_date : null;
        category = typeof b.category === 'string' && b.category.trim() ? b.category.trim() : null;
        recur = typeof b.recur === 'string' && RECURS.indexOf(b.recur) >= 0 ? b.recur : null;
        remind = typeof b.remind_time === 'string' && HHMM.test(b.remind_time) ? b.remind_time : null;
        prio = (b.prio === 1 || b.prio === 2 || b.prio === 3) ? b.prio : 0;
        quick = b.quick === true; must = b.must === true;
        if (must && !due) due = today;
      }
      if (!title) return send(res, 400, { error: 'empty item' });
      if (category && listName === 'work') category = await canonProject(token, category);
      if (typeof b.text !== 'string') isSession = SESSION.test(title);
      var addArgs = { p_token: token, p_title: title, p_due: due, p_category: category, p_recur: recur, p_session: isSession, p_remind: remind, p_list: listName }, row;
      if (prio || quick || must) {
        try {
          addArgs.p_prio = prio; addArgs.p_quick = quick; addArgs.p_must = must;
          row = await rpc('todo_add', addArgs);
        } catch (ae) {
          if (ae.code !== 'PGRST202') throw ae; // database not updated yet (setup10.sql): add the task without its tags
          delete addArgs.p_prio; delete addArgs.p_quick; delete addArgs.p_must;
          row = await rpc('todo_add', addArgs);
        }
      } else row = await rpc('todo_add', addArgs);
      if (listName === 'personal' && typeof b.pproject_id === 'string' && UUID.test(b.pproject_id) && row && row.id) {
        row = await rpc('todo_update', { p_token: token, p_id: row.id, p_patch: { pproject_id: b.pproject_id, pp_backlog: b.pp_backlog === true } }); // added from a Personal Project page
      }
      var addCal = remind ? await calHook(token) : null;
      var out = { todo: row, cal: addCal };
      if (listName === 'work' && !category) { // the Shortcut uses this to offer a project picker
        out.needs_project = true;
        out.project_prompt = 'yes'; // plain text, easier for a Shortcut to test than a true/false
        out.project_names = (await projectList(token)).map(function (p) { return p.name; });
        out.project_choices = out.project_names.concat(['+ New project', 'No project']);
      } else { out.needs_project = false; out.project_prompt = 'no'; }
      return send(res, 201, out);
    }

    if (req.method === 'PATCH') {
      var id = query.id;
      if (!id || !UUID.test(id)) return send(res, 400, { error: 'bad id' });
      var pb = readBody(req), patch = {};
      if (typeof pb.done === 'boolean') patch.done = pb.done;
      if (typeof pb.title === 'string') {
        if (!pb.title.trim()) return send(res, 400, { error: 'empty title' });
        patch.title = pb.title.trim();
      }
      if ('due_date' in pb) {
        if (pb.due_date !== null && !(typeof pb.due_date === 'string' && ISO.test(pb.due_date))) return send(res, 400, { error: 'bad date' });
        patch.due_date = pb.due_date;
      }
      if ('recur' in pb) {
        if (pb.recur !== null && RECURS.indexOf(pb.recur) < 0) return send(res, 400, { error: 'bad repeat' });
        patch.recur = pb.recur;
      }
      if ('recur_until' in pb) {
        if (pb.recur_until !== null && !(typeof pb.recur_until === 'string' && ISO.test(pb.recur_until))) return send(res, 400, { error: 'bad end date' });
        patch.recur_until = pb.recur_until;
      }
      if (typeof pb.low === 'boolean') patch.low = pb.low;
      if (typeof pb.is_session === 'boolean') patch.is_session = pb.is_session;
      if ('prio' in pb) {
        if (!(pb.prio === 0 || pb.prio === 1 || pb.prio === 2 || pb.prio === 3)) return send(res, 400, { error: 'bad priority' });
        patch.prio = pb.prio;
      }
      if (typeof pb.quick === 'boolean') patch.quick = pb.quick;
      if (typeof pb.must === 'boolean') patch.must = pb.must;
      if (typeof pb.blocked === 'boolean') patch.blocked = pb.blocked;
      if (typeof pb.unblock_action === 'string' || pb.unblock_action === null) patch.unblock_action = pb.unblock_action === null ? null : pb.unblock_action.slice(0, 300);
      if ('items' in pb) {
        if (!Array.isArray(pb.items) || pb.items.length > 100) return send(res, 400, { error: 'bad items' });
        patch.items = [];
        for (var ii = 0; ii < pb.items.length; ii++) {
          var it = pb.items[ii], tx = it && typeof it.t === 'string' ? it.t.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
          if (tx) patch.items.push({ t: tx, d: it.d === true });
        }
      }
      if ('remind_time' in pb) {
        if (pb.remind_time !== null && !(typeof pb.remind_time === 'string' && HHMM.test(pb.remind_time))) return send(res, 400, { error: 'bad time' });
        patch.remind_time = pb.remind_time;
      }
      if ('list' in pb) {
        if (pb.list !== 'personal' && pb.list !== 'work') return send(res, 400, { error: 'bad list' });
        patch.list = pb.list;
      }
      if (typeof pb.focus === 'boolean') patch.focus = pb.focus;
      if (pb.reviewed === true) patch.reviewed = true;
      if ('notes' in pb) patch.notes = typeof pb.notes === 'string' ? pb.notes.trim().slice(0, 2000) : '';
      if ('category' in pb) patch.category = typeof pb.category === 'string' ? pb.category.trim() : null;
      if ('pproject_id' in pb) {
        if (pb.pproject_id !== null && !(typeof pb.pproject_id === 'string' && UUID.test(pb.pproject_id))) return send(res, 400, { error: 'bad project' });
        patch.pproject_id = pb.pproject_id;
      }
      if (typeof pb.pp_backlog === 'boolean') patch.pp_backlog = pb.pp_backlog;
      var updated = await rpc('todo_update', { p_token: token, p_id: id, p_patch: patch });
      var calKeys = ['done', 'title', 'due_date', 'remind_time', 'recur', 'recur_until', 'category'], calRel = false;
      for (var ck = 0; ck < calKeys.length; ck++) if (calKeys[ck] in patch) calRel = true;
      var patchCal = calRel ? await calHook(token) : null;
      var gKeys = ['done', 'title', 'due_date', 'remind_time', 'list'], gRel = false;
      for (var gk = 0; gk < gKeys.length; gk++) if (gKeys[gk] in patch) gRel = true;
      var patchG = gRel ? await gcalHook(token, id, false) : null;
      return send(res, 200, { todo: updated, cal: patchCal, gcal: patchG });
    }

    if (req.method === 'DELETE') {
      var did = query.id;
      if (!did || !UUID.test(did)) return send(res, 400, { error: 'bad id' });
      if (query.scope === 'one') {
        // Skip only this occurrence of a repeating task: finishing it creates the next one, then this row is removed.
        var all = await rpc('todo_list', { p_token: token }), cur = null;
        for (var di = 0; di < all.length; di++) if (all[di].id === did) cur = all[di];
        if (cur && cur.recur && !cur.done && !cur.successor_id) await rpc('todo_update', { p_token: token, p_id: did, p_patch: { done: true } });
      }
      await gcalHook(token, did, true);
      await rpc('todo_delete', { p_token: token, p_id: did });
      var delCal = await calHook(token);
      return send(res, 200, { ok: true, cal: delCal });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23514' && /focus full/.test(e.message || '')) return send(res, 409, { error: 'focus full' });
    if (e.code === '23514' || e.code === '22007' || e.code === '22P02') return send(res, 400, { error: 'invalid input' });
    if (e.code === '23503') return send(res, 400, { error: 'that project no longer exists' });
    console.error('todos api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};

module.exports.HHMM = HHMM;
module.exports.parseQuick = parseQuick; // exported for local tests
module.exports.rpc = rpc;
module.exports.projectList = projectList;
module.exports.todayISO = todayISO;
module.exports.fingerprint = fingerprint;
