// Work status updates (v36): the todo-status block parser, cleaning, and the "Copy for Claude" export; used by api/projects.js.
// A leading _ means this file is not a serverless function of its own (12-function limit). Format: docs/work-status-format.md.
// parse(text, projects, opts) never throws and never saves anything:
//   { ok:true, version, exported, entries:[{ref, project:{id,name}, by:'id'|'name', update:{...}}], skipped:[{ref, label, why}], warnings:[] }
//   { ok:false, error:'plain English reason' }
// An update (cleaned): { period?, rag?:'r'|'a'|'g', headline, done[], next[], blockers[], risks[], decisions[], asks:[{who,what}],
//   sources:{slack?:[{n,u}], linear?:[{n,u}]}, notes? }. Strings are trimmed to one line (lists: <=12 items of <=300 chars); links must be https.
var crypto = require('crypto');
var VERSION = 1, PID = /^[0-9a-f]{12}$/;
var LISTS = ['done', 'next', 'blockers', 'risks', 'decisions'], SRC = ['slack', 'linear'];
var MAXITEMS = 12, MAXITEM = 300, MAXLINKS = 10, MAXENTRIES = 60;

function line(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : ''; }
function text(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function https(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 500 || /\s/.test(s)) return '';
  try { var u = new URL(s); return u.protocol === 'https:' && u.hostname ? s : ''; } catch (e) { return ''; }
}
function rag(v) {
  if (typeof v !== 'string') return '';
  var s = v.trim().toLowerCase();
  if (s === 'r' || s === 'red') return 'r';
  if (s === 'a' || s === 'amber' || s === 'yellow') return 'a';
  if (s === 'g' || s === 'green') return 'g';
  return '';
}
function list(v) {
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v)) return [];
  var out = [];
  v.forEach(function (x) { var s = line(x, MAXITEM); if (s && out.length < MAXITEMS) out.push(s); });
  return out;
}
function asks(v) {
  if (!Array.isArray(v)) return [];
  var out = [];
  v.forEach(function (x) {
    if (typeof x === 'string') x = { what: x };
    if (!x || typeof x !== 'object') return;
    var w = line(x.who, 60), t = line(x.what, MAXITEM);
    if ((w || t) && out.length < MAXITEMS) out.push({ who: w, what: t });
  });
  return out;
}
function links(v, warn, label) {
  if (!Array.isArray(v)) return [];
  var out = [];
  v.forEach(function (x) {
    if (typeof x === 'string') x = { u: x };
    if (!x || typeof x !== 'object') return;
    var u = https(x.u);
    if (!u) { if (x.u) warn.push(label + ': a link was dropped (links must start with https://)'); return; }
    if (out.length < MAXLINKS) out.push({ n: line(x.n, 60), u: u });
  });
  return out;
}
// One update object -> the cleaned update, or null when it has no headline. warn collects plain-English notes.
function cleanUpdate(u, warn, label) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  var h = line(u.headline, 200);
  if (!h) return null;
  var o = { headline: h }, period = line(u.period, 60), r = rag(u.rag), i, s = {};
  if (period) o.period = period;
  if (r) o.rag = r; else if (u.rag) warn.push(label + ': "' + line(u.rag, 20) + '" is not red, amber or green, so no RAG is suggested');
  for (i = 0; i < LISTS.length; i++) o[LISTS[i]] = list(u[LISTS[i]]);
  o.asks = asks(u.asks);
  var src = u.sources && typeof u.sources === 'object' ? u.sources : {};
  for (i = 0; i < SRC.length; i++) { var l = links(src[SRC[i]], warn, label); if (l.length) s[SRC[i]] = l; }
  o.sources = s;
  var n = text(u.notes, 4000); if (n) o.notes = n;
  return o;
}
// A manual update: headline + notes (+ nothing else).
function cleanManual(m) {
  if (!m || typeof m !== 'object') return null;
  var h = line(m.headline, 200); if (!h) return null;
  var o = { headline: h, done: [], next: [], blockers: [], risks: [], decisions: [], asks: [], sources: {} }, n = text(m.notes, 4000);
  if (n) o.notes = n;
  return o;
}

// Finds the JSON: a ```todo-status fence anywhere in the text, else any fence whose content is JSON with "updates", else bare JSON.
function findBlock(t) {
  var s = String(t == null ? '' : t).replace(/“|”/g, '"').replace(/‘|’/g, "'"), m;
  var tagged = /```[ \t]*todo-status[ \t]*\r?\n([\s\S]*?)```/i.exec(s);
  if (tagged) return tagged[1];
  var re = /```[^\n`]*\r?\n([\s\S]*?)```/g;
  while ((m = re.exec(s))) if (/"updates"/.test(m[1])) return m[1];
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a && /"updates"/.test(s.slice(a, b + 1))) return s.slice(a, b + 1);
  return null;
}

function parse(textIn, projects, opts) {
  opts = opts || {};
  projects = Array.isArray(projects) ? projects : [];
  if (typeof textIn !== 'string' || !/\S/.test(textIn)) return { ok: false, error: 'Nothing to read: paste the update first.' };
  if (textIn.length > 200000) return { ok: false, error: 'That is too much text to read (200 KB limit).' };
  var raw = findBlock(textIn), data;
  if (raw === null) return { ok: false, error: 'No todo-status block found. Ask work Claude for the update in the todo-status format and paste all of it.' };
  try { data = JSON.parse(raw); } catch (e) { return { ok: false, error: 'The todo-status block is not valid JSON (' + String(e.message).slice(0, 80) + '). Copy the whole block again.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'The todo-status block should be a JSON object with "v" and "updates".' };
  if (data.v !== VERSION) return { ok: false, error: 'This update is format version ' + (data.v === undefined ? '(missing)' : line(String(data.v), 10)) + ' but the app reads version ' + VERSION + '. Ask work Claude to use the current format.' };
  if (!Array.isArray(data.updates) || !data.updates.length) return { ok: false, error: 'The block has no updates in it.' };
  var byId = {}, byName = {}, out = { ok: true, version: VERSION, exported: line(data.exported, 10), entries: [], skipped: [], warnings: [] }, seen = {};
  projects.forEach(function (p) { byId[p.id] = p; byName[String(p.name).toLowerCase()] = p; });
  data.updates.forEach(function (e, i) {
    var ref = i + 1, label, p = null, by = '', warn = [];
    if (!e || typeof e !== 'object' || Array.isArray(e)) { out.skipped.push({ ref: ref, label: 'Entry ' + ref, why: 'not an update' }); return; }
    var id = typeof e.id === 'string' ? e.id.trim().toLowerCase() : '', nm = line(e.name, 80);
    label = nm || id || 'Entry ' + ref;
    if (out.entries.length + out.skipped.length >= MAXENTRIES) { out.skipped.push({ ref: ref, label: label, why: 'more than ' + MAXENTRIES + ' updates in one paste' }); return; }
    if (PID.test(id) && byId[id]) { p = byId[id]; by = 'id'; }
    else if (nm && byName[nm.toLowerCase()]) { p = byName[nm.toLowerCase()]; by = 'name'; }
    if (!p) { out.skipped.push({ ref: ref, label: label, why: id && PID.test(id) ? 'no project with that id or name' : 'no project with that name' + (id ? ' (and the id is not a project id)' : '') }); return; }
    if (opts.only && p.id !== opts.only) { out.skipped.push({ ref: ref, label: label, why: 'is for ' + p.name + ', not this project' }); return; }
    if (seen[p.id]) { out.skipped.push({ ref: ref, label: label, why: 'a second update for ' + p.name + ' in the same paste' }); return; }
    var u = cleanUpdate(e, warn, p.name);
    if (!u) { out.skipped.push({ ref: ref, label: label, why: 'no headline' }); return; }
    seen[p.id] = true;
    out.warnings = out.warnings.concat(warn);
    out.entries.push({ ref: ref, project: { id: p.id, name: p.name }, by: by, update: u });
  });
  return out;
}

/* ---------- Copy for Claude ---------- */
function day(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
// rows = wupd_export(): {projects:[{id,name,status,meta,last?}], people:[{id,name}], today}
// -> { text, hash, count }. The hash covers the projects only (not the date), so it changes only when the content does.
function buildExport(rows) {
  var people = {};
  (rows.people || []).forEach(function (p) { people[p.id] = p.name; });
  var list = (rows.projects || []).map(function (p) {
    var m = p.meta || {}, o = { id: p.id, name: p.name, status: p.status === 'hold' ? 'hold' : 'active' };
    if (m.rag) o.rag = m.rag;
    if (m.owner && people[m.owner]) o.owner = people[m.owner];
    if (m.requester && people[m.requester]) o.requester = people[m.requester];
    var sl = (m.links && m.links.slack || []).map(function (l) { var x = { n: l.n || '', u: l.u }; if (l.init) x.init = true; return x; });
    if (sl.length) o.slack = sl;
    var ot = (m.links && m.links.other || []).map(function (l) { return { n: l.n || '', u: l.u }; });
    if (ot.length) o.links = ot;
    if (p.last && p.last.headline) o.last = { at: day(p.last.at), headline: p.last.headline };
    return o;
  });
  var body = JSON.stringify({ v: VERSION, projects: list });
  var hash = crypto.createHash('sha1').update(body).digest('hex');
  var pretty = '{\n"v":' + VERSION + ',"exported":"' + (day(rows.today) || '') + '",\n"projects":[\n' + list.map(function (o) { return JSON.stringify(o); }).join(',\n') + '\n]}';
  var t = 'My open Work projects (todo-projects v' + VERSION + '). Use "id" as the project id in each todo-status update. "init":true marks the Slack thread of the initial request. "last" is the most recent update already in my app.\n```todo-projects\n' + pretty + '\n```';
  return { text: t, hash: hash, count: list.length };
}

module.exports = { parse: parse, cleanUpdate: cleanUpdate, cleanManual: cleanManual, buildExport: buildExport, findBlock: findBlock, VERSION: VERSION };
