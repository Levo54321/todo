// /api/pprojects — Personal Projects (your apps, home projects ...). Separate from Work projects (/api/projects).
//   GET                      -> { projects: [{id, name, status, created_at, meta, open, done, done_old, last_at}] }
//                               open/done = all-time task counts; done_old = finished more than 7 days ago (not in GET /api/todos);
//                               last_at = latest activity. meta = { sites:[url], links:[{l,u}], vercel, supabase, github, desc,
//                               started, target, icon }
//   GET ?events=<id>         -> { events: [{at, k, t}] }   that project's activity, newest first
//   GET ?deploy=1            -> { configured, status: { <project id>: {state, color, url, at} } }   latest production deploy of
//                               each project with a Vercel link; state PAUSED (color 'paused') when the project is paused in
//                               Vercel (needs env VERCEL_TOKEN; cached ~5 min)
//   GET ?vercel=1            -> { configured, projects: [{team, name, paused}] }   your Vercel projects, for the picker
//   GET ?vercel=<team>/<name> -> { vercel, sites:[url], github }   links to fill in from one Vercel project
//   POST {name, status?, meta?}      -> create                         -> { project }
//   PATCH ?id {name?, status?, meta?} -> update; meta replaces the details (empty fields are dropped) -> { project }
//   DELETE ?id               -> remove (its tasks stay, they just lose the link)
// status: 'in_progress' | 'live' | 'paused' | 'not_pursued' | 'shut_down' ('active' is accepted as 'in_progress').
// Links must be https. When the first website changes the server looks up its icon once and stores it as meta.icon;
// a failed lookup (site down or paused) keeps the stored icon. Link a task with PATCH /api/todos?id {pproject_id, pp_backlog}.
// Names are unique ignoring capitalisation (max 60 characters). Needs db/setup14.sql, setup15.sql and setup16.sql.
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var STATUS = ['in_progress', 'live', 'paused', 'not_pursued', 'shut_down', 'active'];
var META_KEYS = ['vercel', 'supabase', 'github', 'desc', 'started', 'target'];
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
function httpsOf(v) { // "edge-keeper.vercel.app" -> "https://edge-keeper.vercel.app"; null if not a public https address
  v = typeof v === 'string' ? v.trim() : '';
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  v = v.replace(/^http:\/\//i, 'https://').slice(0, 300);
  return safeHttps(v) ? v : null;
}
function cleanMeta(m) { // trims, keeps known keys; links must be https (the database checks again)
  var out = {}, i, k, v, seen = {};
  if (!m || typeof m !== 'object') return out;
  var sites = [].concat(Array.isArray(m.sites) ? m.sites : [], m.site ? [m.site] : []);
  for (i = 0; i < sites.length && (out.sites || []).length < 8; i++) {
    v = httpsOf(sites[i]); if (!v || seen[v]) continue; seen[v] = 1; (out.sites = out.sites || []).push(v);
  }
  var links = [].concat(m.claude ? [{ l: 'Claude', u: m.claude }] : [], Array.isArray(m.links) ? m.links : []);
  for (i = 0; i < links.length && (out.links || []).length < 12; i++) {
    if (!links[i] || typeof links[i] !== 'object') continue;
    v = httpsOf(links[i].u); if (!v || seen[v]) continue; seen[v] = 1;
    (out.links = out.links || []).push({ l: (typeof links[i].l === 'string' && links[i].l.trim() ? links[i].l.trim().slice(0, 40) : (/claude\.ai/i.test(v) ? 'Claude' : 'Link')), u: v });
  }
  for (i = 0; i < META_KEYS.length; i++) {
    k = META_KEYS[i]; v = typeof m[k] === 'string' ? m[k].trim() : '';
    if (!v) continue;
    if (k === 'started' || k === 'target') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v; continue; }
    if (k === 'desc') { out[k] = v.slice(0, 200); continue; }
    v = httpsOf(v); if (v) out[k] = v;
  }
  return out;
}
function timed(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]); }

// Find a site's icon: its apple-touch-icon or icon link, else /favicon.ico. Best effort, ~4s.
// Returns null when the site cannot be read (down, paused in Vercel = 503 DEPLOYMENT_PAUSED, timeout): the caller then
// keeps the icon it already has. A failed lookup never clears or replaces a stored icon.
async function findIcon(site) {
  var base = safeHttps(site); if (!base) return null;
  var fallback = new URL('/favicon.ico', base).href;
  try {
    var r = await timed(fetch(base.href, { redirect: 'follow', headers: { 'User-Agent': 'luc-todo icon lookup' } }), 4000);
    if (!r.ok) return null;
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
  } catch (e) { return null; }
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
function vget(path) { // GET from the Vercel API with VERCEL_TOKEN
  return timed(fetch('https://api.vercel.com' + path, { headers: { Authorization: 'Bearer ' + process.env.VERCEL_TOKEN } }), 6000)
    .then(function (r) { return r.ok ? r.json() : Promise.reject(Object.assign(new Error('vercel ' + r.status), { status: r.status })); });
}
function isPaused(pr) { return !!pr && (pr.paused === true || pr.paused === 'true'); }
async function vercelProjects() { // every project in every team the token can see
  var teams = [], out = [], i, j;
  try { var t = await vget('/v2/teams?limit=20'); teams = (t && t.teams) || []; } catch (e) { teams = []; }
  if (!teams.length) teams = [null];
  for (i = 0; i < teams.length; i++) {
    var slug = teams[i] && teams[i].slug, from = null, pages = 0;
    do {
      var d = await vget('/v9/projects?limit=100' + (slug ? '&slug=' + encodeURIComponent(slug) : '') + (from ? '&from=' + encodeURIComponent(from) : ''));
      var ps = (d && d.projects) || [];
      for (j = 0; j < ps.length; j++) out.push({ team: slug || '', name: ps[j].name, paused: isPaused(ps[j]) });
      from = d && d.pagination && d.pagination.next; pages++;
    } while (from && pages < 5);
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  return out;
}
async function vercelInfo(team, name) { // links to fill in from one project: production domains and its Git repo
  var qs = team ? '?slug=' + encodeURIComponent(team) : '', pr = await vget('/v9/projects/' + encodeURIComponent(name) + qs);
  var sites = [], gh = null, lk = pr && pr.link, i;
  if (lk && lk.type === 'github' && (lk.org || lk.repoOwner) && (lk.repo || lk.repoSlug)) gh = 'https://github.com/' + (lk.org || lk.repoOwner) + '/' + (lk.repo || lk.repoSlug);
  try {
    var dm = await vget('/v9/projects/' + encodeURIComponent(name) + '/domains' + qs + (qs ? '&' : '?') + 'production=true&redirects=false&limit=50');
    var ds = (dm && dm.domains) || [];
    for (i = 0; i < ds.length; i++) {
      var n = String(ds[i].name || '').toLowerCase();
      if (!n || ds[i].redirect || /-git-/.test(n) || (team && n.slice(-('-' + team + '.vercel.app').length) === '-' + team + '.vercel.app')) continue;
      sites.push(n);
    }
  } catch (e) {}
  sites.sort(function (a, b) { var x = /\.vercel\.app$/.test(a) ? 1 : 0, y = /\.vercel\.app$/.test(b) ? 1 : 0; return x !== y ? x - y : a.length - b.length; });
  return { vercel: 'https://vercel.com/' + (team ? team + '/' : '') + encodeURIComponent(name), sites: sites.map(function (n) { return 'https://' + n; }), github: gh, paused: isPaused(pr) };
}

async function deployStatus(list) {
  var tok = process.env.VERCEL_TOKEN;
  if (!tok) return { configured: false, status: {} };
  var want = [], i, v;
  for (i = 0; i < list.length; i++) {
    v = parseVercel(list[i].meta && list[i].meta.vercel);
    var ss = list[i].meta && (list[i].meta.sites || (list[i].meta.site ? [list[i].meta.site] : []));
    if (v) want.push({ id: list[i].id, v: v, site: ss && ss[0] && safeHttps(ss[0]) ? ss[0] : null });
  }
  var key = JSON.stringify(want);
  if (deployCache.data && deployCache.key === key && Date.now() - deployCache.at < DEPLOY_TTL) return deployCache.data;
  var status = {};
  await Promise.all(want.map(async function (w) {
    try {
      var url = 'https://api.vercel.com/v6/deployments?projectId=' + encodeURIComponent(w.v.project) + '&target=production&limit=1&slug=' + encodeURIComponent(w.v.team);
      var both = await Promise.all([
        timed(fetch(url, { headers: { Authorization: 'Bearer ' + tok } }), 6000),
        vget('/v9/projects/' + encodeURIComponent(w.v.project) + '?slug=' + encodeURIComponent(w.v.team)).catch(function () { return null; })
      ]), r = both[0];
      if (!r.ok) { status[w.id] = { state: 'UNKNOWN', color: 'grey', error: r.status === 404 ? 'project not found' : 'vercel ' + r.status }; return; }
      if (isPaused(both[1])) { status[w.id] = { state: 'PAUSED', color: 'paused' }; return; } // paused in Vercel: not live
      var d = await r.json(), dep = d && d.deployments && d.deployments[0];
      if (!dep) { status[w.id] = { state: 'NONE', color: 'grey' }; return; }
      var st = dep.state || dep.readyState || 'UNKNOWN';
      if (st === 'READY' && w.site) { // a paused project serves 503 DEPLOYMENT_PAUSED to visitors: double-check the live site
        try {
          var sr = await timed(fetch(w.site, { method: 'HEAD', redirect: 'manual' }), 4000), xe = String(sr.headers.get('x-vercel-error') || '');
          if (sr.status === 503 && /PAUSED/i.test(xe)) { status[w.id] = { state: 'PAUSED', color: 'paused' }; return; }
        } catch (se) {}
      }
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
      if (q.vercel !== undefined) {
        if (!process.env.VERCEL_TOKEN) return send(res, 200, { configured: false, projects: [] });
        var vq = String(q.vercel);
        if (vq === '1') return send(res, 200, { configured: true, projects: await vercelProjects() });
        var vm = /^([a-z0-9][a-z0-9_.-]{0,99})\/([a-z0-9][a-z0-9_.-]{0,99})$/i.exec(vq);
        if (!vm) return send(res, 400, { error: 'bad project' });
        try { return send(res, 200, await vercelInfo(vm[1], vm[2])); }
        catch (ve) { return send(res, ve.status === 404 ? 404 : 502, { error: ve.status === 404 ? 'Vercel project not found' : 'Vercel did not answer' }); }
      }
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
      if (meta && meta.sites) { var ic = await findIcon(meta.sites[0]); if (ic) meta.icon = ic; }
      var made = await todos.rpc('pproj_save', { p_token: token, p_id: null, p_name: name, p_status: b.status || 'in_progress', p_meta: meta });
      return send(res, 201, { project: made });
    }
    var id = q.id;
    if (typeof id !== 'string' || !UUID.test(id)) return send(res, 400, { error: 'bad id' });
    if (req.method === 'PATCH') {
      var nn = b.name !== undefined ? cleanName(b.name) : null;
      if (b.name !== undefined && !nn) return send(res, 400, { error: 'name required' });
      if (meta) { // keep the stored icon; look again only when the first website changed (or there is none yet)
        var cur = null, list = (await todos.rpc('pproj_list', { p_token: token })) || [], i;
        for (i = 0; i < list.length; i++) if (list[i].id === id) cur = list[i];
        var om = (cur && cur.meta) || {};
        var first = meta.sites && meta.sites[0], ofirst = (om.sites && om.sites[0]) || om.site, found = null;
        if (first && (first !== ofirst || !om.icon)) found = await findIcon(first);
        if (found) meta.icon = found; else if (om.icon) meta.icon = om.icon; // never lose the icon because a lookup failed
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
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup16.sql first' });
    console.error('pprojects api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
module.exports.parseVercel = parseVercel; // for local tests
module.exports.cleanMeta = cleanMeta;
module.exports.findIcon = findIcon;
