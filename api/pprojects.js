// /api/pprojects — Personal Projects (your apps, home projects ...). Separate from Work projects (/api/projects).
//   GET                      -> { projects: [{id, name, status, created_at, meta, open, done, done_old, last_at}] }
//                               open/done = all-time task counts; done_old = finished more than 7 days ago (not in GET /api/todos);
//                               last_at = latest activity. meta = { site, vercel, supabase, github, claude, desc, started, target, icon }
//   GET ?events=<id>         -> { events: [{at, k, t}] }   that project's activity, newest first
//   GET ?deploy=1            -> { configured, status: { <project id>: {state, color, url, at} } }   latest production deploy of
//                               each project with a Vercel link (needs env VERCEL_TOKEN, read-only; cached ~5 min)
//   POST {name, status?, meta?}      -> create                         -> { project }
//   PATCH ?id {name?, status?, meta?} -> update; meta replaces the details (empty fields are dropped) -> { project }
//   DELETE ?id               -> remove (its tasks stay, they just lose the link)
// status: 'active' | 'paused' | 'not_pursued' | 'shut_down'. Links must be https. When the site link changes the server
// looks up the site's icon once and stores it as meta.icon. Link a task with PATCH /api/todos?id {pproject_id, pp_backlog}.
// Names are unique ignoring capitalisation (max 60 characters). Needs db/setup14.sql and db/setup15.sql.
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var STATUS = ['active', 'paused', 'not_pursued', 'shut_down'];
var META_KEYS = ['site', 'vercel', 'supabase', 'github', 'claude', 'desc', 'started', 'target'];
var DEPLOY_TTL = 5 * 60000, deployCache = { at: 0, key: '', data: null };

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
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) || {}; } catch (e) { return {}; }
}
function cleanName(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : ''; }
function safeHttps(u) { // a public https address only (no local or private hosts)
  try {
    var x = new URL(u);
    if (x.protocol !== 'https:') return null;
    var h = x.hostname.toLowerCase();
    if (!h || h === 'localhost' || /\.local(host)?$/.test(h) || /^[\d.]+$/.test(h) || h.indexOf(':') >= 0 || h.indexOf('.') < 0) return null;
    return x;
  } catch (e) { return null; }
}
function cleanMeta(m) { // trims, keeps known keys; links must be https (the database checks again)
  var out = {}, i, k, v;
  if (!m || typeof m !== 'object') return out;
  for (i = 0; i < META_KEYS.length; i++) {
    k = META_KEYS[i]; v = typeof m[k] === 'string' ? m[k].trim() : '';
    if (!v) continue;
    if (k === 'started' || k === 'target') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v; continue; }
    if (k === 'desc') { out[k] = v.slice(0, 200); continue; }
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v; // allow "edge-keeper.vercel.app"
    v = v.replace(/^http:\/\//i, 'https://').slice(0, 300);
    if (safeHttps(v)) out[k] = v;
  }
  return out;
}
function timed(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]); }

// Find a site's icon: its apple-touch-icon or icon link, else /favicon.ico. Best effort, ~4s.
async function findIcon(site) {
  var base = safeHttps(site); if (!base) return null;
  var fallback = new URL('/favicon.ico', base).href;
  try {
    var r = await timed(fetch(base.href, { redirect: 'follow', headers: { 'User-Agent': 'luc-todo icon lookup' } }), 4000);
    if (!r.ok) return fallback;
    var html = (await timed(r.text(), 3000)).slice(0, 200000), tags = html.match(/<link\b[^>]*>/gi) || [], best = null, rank = 0, i;
    for (i = 0; i < tags.length; i++) {
      var rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tags[i]) || [])[1] || '', href = (/\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tags[i]) || [])[1];
      if (!href) continue;
      rel = rel.toLowerCase();
      var k = rel.indexOf('apple-touch-icon') >= 0 ? 3 : (/(^|\s)icon(\s|$)/.test(rel) ? (/\.(png|ico|jpg|jpeg)(\?|$)/i.test(href) ? 2 : 1) : 0);
      if (k > rank) { rank = k; best = href; }
    }
    if (!best) return fallback;
    var abs = new URL(best, r.url || base.href);
    return abs.protocol === 'https:' ? abs.href.slice(0, 300) : fallback;
  } catch (e) { return fallback; }
}

// "https://vercel.com/<team>/<project>[/...]" -> { team, project }
function parseVercel(u) {
  var m = /^https:\/\/vercel\.com\/([^\/?#]+)\/([^\/?#]+)/i.exec(u || '');
  return m ? { team: m[1], project: m[2] } : null;
}
function colorOf(state) {
  if (state === 'READY') return 'green';
  if (state === 'BUILDING' || state === 'QUEUED' || state === 'INITIALIZING') return 'orange';
  return 'red';
}
async function deployStatus(list) {
  var tok = process.env.VERCEL_TOKEN;
  if (!tok) return { configured: false, status: {} };
  var want = [], i, v;
  for (i = 0; i < list.length; i++) { v = parseVercel(list[i].meta && list[i].meta.vercel); if (v) want.push({ id: list[i].id, v: v }); }
  var key = JSON.stringify(want);
  if (deployCache.data && deployCache.key === key && Date.now() - deployCache.at < DEPLOY_TTL) return deployCache.data;
  var status = {};
  await Promise.all(want.map(async function (w) {
    try {
      var url = 'https://api.vercel.com/v6/deployments?projectId=' + encodeURIComponent(w.v.project) + '&target=production&limit=1&slug=' + encodeURIComponent(w.v.team);
      var r = await timed(fetch(url, { headers: { Authorization: 'Bearer ' + tok } }), 6000);
      if (!r.ok) { status[w.id] = { state: 'UNKNOWN', color: 'grey', error: r.status === 404 ? 'project not found' : 'vercel ' + r.status }; return; }
      var d = await r.json(), dep = d && d.deployments && d.deployments[0];
      if (!dep) { status[w.id] = { state: 'NONE', color: 'grey' }; return; }
      var st = dep.state || dep.readyState || 'UNKNOWN';
      status[w.id] = { state: st, color: colorOf(st), at: dep.created || dep.createdAt || null, url: dep.inspectorUrl || null };
    } catch (e) { status[w.id] = { state: 'UNKNOWN', color: 'grey', error: 'unreachable' }; }
  }));
  var out = { configured: true, status: status };
  deployCache = { at: Date.now(), key: key, data: out };
  return out;
}

module.exports = async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      if (q.events !== undefined) {
        if (!UUID.test(String(q.events))) return send(res, 400, { error: 'bad id' });
        return send(res, 200, { events: (await todos.rpc('pproj_events', { p_token: token, p_id: q.events, p_limit: 40 })) || [] });
      }
      var all = (await todos.rpc('pproj_list', { p_token: token })) || [];
      if (q.deploy !== undefined) return send(res, 200, await deployStatus(all));
      return send(res, 200, { projects: all });
    }
    var b = readBody(req), meta = null;
    if (b.status !== undefined && STATUS.indexOf(b.status) < 0) return send(res, 400, { error: 'bad status' });
    if (b.meta !== undefined) {
      if (!b.meta || typeof b.meta !== 'object' || Array.isArray(b.meta)) return send(res, 400, { error: 'bad details' });
      meta = cleanMeta(b.meta);
    }
    if (req.method === 'POST') {
      var name = cleanName(b.name);
      if (!name) return send(res, 400, { error: 'name required' });
      if (meta && meta.site) meta.icon = await findIcon(meta.site);
      var made = await todos.rpc('pproj_save', { p_token: token, p_id: null, p_name: name, p_status: b.status || 'active', p_meta: meta });
      return send(res, 201, { project: made });
    }
    var id = q.id;
    if (typeof id !== 'string' || !UUID.test(id)) return send(res, 400, { error: 'bad id' });
    if (req.method === 'PATCH') {
      var nn = b.name !== undefined ? cleanName(b.name) : null;
      if (b.name !== undefined && !nn) return send(res, 400, { error: 'name required' });
      if (meta) { // keep the icon we already found unless the site changed
        var cur = null, list = (await todos.rpc('pproj_list', { p_token: token })) || [], i;
        for (i = 0; i < list.length; i++) if (list[i].id === id) cur = list[i];
        var om = (cur && cur.meta) || {};
        if (meta.site && meta.site === om.site && om.icon) meta.icon = om.icon;
        else if (meta.site) meta.icon = await findIcon(meta.site);
      }
      var row = await todos.rpc('pproj_save', { p_token: token, p_id: id, p_name: nn, p_status: b.status || null, p_meta: meta });
      return send(res, 200, { project: row });
    }
    if (req.method === 'DELETE') {
      await todos.rpc('pproj_delete', { p_token: token, p_id: id });
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23505') return send(res, 409, { error: 'a project with that name already exists' });
    if (e.code === '23514') return send(res, 400, { error: 'invalid input' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup15.sql first' });
    console.error('pprojects api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
module.exports.parseVercel = parseVercel; // for local tests
module.exports.cleanMeta = cleanMeta;
module.exports.findIcon = findIcon;
