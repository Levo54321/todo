// api/_jarvis.js — helpers for the voice-assistant ("Jarvis") branches of /api/todos. No network, no database: pure
// functions that take the task list todo_list returned. Used by GET /api/todos?jarvis=1 (compact list, find by words,
// single task) and by the x-source write log. The contract is the header comment of api/todos.js.
//
// Ordering is a server-side copy of the app's own (public/js/core.js: groups(), autoCmp, planCmp, projSlots, byDue,
// byTimeThenCreated). If the app's ordering changes, change it here too (CLAUDE.md, Jarvis amendment).
// Word matching is a copy of toks/lev1/likeness in public/js/csvimport.js (browser-only, so it cannot be required),
// plus a prefix rule and a few spoken filler words in STOP. Keep the two in step when matching changes.

var STOP = { a: 1, an: 1, the: 1, to: 1, 'for': 1, 'with': 1, re: 1, and: 1, of: 1, on: 1, 'in': 1, my: 1, at: 1, by: 1, up: 1, out: 1,
  is: 1, it: 1, i: 1, 'this': 1, 'that': 1, task: 1, tasks: 1, todo: 1, please: 1 };
var SRC = /^[A-Za-z0-9_-]{1,20}$/;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO = /^\d{4}-\d{2}-\d{2}$/;

function toks(x) {
  var a = String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '), o = [], i;
  for (i = 0; i < a.length; i++) if (a[i] && !STOP[a[i]]) o.push(a[i]);
  return o;
}
function lev1(a, b) { // same word, or one letter out (a mis-hearing or slip) for words of 5+ letters
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
function same(a, b) { // lev1, or one is the start of the other (call / calling, dentist / dentists)
  return lev1(a, b) || (a.length >= 4 && b.length >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
}
function likeness(A, B) { // 0..1, as in csvimport.js
  if (!A.length || !B.length) return 0;
  var hit = 0, used = {}, i, j;
  for (i = 0; i < A.length; i++) for (j = 0; j < B.length; j++) if (!used[j] && lev1(A[i], B[j])) { used[j] = 1; hit++; break; }
  return 2 * hit / (A.length + B.length);
}

function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function ts(s) { var n = Date.parse(s || ''); return isNaN(n) ? 0 : n; }
function listOf(t) { return t.list === 'work' ? 'work' : 'personal'; }
function timeOf(t) { return t.remind_time ? String(t.remind_time).slice(0, 5) : ''; }
function isFocus(t, today) { return !t.done && t.focus_date === today; }
function waiting(t) { return listOf(t) === 'work' && !t.done && !!t.paused; } // paused and blocked only exist on Work
function stuck(t) { return listOf(t) === 'work' && !t.done && !!t.blocked; }
function isOverdue(t, today) { return !t.done && !!t.due_date && t.due_date < today && !waiting(t) && !stuck(t); }
function isBacklog(t) { return listOf(t) === 'personal' && !!t.pproject_id && !!t.pp_backlog; }
function isMust(t, today) { return !!t.must && !t.done && !t.paused && !!t.due_date && t.due_date <= today; }
function planned(t, today) { return !t.done && t.plan_date === today && t.plan_order ? t.plan_order : 0; }
function items(t) { return Array.isArray(t.items) ? t.items : []; }
function itemsSummary(t) { var a = items(t), d = 0, i; for (i = 0; i < a.length; i++) if (a[i] && a[i].d) d++; return { n: a.length, done: d }; }
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+$/, '') + '…' : s; }

// ---------- what the model sees ----------
function compactOf(t, today) {
  var notes = String(t.notes || '');
  return {
    id: t.id, title: t.title, list: listOf(t), category: t.category || null,
    due_date: t.due_date || null, remind_time: timeOf(t) || null, prio: t.prio || 0,
    quick: !!t.quick, must: !!t.must, blocked: !!t.blocked, paused: !!t.paused, focus: isFocus(t, today), low: !!t.low,
    recur: t.recur || null, notes: clip(notes, 80), notes_len: notes.length, items: itemsSummary(t),
    overdue: isOverdue(t, today), done: !!t.done
  };
}
function fullOf(t, today) {
  var c = compactOf(t, today);
  c.notes = t.notes || ''; delete c.notes_len;
  c.items = items(t); c.items_summary = itemsSummary(t);
  c.recur_until = t.recur_until || null; c.series_id = t.series_id || null; c.successor_id = t.successor_id || null;
  c.is_session = !!t.is_session; c.unblock_action = t.unblock_action || null; c.blocked_at = t.blocked_at || null;
  c.paused_on = t.paused_on || null; c.paused_at = t.paused_at || null; c.done_at = t.done_at || null;
  c.pproject_id = t.pproject_id || null; c.pp_backlog = !!t.pp_backlog; c.plan_date = t.plan_date || null; c.plan_order = t.plan_order || null;
  c.created_at = t.created_at || null;
  return c;
}

// ---------- the app's order ----------
// proj = { prio: {name: n}, order: {name: [task ids]} } built from the Work project list (hold = -1, done skipped)
function projectsOf(list) {
  var pr = {}, od = {}, i, p;
  for (i = 0; i < (list || []).length; i++) {
    p = list[i];
    if (!p || !p.name || p.status === 'done') continue;
    pr[p.name] = p.status === 'hold' ? -1 : (p.prio || 0);
    if (p.order && p.order.length) od[p.name] = p.order;
  }
  return { prio: pr, order: od };
}
function groupOf(t, today) { // the app's sections, top to bottom (focus, overdue, today, later, undated, blocked, waiting, non-urgent, done)
  if (t.done) return 8;
  if (t.low && !t.due_date) return 7;
  if (waiting(t)) return 6;
  if (stuck(t)) return 5;
  if (isFocus(t, today)) return 0;
  if (!t.due_date) return 4;
  if (t.due_date < today) return 1;
  if (t.due_date === today) return 2;
  return 3;
}
function makeCmp(today, proj) {
  function byCreated(a, b) { return ts(a.created_at) - ts(b.created_at); }
  function byDue(a, b) { return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : byCreated(a, b); }
  function byTimeThenCreated(a, b) {
    var ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (tb && !ta) return 1;
    return byCreated(a, b);
  }
  function prioRank(t) { return t.prio === 3 ? 0 : t.prio === 2 ? 1 : t.prio === 1 ? 3 : 2; }
  function pj(t) { return listOf(t) === 'work' && t.category ? (proj.prio[t.category] || 0) : 0; }
  function auto(a, b) { // Work's automatic order (autoCmp)
    var ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (tb && !ta) return 1;
    var ma = isMust(a, today) ? 0 : 1, mb = isMust(b, today) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    var pa = prioRank(a), pb = prioRank(b);
    if (pa !== pb) return pa - pb;
    var ja = pj(a), jb = pj(b);
    if (ja !== jb) return jb - ja;
    var qa = a.quick ? 0 : 1, qb = b.quick ? 0 : 1;
    if (qa !== qb) return qa - qb;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return byCreated(a, b);
  }
  function plan(fb) { // today's hand-made running order (Daily Preview) first
    return function (a, b) {
      var pa = planned(a, today), pb = planned(b, today);
      if (pa && pb) return pa - pb;
      if (pa) return -1;
      if (pb) return 1;
      return fb(a, b);
    };
  }
  function perList(work, personal) { return function (a, b) { return listOf(a) === 'work' && listOf(b) === 'work' ? work(a, b) : personal(a, b); }; }
  var cmps = [
    plan(byTimeThenCreated), // 0 focus
    plan(perList(auto, byDue)), // 1 overdue
    plan(perList(auto, byTimeThenCreated)), // 2 today
    function (a, b) { var c = byDue(a, b); return c === 0 ? byTimeThenCreated(a, b) : c; }, // 3 later
    function (a, b) { return byCreated(b, a); }, // 4 undated: newest first
    function (a, b) { return ts(a.blocked_at) - ts(b.blocked_at); }, // 5 blocked: longest first
    function (a, b) { return ts(a.paused_at) - ts(b.paused_at); }, // 6 waiting: longest first
    function (a, b) { return byCreated(b, a); }, // 7 non-urgent: newest first
    function (a, b) { return ts(b.done_at) - ts(a.done_at); } // 8 done: latest first
  ];
  return function (g, a, b) { // Personal before Work when both lists are in one group
    var la = listOf(a), lb = listOf(b);
    if (la !== lb) return la === 'personal' ? -1 : 1;
    return cmps[g](a, b);
  };
}
function projSlots(arr, proj, today) { // a project's tasks keep the board's hand-made order inside the slots they occupy (projSlots in core.js)
  var groups = {}, i, t, k;
  for (i = 0; i < arr.length; i++) {
    t = arr[i];
    if (listOf(t) !== 'work' || !t.category || !proj.order[t.category] || planned(t, today)) continue;
    (groups[t.category] = groups[t.category] || []).push(i);
  }
  for (k in groups) if (groups.hasOwnProperty(k) && groups[k].length > 1) {
    var idx = groups[k], ord = proj.order[k], pos = {}, its = [], j;
    for (j = 0; j < ord.length; j++) pos[ord[j]] = j + 1;
    for (j = 0; j < idx.length; j++) its.push({ t: arr[idx[j]], n: j });
    its.sort(function (a, b) {
      var x = pos[a.t.id] || 0, y = pos[b.t.id] || 0;
      if (x && y) return x - y;
      if (x) return -1;
      if (y) return 1;
      return a.n - b.n;
    });
    for (j = 0; j < idx.length; j++) arr[idx[j]] = its[j].t;
  }
}
function order(rows, today, proj) {
  var cmp = makeCmp(today, proj), by = [[], [], [], [], [], [], [], [], []], out = [], g, i;
  for (i = 0; i < rows.length; i++) by[groupOf(rows[i], today)].push(rows[i]);
  for (g = 0; g < by.length; g++) {
    (function (gg) { by[gg].sort(function (a, b) { return cmp(gg, a, b); }); })(g);
    if (g === 1 || g === 2) projSlots(by[g], proj, today);
    out = out.concat(by[g]);
  }
  return out;
}

// ---------- filters, find, and the one entry point ----------
function bad(msg) { var e = new Error(msg); e.status = 400; return e; }
function pick(rows, f, today) {
  var out = [], i, t, wk = addDays(today, 6);
  for (i = 0; i < rows.length; i++) {
    t = rows[i];
    if (t.done && !f.done) continue;
    if (isBacklog(t) && !f.backlog) continue;
    if (f.list && listOf(t) !== f.list) continue;
    if (f.project && String(t.category || '').toLowerCase() !== f.project) continue;
    if (f.due === 'today' && t.due_date !== today) continue;
    if (f.due === 'overdue' && !isOverdue(t, today)) continue;
    if (f.due === 'week' && !(t.due_date && t.due_date >= today && t.due_date <= wk)) continue;
    if (f.due === 'none' && t.due_date) continue;
    out.push(t);
  }
  return out;
}
function scoreOf(qt, t) { // how well the spoken words fit a task: title words count fully, project 0.6, notes 0.4
  var tt = toks(t.title), ct = toks(t.category), nt = toks(t.notes), sum = 0, i, j, k, w;
  for (i = 0; i < qt.length; i++) {
    w = 0;
    for (j = 0; j < tt.length && !w; j++) if (same(qt[i], tt[j])) w = 1;
    for (j = 0; j < ct.length && !w; j++) if (same(qt[i], ct[j])) w = 0.6;
    for (k = 0; k < nt.length && !w; k++) if (same(qt[i], nt[k])) w = 0.4;
    sum += w;
  }
  return { s: sum / qt.length, d: likeness(qt, tt) };
}
function intParam(v, def, lo, hi) { var n = parseInt(v, 10); return isFinite(n) ? Math.min(Math.max(n, lo), hi) : def; }

// rows = todo_list result; query = the request's query; projects = Work project list; returns the JSON body (throws {status:400}).
function read(rows, query, projects, today, nowIso) {
  var proj = projectsOf(projects), id = query.id, q = query.q, f, inc, i, list, out;
  if (id !== undefined) {
    if (typeof id !== 'string' || !UUID.test(id)) throw bad('bad id');
    for (i = 0; i < rows.length; i++) if (rows[i].id === id) return { status: 200, body: { today: today, now: nowIso, task: fullOf(rows[i], today) } };
    return { status: 404, body: { error: 'not found' } }; // done tasks leave todo_list after 7 days
  }
  inc = String(query.include || '').toLowerCase().split(',');
  f = { list: '', due: '', project: '', done: inc.indexOf('done') >= 0, backlog: inc.indexOf('backlog') >= 0 };
  if (query.list !== undefined && query.list !== '') { if (query.list !== 'personal' && query.list !== 'work') throw bad('list must be personal or work'); f.list = query.list; }
  if (query.due !== undefined && query.due !== '') { if (['today', 'overdue', 'week', 'none'].indexOf(query.due) < 0) throw bad('due must be today, overdue, week or none'); f.due = query.due; }
  if (typeof query.project === 'string' && query.project.trim()) f.project = query.project.trim().toLowerCase();
  list = pick(rows, f, today);
  if (q !== undefined) {
    var qt = toks(typeof q === 'string' ? q : ''), scored = [], rank;
    if (!qt.length) throw bad('q needs at least one word');
    rank = {};
    for (i = 0; i < list.length; i++) {
      var sc = scoreOf(qt, list[i]);
      if (sc.s >= 0.5) scored.push({ t: list[i], s: sc.s, d: sc.d, g: groupOf(list[i], today) });
    }
    scored.sort(function (a, b) {
      if (a.s !== b.s) return b.s - a.s;
      if (a.d !== b.d) return b.d - a.d;
      var ad = a.g === 8 ? 1 : 0, bd = b.g === 8 ? 1 : 0;
      if (ad !== bd) return ad - bd; // open tasks before finished ones
      return ts(b.t.created_at) - ts(a.t.created_at);
    });
    var lim = intParam(query.limit, 5, 1, 20);
    out = [];
    for (i = 0; i < scored.length && i < lim; i++) { var c = compactOf(scored[i].t, today); c.score = Math.round(scored[i].s * 100) / 100; out.push(c); }
    return { status: 200, body: { today: today, now: nowIso, q: String(q).slice(0, 100), total: scored.length, shown: out.length, tasks: out } };
  }
  var ordered = order(list, today, proj), lm = intParam(query.limit, 25, 1, 100);
  out = [];
  for (i = 0; i < ordered.length && i < lm; i++) out.push(compactOf(ordered[i], today));
  return { status: 200, body: { today: today, now: nowIso, total: ordered.length, shown: out.length, tasks: out } };
}

// ---------- the write log (x-source) ----------
function sourceOf(req) { // header x-source, letters/digits/dash/underscore up to 20 characters; anything else = not tagged
  var s = req && req.headers && req.headers['x-source'];
  if (typeof s !== 'string') return null;
  s = s.trim();
  return SRC.test(s) ? s : null;
}
var TRACKED = ['title', 'done', 'due_date', 'remind_time', 'category', 'list', 'prio', 'quick', 'must', 'blocked', 'unblock_action', 'low', 'focus_date', 'recur', 'recur_until', 'notes', 'items', 'is_session', 'pproject_id', 'pp_backlog'];
function norm(v) { return v === undefined ? null : v; }
function diff(before, after) { // only the fields whose value changed, as { before:{...}, after:{...} }
  var b = {}, a = {}, i, k;
  for (i = 0; i < TRACKED.length; i++) {
    k = TRACKED[i];
    if (JSON.stringify(norm(before && before[k])) !== JSON.stringify(norm(after && after[k]))) { b[k] = norm(before && before[k]); a[k] = norm(after && after[k]); }
  }
  return { before: b, after: a };
}
function snapshot(row) { // the meaningful fields of a task (empty ones left out), for adds and deletes
  var o = {}, i, k, v;
  if (!row) return null;
  for (i = 0; i < TRACKED.length; i++) {
    k = TRACKED[i]; v = row[k];
    if (v === null || v === undefined || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length)) continue;
    o[k] = v;
  }
  return o;
}

module.exports = { read: read, sourceOf: sourceOf, diff: diff, snapshot: snapshot, order: order, projectsOf: projectsOf, compactOf: compactOf, toks: toks, likeness: likeness, isOverdue: isOverdue, TRACKED: TRACKED, UUID: UUID, ISO: ISO };
