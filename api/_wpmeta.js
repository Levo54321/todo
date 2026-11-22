// Work project page details (work_projects.meta) and the Work people list; used by api/projects.js.
// A leading _ means this file is not a serverless function of its own (12-function limit).
// meta shape (every key optional, left out when not set):
//   { owner, requester, recruiter: work_people ids (12 hex),
//     goal, success: plain text up to 2000 characters,
//     rag: 'r' | 'a' | 'g',
//     dates: { requested, started, target, due: 'YYYY-MM-DD' },
//     links: { slack: [{n, u, init?}], groups: [{n, u}], studies: [{n, u}], other: [{n, u}] }  (init = "Initial request", at most one),
//     codes: [{n, c}] }  (campaign codes: plain text, not links)
var PID = /^[0-9a-f]{12}$/, DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
var PEOPLE = ['owner', 'requester', 'recruiter'], TEXTS = { goal: 2000, success: 2000 };
var DATES = ['requested', 'started', 'target', 'due'], GROUPS = ['slack', 'groups', 'studies', 'other'];
var MAXROWS = 25, MAXNAME = 60, MAXURL = 500, MAXCODE = 100;
var LABEL = { slack: 'Slack', groups: 'Prolific Groups', studies: 'Prolific Studies', other: 'Other links' };

function bad(msg) { var e = new Error(msg); e.bad = true; return e; }
function line(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function text(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function day(v) {
  if (typeof v !== 'string') return '';
  var m = DAY.exec(v.trim()); if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? v.trim() : '';
}
function https(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > MAXURL || /\s/.test(s)) return '';
  try { var u = new URL(s); return u.protocol === 'https:' && u.hostname ? s : ''; } catch (e) { return ''; }
}
function rows(arr, group) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) throw bad('bad ' + group);
  var out = [], init = false;
  arr.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    var n = line(r.n, MAXNAME), raw = typeof r.u === 'string' ? r.u.trim() : '';
    if (!n && !raw) return; // an empty row is simply dropped
    var u = https(raw);
    if (!u) throw bad(LABEL[group] + ': ' + (raw ? 'links must start with https://' : 'add a link for "' + n + '"'));
    var o = { n: n, u: u };
    if (group === 'slack' && r.init === true && !init) { o.init = true; init = true; }
    out.push(o);
  });
  if (out.length > MAXROWS) throw bad(LABEL[group] + ': at most ' + MAXROWS + ' links');
  return out;
}
function codes(arr) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) throw bad('bad codes');
  var out = [];
  arr.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    var n = line(r.n, MAXNAME), c = line(r.c, MAXCODE);
    if (!n && !c) return;
    if (!c) throw bad('Campaign codes: add the code for "' + n + '"');
    out.push({ n: n, c: c });
  });
  if (out.length > MAXROWS) throw bad('Campaign codes: at most ' + MAXROWS);
  return out;
}
// The form's meta -> a patch for wproj_meta_put: only keys that were sent; null = clear that key.
function cleanMeta(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw bad('bad details');
  var p = {}, k, i, d, l, any;
  for (i = 0; i < PEOPLE.length; i++) {
    k = PEOPLE[i]; if (!(k in m)) continue;
    if (m[k] === null || m[k] === '') p[k] = null;
    else if (typeof m[k] === 'string' && PID.test(m[k])) p[k] = m[k];
    else throw bad('bad ' + k);
  }
  for (k in TEXTS) if (k in m) p[k] = text(m[k], TEXTS[k]) || null;
  if ('dates' in m) {
    d = {}; any = false;
    if (m.dates && typeof m.dates === 'object') for (i = 0; i < DATES.length; i++) {
      var raw = m.dates[DATES[i]];
      if (raw == null || raw === '') continue;
      var v = day(raw); if (!v) throw bad('bad date: ' + DATES[i]);
      d[DATES[i]] = v; any = true;
    }
    p.dates = any ? d : null;
  }
  if ('links' in m) {
    l = {}; any = false;
    var src = m.links && typeof m.links === 'object' ? m.links : {};
    for (i = 0; i < GROUPS.length; i++) { var g = rows(src[GROUPS[i]], GROUPS[i]); if (g.length) { l[GROUPS[i]] = g; any = true; } }
    p.links = any ? l : null;
  }
  if ('codes' in m) { var c = codes(m.codes); p.codes = c.length ? c : null; }
  if ('rag' in m) p.rag = cleanRag(m.rag);
  return p;
}
function cleanRag(v) {
  if (v === null || v === '') return null;
  if (v === 'r' || v === 'a' || v === 'g') return v;
  throw bad('bad RAG');
}
function personName(v) { return line(v, 40).replace(/^#+/, '').trim(); }

module.exports = { cleanMeta: cleanMeta, cleanRag: cleanRag, personName: personName, PID: PID, LABEL: LABEL };
