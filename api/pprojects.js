// /api/pprojects — Personal Projects (your apps, home projects ...). Separate from Work projects (/api/projects).
//   GET                      -> { projects: [{id, name, status, created_at, meta, pos, open, done, done_old, last_at, costs}] }
//                               costs = [{id, name, amount, currency, freq, next_due, link, email}] (subscriptions/costs)
//                               in hand-made order (pos ascending; each lane shows its projects in this order)
//                               open/done = all-time task counts; done_old = finished more than 7 days ago (not in GET /api/todos);
//                               last_at = latest activity. meta = { sites:[url], links:[{l,u}], vercel, supabase, github, desc,
//                               reason, started, target, icon, acct_vercel, acct_supabase, acct_github }
//                               (reason: plain text, max 300; acct_*: which account/team/org, plain text, max 80, never passwords)
//                               icon_kind: 'upload' | 'site' | 'none' | null, icon_at: ms (stored icon, see ?icon=)
//   GET ?events=<id>         -> { events: [{at, k, t}] }   that project's activity, newest first
//   GET ?deploy=1            -> { configured, status: { <project id>: {state, color, url, at} } }   latest production deploy of
//                               each project with a Vercel link; state PAUSED (color 'paused') when the project is paused in
//                               Vercel (needs env VERCEL_TOKEN; cached ~5 min)
//   GET ?vercel=1            -> { configured, projects: [{team, name, paused}] }   your Vercel projects, for the picker
//   GET ?vercel=<team>/<name> -> { vercel, sites:[url], github }   links to fill in from one Vercel project
//   POST {name, status?, meta?}      -> create                         -> { project }
//   PATCH ?id {name?, status?, meta?} -> update; meta replaces the details (empty fields are dropped) -> { project }
//                               a changed reason is logged as its own activity entry
//   PATCH ?order=1 {ids:[...]}  -> reorder (drag and drop): these projects swap among the places they already hold,
//                               in the order given -> { pos: {<id>: n} }. New projects go to the top.
//   DELETE ?id               -> remove (its tasks stay, they just lose the link; its costs go with it)
//   POST ?vault=1 {action, ...} -> the vault (sensitive values per project), handled by api/_vault.js; see its header
//   ?jobs=1|stages|quick     -> the Jobs tab (application tracker), handled by api/_jobs.js; see its header (not about projects)
//   POST ?cost=1 {project_id, name, amount, currency?, freq?, next_due?, link?, email?} -> add a cost -> { cost }
//   PATCH ?cost=<id> {name, amount, currency?, freq?, next_due?, link?, email?}       -> replace a cost -> { cost }
//   DELETE ?cost=<id>        -> remove a cost
//   GET ?icon=<id>[&v=<icon_at>]&t=<token> -> the project's stored icon image (for <img src>; cached)
//   POST ?icon=<id> {data (base64 PNG/JPEG, max 200 KB), mime} -> upload a custom icon (resized in the browser)
//   POST ?icon=<id> {from:'site'} -> fetch the first website's icon now and store a copy (422 if the site can't be read)
//   DELETE ?icon=<id>        -> remove the icon: the card shows the first letter and the site is not asked again
//        Stored icons keep showing when a site is paused or down. When a website's icon is found while saving details,
//        a copy is stored too (unless an upload or a removal is in place).
//        currency: 3 letters, default GBP; freq: 'monthly' | 'yearly' | 'one_off' (default monthly); next_due YYYY-MM-DD;
//        link https only; max 30 per project. Adding/changing/removing a cost is written to the activity log.
//        Separate from Budget's bills (monthly GBP entries in the budget config with no ids), so nothing is shared.
// status: 'idea' | 'in_progress' | 'live' | 'paused' | 'not_pursued' | 'shut_down' ('active' is accepted as 'in_progress').
// Tasks of idea / paused / not_pursued / shut_down projects are shelved (out of Overdue and the counts).
// Links must be https. When the first website changes the server looks up its icon once and stores it as meta.icon;
// a failed lookup (site down or paused) keeps the stored icon. Link a task with PATCH /api/todos?id {pproject_id, pp_backlog}.
// Names are unique ignoring capitalisation (max 60 characters). Needs db/setup14.sql to setup19.sql.
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var STATUS = ['idea', 'in_progress', 'live', 'paused', 'not_pursued', 'shut_down', 'active'];
var META_KEYS = ['vercel', 'supabase', 'github', 'desc', 'reason', 'started', 'target', 'acct_vercel', 'acct_supabase', 'acct_github'];
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
    if (k === 'reason') { out[k] = v.slice(0, 300); continue; }
    if (k.indexOf('acct_') === 0) { out[k] = v.replace(/[\u0000-\u001f]/g, '').slice(0, 80); continue; }
    v = httpsOf(v); if (v) out[k] = v;
  }
  return out;
}
var FREQ = ['monthly', 'yearly', 'one_off'];
function cleanCost(b) { // -> {cost} or {error}
  b = b || {};
  var name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'name required' };
  var amount = typeof b.amount === 'number' ? b.amount : parseFloat(String(b.amount == null ? '' : b.amount).replace(/[£$€,\s]/g, ''));
  if (!isFinite(amount) || amount < 0 || amount >= 1e8) return { error: 'amount must be a number' };
  var cur = typeof b.currency === 'string' && b.currency.trim() ? b.currency.trim().toUpperCase() : 'GBP';
  if (!/^[A-Z]{3}$/.test(cur)) return { error: 'currency must be 3 letters, e.g. GBP' };
  var freq = b.freq || 'monthly';
  if (FREQ.indexOf(freq) < 0) return { error: 'bad frequency' };
  var due = typeof b.next_due === 'string' && b.next_due.trim() ? b.next_due.trim() : null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: 'bad date' };
  var link = null;
  if (typeof b.link === 'string' && b.link.trim()) { link = httpsOf(b.link); if (!link) return { error: 'the link must be a public https address' }; }
  var email = typeof b.email === 'string' && b.email.trim() ? b.email.trim().toLowerCase() : null;
  if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120)) return { error: 'that email does not look right' };
  return { cost: { name: name, amount: Math.round(amount * 100) / 100, currency: cur, freq: freq, next_due: due, link: link, email: email } };
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

// Download an icon image (max 200 KB) and check it really is one: PNG, JPEG, GIF, ICO or WebP (never SVG, which can carry script).
var ICON_MAX = 200000;
function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length > 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
async function fetchIcon(u) {
  if (!safeHttps(u)) return null;
  try {
    var r = await timed(fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'luc-todo icon lookup' } }), 4000);
    if (!r.ok || (r.url && !safeHttps(r.url))) return null;
    var len = +(r.headers.get('content-length') || 0); if (len > ICON_MAX) return null;
    var buf = Buffer.from(await timed(r.arrayBuffer(), 4000));
    var mime = buf.length <= ICON_MAX ? sniff(buf) : null;
    return mime ? { mime: mime, data: buf.toString('base64') } : null;
  } catch (e) { return null; }
}
async function storeSiteIcon(token, id, iconUrl, force) { // best effort: a stored copy keeps working when the site is paused
  var img = await fetchIcon(iconUrl); if (!img) return null;
  try { return await todos.rpc('picon_set', { p_token: token, p_project: id, p_kind: 'site', p_mime: img.mime, p_data: img.data, p_force: !!force }); } catch (e) { return null; }
}
async function projectById(token, id) {
  var list = (await todos.rpc('pproj_list', { p_token: token })) || [], i;
  for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
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
  if (q.vault !== undefined) return require('./_vault.js')(req, res); // the vault (its own contract: see api/_vault.js)
  if (q.jobs !== undefined) return require('./_jobs.js')(req, res); // the Jobs tab (its own contract: see api/_jobs.js)
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      if (q.icon !== undefined) {
        if (!UUID.test(String(q.icon))) return send(res, 400, { error: 'bad id' });
        var ic = await todos.rpc('picon_get', { p_token: token, p_project: String(q.icon) });
        res.statusCode = 200;
        res.setHeader('Content-Type', ic.mime || 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); // the page adds &v=<icon_at>, so a new icon gets a new address
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        return res.end(Buffer.from(ic.data, 'base64'));
      }
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
    if (q.icon !== undefined) { // stored / custom icons
      var iid = String(q.icon);
      if (!UUID.test(iid)) return send(res, 400, { error: 'bad id' });
      if (req.method === 'DELETE') return send(res, 200, await todos.rpc('picon_set', { p_token: token, p_project: iid, p_kind: 'none', p_mime: null, p_data: null, p_force: true }));
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (b.from === 'site') {
        var pr = await projectById(token, iid); if (!pr) return send(res, 404, { error: 'not found' });
        var site = pr.meta && pr.meta.sites && pr.meta.sites[0];
        if (!site) return send(res, 422, { error: 'add a website first' });
        var iu = await findIcon(site), st = iu ? await storeSiteIcon(token, iid, iu, true) : null;
        if (!st || !st.stored) return send(res, 422, { error: 'could not get an icon from the website (it may be paused or down)' });
        return send(res, 200, st);
      }
      if (typeof b.data !== 'string' || ['image/png', 'image/jpeg'].indexOf(b.mime) < 0) return send(res, 400, { error: 'send a PNG or JPEG' });
      var ub = Buffer.from(b.data, 'base64');
      if (!ub.length || ub.length > ICON_MAX) return send(res, 400, { error: 'that image is too big' });
      if (sniff(ub) !== b.mime) return send(res, 400, { error: 'that is not a PNG or JPEG' });
      return send(res, 200, await todos.rpc('picon_set', { p_token: token, p_project: iid, p_kind: 'upload', p_mime: b.mime, p_data: ub.toString('base64'), p_force: true }));
    }
    if (q.cost !== undefined) { // subscriptions / costs
      var cid = String(q.cost);
      if (req.method === 'DELETE') {
        if (!UUID.test(cid)) return send(res, 400, { error: 'bad id' });
        await todos.rpc('pcost_delete', { p_token: token, p_id: cid });
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'POST' && req.method !== 'PATCH') return send(res, 405, { error: 'method not allowed' });
      var cc = cleanCost(b);
      if (cc.error) return send(res, 400, { error: cc.error });
      if (req.method === 'POST' && (typeof b.project_id !== 'string' || !UUID.test(b.project_id))) return send(res, 400, { error: 'bad project' });
      if (req.method === 'PATCH' && !UUID.test(cid)) return send(res, 400, { error: 'bad id' });
      var saved = await todos.rpc('pcost_save', { p_token: token, p_id: req.method === 'PATCH' ? cid : null, p_project: req.method === 'POST' ? b.project_id : null, p_cost: cc.cost });
      return send(res, req.method === 'POST' ? 201 : 200, { cost: saved });
    }
    if (req.method === 'PATCH' && q.order !== undefined) {
      var ids = Array.isArray(b.ids) ? b.ids : null;
      if (!ids || !ids.length || ids.length > 200 || ids.some(function (x) { return typeof x !== 'string' || !UUID.test(x); })) return send(res, 400, { error: 'bad order' });
      return send(res, 200, { pos: (await todos.rpc('pproj_order', { p_token: token, p_ids: ids })) || {} });
    }
    if (b.status !== undefined && STATUS.indexOf(b.status) < 0) return send(res, 400, { error: 'bad status' });
    if (b.meta !== undefined) {
      if (!b.meta || typeof b.meta !== 'object' || Array.isArray(b.meta)) return send(res, 400, { error: 'bad details' });
      meta = cleanMeta(b.meta);
    }
    if (req.method === 'POST') {
      var name = cleanName(b.name);
      if (!name) return send(res, 400, { error: 'name required' });
      if (meta && meta.sites) { var ic0 = await findIcon(meta.sites[0]); if (ic0) meta.icon = ic0; }
      var made = await todos.rpc('pproj_save', { p_token: token, p_id: null, p_name: name, p_status: b.status || 'in_progress', p_meta: meta });
      if (made && made.id && meta && meta.icon) await storeSiteIcon(token, made.id, meta.icon, false);
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
        // keep a stored copy so the icon survives the site being paused: when a new icon was found, or none is stored yet
        if (meta.icon && (found || !(cur && cur.icon_kind))) await storeSiteIcon(token, id, meta.icon, false);
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
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup18.sql first' });
    console.error('pprojects api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
module.exports.parseVercel = parseVercel; // for local tests
module.exports.cleanMeta = cleanMeta;
module.exports.cleanCost = cleanCost;
module.exports.sniff = sniff;
module.exports.fetchIcon = fetchIcon;
module.exports.findIcon = findIcon;
