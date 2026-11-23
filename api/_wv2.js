// Work project data v2 (23 Nov 2026): the new meta keys, their cleaning, and the one-off migration of old link lists.
// Used by api/_wpmeta.js (cleanMeta), api/projects.js (enrich on save) and tools/wv2_migrate.js. Not a serverless function.
//
// v2 keeps ONE structure with the legacy UI: everything lives in work_projects.meta, and the old keys keep their shape.
// New keys (all optional, left out when not set):
//   links.<group>[] rows may now carry  k  = kind (request|slack|linear|prolific_group|prolific_study|prolific_project|qualtrics|sheet|other)
//                                       id = the link's ID (Prolific group/study ID, Linear HDOR-394, Qualtrics SV_.., Sheet id); editable by hand
//   linear: { id:'HDOR-394', url, title, status, sla:'YYYY-MM-DD'|'YYYY-MM-DDTHH:MM', revenue:number, cur:'USD', description (verbatim, <=8000), synced:ISO }
//   particip: { source:'text', group_ids:['plain codes not tied to a link'] }   (Group IDs shown = ids of Prolific group links + these)
//   deliver: [{ n:'segment name' (may be ''), requested, provided, approved }]   progress = sum(provided) / sum(requested)
//   activity: { last_slack:{ at:ISO, who, where, u:https, text } }
//   prov: { '<field path>': { by:'luc'|'claude'|'auto', src?:https, at:'YYYY-MM-DD' } }   who/what set a value
//   sv: 2   marks a project whose link rows were migrated (projects without links are not touched)
// The deadline shown on the board is dates.due (not the Linear SLA, which is a separate ticket field).
var L = require('./_wlinks.js');
var PERSON_BY = ['luc', 'claude', 'auto'], GROUPS = ['slack', 'groups', 'studies', 'other'];
var ALLOWED = { slack: ['request', 'slack'], groups: ['prolific_group'], studies: ['prolific_study', 'prolific_project'], other: ['linear', 'qualtrics', 'sheet', 'slack', 'other'] };
var DAYRE = /^\d{4}-\d{2}-\d{2}$/, WHENRE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function bad(msg) { var e = new Error(msg); e.bad = true; return e; }
function line(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function text(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function https(v) { var u = typeof v === 'string' ? v.trim() : ''; return u && u.length <= 500 && !/\s/.test(u) && L.parse(u).u ? u : ''; }
function num(v, what, max) {
  if (v === null || v === '' || v === undefined) return null;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  if (!isFinite(n) || n < 0 || n > max) throw bad('bad ' + what);
  return Math.round(n * 100) / 100;
}
function today() { return new Date().toISOString().slice(0, 10); }

function cleanLinear(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('bad linear');
  var o = {}, id, u;
  if (v.id) { id = line(v.id, 30).toUpperCase(); if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id)) throw bad('bad Linear ID'); o.id = id; }
  if (v.url) { u = https(v.url); if (!u) throw bad('Linear link must start with https://'); o.url = u; }
  if (v.title) o.title = line(v.title, 200);
  if (v.status) o.status = line(v.status, 40);
  if (v.sla) { if (!WHENRE.test(String(v.sla))) throw bad('bad SLA date'); o.sla = String(v.sla); }
  var rv = num(v.revenue, 'revenue', 1e9); if (rv !== null) o.revenue = rv;
  if (v.cur) o.cur = line(v.cur, 3).toUpperCase();
  if (v.description) o.description = text(v.description, 8000);
  if (v.synced) { if (!WHENRE.test(String(v.synced))) throw bad('bad sync time'); o.synced = String(v.synced); }
  return Object.keys(o).length ? o : null;
}
function cleanParticip(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('bad participants');
  var o = {}, ids = [];
  if (v.source) o.source = line(v.source, 200);
  if (v.group_ids != null) {
    if (!Array.isArray(v.group_ids)) throw bad('bad group IDs');
    v.group_ids.forEach(function (g) { g = line(g, 64); if (g && ids.indexOf(g) < 0) ids.push(g); });
    if (ids.length > 25) throw bad('at most 25 group IDs');
    if (ids.length) o.group_ids = ids;
  }
  return Object.keys(o).length ? o : null;
}
function cleanDeliver(v) {
  if (v === null) return null;
  if (!Array.isArray(v)) throw bad('bad deliverables');
  var out = [];
  v.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    var req = num(r.requested, 'requested', 1e7), pr = num(r.provided, 'provided', 1e7), ap = num(r.approved, 'approved', 1e7), n = line(r.n, 60);
    if (req === null && pr === null && ap === null && !n) return;
    var o = { n: n }; if (req !== null) o.requested = req; if (pr !== null) o.provided = pr; if (ap !== null) o.approved = ap;
    out.push(o);
  });
  if (out.length > 25) throw bad('at most 25 segments');
  return out.length ? out : null;
}
function cleanActivity(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('bad activity');
  var o = {}, s = v.last_slack, ls = {}, u;
  if (s && typeof s === 'object') {
    if (s.at) { if (!WHENRE.test(String(s.at))) throw bad('bad Slack message time'); ls.at = String(s.at); }
    if (s.who) ls.who = line(s.who, 60);
    if (s.where) ls.where = line(s.where, 80);
    if (s.u) { u = https(s.u); if (!u) throw bad('Slack link must start with https://'); ls.u = u; }
    if (s.text) ls.text = text(s.text, 600);
    if (Object.keys(ls).length) o.last_slack = ls;
  }
  return Object.keys(o).length ? o : null;
}
function cleanProv(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('bad provenance');
  var o = {}, n = 0;
  Object.keys(v).forEach(function (k) {
    var e = v[k]; if (!/^[a-z0-9_.]{1,60}$/.test(k) || !e || typeof e !== 'object') return;
    if (PERSON_BY.indexOf(e.by) < 0) return;
    var r = { by: e.by }; if (e.src) { var u = https(e.src); if (u) r.src = u; }
    if (e.at && DAYRE.test(String(e.at))) r.at = String(e.at);
    o[k] = r; n++;
  });
  if (n > 200) throw bad('too many provenance entries');
  return n ? o : null;
}
// Adds the v2 keys found in m to the patch p (null clears one). Link rows are cleaned in _wpmeta.js.
function cleanV2(m, p) {
  if ('linear' in m) p.linear = cleanLinear(m.linear);
  if ('particip' in m) p.particip = cleanParticip(m.particip);
  if ('deliver' in m) p.deliver = cleanDeliver(m.deliver);
  if ('activity' in m) p.activity = cleanActivity(m.activity);
  if ('prov' in m) p.prov = cleanProv(m.prov);
  return p;
}
// k / id on a link row: kept only when valid for the list the row is in.
function rowExtras(group, r) {
  var o = {}, id;
  if (typeof r.k === 'string' && L.isKind(r.k) && ALLOWED[group].indexOf(r.k) >= 0) o.k = r.k;
  if (typeof r.id === 'string') { id = line(r.id, 64); if (/^[A-Za-z0-9_.-]{1,64}$/.test(id)) o.id = id; } // typed by hand: any short code; automatic reading is stricter (ID_OK)
  return o;
}

// ---- migration / enrichment of link rows
function linearFrom(row, by, at) {
  var p = L.parse(row.u); if (p.kind !== 'linear') return null;
  var lin = { id: p.id, url: row.u }; if (p.linear.title) lin.title = p.linear.title;
  var prov = {}; prov['linear.id'] = { by: by, src: row.u, at: at }; if (lin.title) prov['linear.title'] = { by: by, src: row.u, at: at };
  return { linear: lin, prov: prov };
}
// Fills k and id on every row that lacks them; copies k/id from `known` (url -> {k,id}) first. Returns the new links object.
function fillRows(links, known) {
  var out = {};
  GROUPS.forEach(function (g) {
    if (!Array.isArray(links[g])) return;
    out[g] = links[g].map(function (r) {
      var o = { n: r.n, u: r.u }; if (r.init) o.init = true;
      var k = r.k, id = r.id, c = known && known[r.u];
      if (!k && c && c.k && ALLOWED[g].indexOf(c.k) >= 0) k = c.k;
      if (!id && c && c.id) id = c.id;
      if (!k) k = L.kindFor(g, r);
      if (!id) id = L.idFor(k, r.u);
      o.k = k; if (id) o.id = id;
      return o;
    });
  });
  return out;
}
function knownRows(links) {
  var m = {};
  GROUPS.forEach(function (g) { (links && links[g] || []).forEach(function (r) { if (r && r.u && (r.k || r.id)) m[r.u] = { k: r.k, id: r.id }; }); });
  return m;
}
// First Linear issue link among the rows, in list order.
function firstLinear(links) {
  var i, g, rows;
  for (g = 0; g < GROUPS.length; g++) { rows = links[GROUPS[g]] || []; for (i = 0; i < rows.length; i++) if (L.parse(rows[i].u).kind === 'linear') return rows[i]; }
  return null;
}
// A cleaned patch from the legacy or new UI -> the same patch with k/id on every link row and, when the project has no
// Linear ticket yet, meta.linear taken from its first Linear link. Existing values are never overwritten.
function enrich(existing, patch, day) {
  if (!patch || !patch.links) return patch;
  var p = {}, k; for (k in patch) p[k] = patch[k];
  p.links = fillRows(patch.links, knownRows(existing && existing.links));
  var hasLinear = (existing && existing.linear && existing.linear.id) || ('linear' in patch && patch.linear);
  var fl = hasLinear ? null : firstLinear(p.links);
  if (fl) { var lf = linearFrom(fl, 'auto', day || today()); if (lf) { p.linear = lf.linear; p.prov = Object.assign({}, (patch.prov !== undefined ? patch.prov : existing && existing.prov) || {}, lf.prov); } }
  return p;
}

// One project's stored meta -> {meta, changes:[text], warnings:[text]}. Pure and idempotent; nothing is removed or renamed.
function migrateMeta(meta, day) {
  var m = JSON.parse(JSON.stringify(meta || {})), changes = [], warnings = [], g, links = m.links;
  day = day || today();
  if (links && typeof links === 'object') {
    var before = JSON.stringify(links), counts = {};
    var filled = fillRows(links, null);
    GROUPS.forEach(function (gr) {
      (filled[gr] || []).forEach(function (r, i) {
        var o = links[gr][i];
        if (!o.k) { counts[r.k] = (counts[r.k] || 0) + 1; }
        if ((gr === 'groups' || gr === 'studies') && !r.id) warnings.push((gr === 'groups' ? 'Group' : 'Study') + ' "' + (r.n || r.u) + '": no ID could be read from the link (add it by hand)');
      });
    });
    m.links = filled;
    Object.keys(counts).forEach(function (k) { changes.push(counts[k] + ' link' + (counts[k] > 1 ? 's' : '') + ' typed as ' + k); });
    if (JSON.stringify(m.links) === before) changes = [];
    if (!(m.linear && m.linear.id)) {
      var fl = firstLinear(m.links);
      if (fl) {
        var lf = linearFrom(fl, 'auto', day);
        m.linear = lf.linear; m.prov = Object.assign({}, m.prov || {}, lf.prov);
        changes.push('Linear ticket ' + lf.linear.id + (lf.linear.title ? ' "' + lf.linear.title + '"' : '') + ' read from its link');
        var n = 0; GROUPS.forEach(function (gr) { (m.links[gr] || []).forEach(function (r) { if (r.k === 'linear' && r.id !== lf.linear.id) n++; }); });
        if (n) warnings.push(n + ' more Linear link' + (n > 1 ? 's' : '') + ' kept as links only');
      }
    }
  }
  if (links && typeof links === 'object' && m.sv !== 2) m.sv = 2; // marks a project whose link rows were migrated; projects without links are left exactly as they are
  return { meta: m, changes: changes, warnings: warnings };
}
// Every old link row (name + url) must still be in exactly one place after the migration. -> [] when none is lost.
function lostLinks(oldMeta, newMeta) {
  var lost = [];
  GROUPS.forEach(function (g) {
    ((oldMeta && oldMeta.links && oldMeta.links[g]) || []).forEach(function (r, i) {
      var n = newMeta && newMeta.links && newMeta.links[g] && newMeta.links[g][i];
      if (!n || n.u !== r.u || n.n !== r.n || !!n.init !== !!r.init) lost.push(g + '[' + i + '] ' + (r.n || '') + ' ' + r.u);
    });
  });
  return lost;
}

module.exports = { cleanV2: cleanV2, rowExtras: rowExtras, enrich: enrich, migrateMeta: migrateMeta, lostLinks: lostLinks, fillRows: fillRows, bad: bad };
