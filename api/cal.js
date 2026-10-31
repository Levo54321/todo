// /api/cal — Apple (iCloud) Calendar sync over CalDAV.
//   GET              -> { connected, apple_id, calendar }            (never returns the password)
//   POST {apple_id, password, calendar}  -> connect (checks the login and finds the calendar)
//   POST ?sync=1     -> reconcile now (pull edits made in Calendar, push app changes)  -> { changed }
//   DELETE           -> disconnect (events already in the calendar are left alone)
// Tasks with a time become events (with an alert) in ONE dedicated calendar. Only events carrying our
// UID suffix (@luc-todo) are ever changed or removed, so other calendars/events are never touched.
var crypto = require('crypto');
var todos = require('./todos.js');
var glance = require('./glance.js');
var ics = require('./ics.js');

var HOME = 'https://caldav.icloud.com/';
var SUFFIX = '@luc-todo';
var TZ = 'Europe/London';

/* ---------- credentials at rest (AES-256-GCM) ---------- */
function key() {
  var k = process.env.CALDAV_KEY || process.env.SUPABASE_KEY || 'luc-todo';
  return crypto.createHash('sha256').update('luc-todo-caldav|' + k).digest();
}
function enc(s) {
  var iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  var b = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return iv.toString('base64') + '.' + c.getAuthTag().toString('base64') + '.' + b.toString('base64');
}
function dec(s) {
  var p = String(s).split('.'), d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(p[0], 'base64'));
  d.setAuthTag(Buffer.from(p[1], 'base64'));
  return Buffer.concat([d.update(Buffer.from(p[2], 'base64')), d.final()]).toString('utf8');
}

/* ---------- tiny XML helpers (iCloud uses varying namespace prefixes) ---------- */
var P = '(?:[\\w-]+:)?';
function blocks(xml, name) {
  var re = new RegExp('<' + P + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + P + name + '>', 'gi'), out = [], m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function first(xml, name) { var b = blocks(xml, name); return b.length ? b[0] : null; }
function unxml(s) {
  s = String(s || '');
  var cd = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(s);
  if (cd) return cd[1];
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&amp;/g, '&');
}
function hrefOf(xml) { var h = first(xml, 'href'); return h ? unxml(h).trim() : null; }

/* ---------- DAV request ---------- */
async function dav(creds, method, url, body, extra, depth) {
  var headers = { Authorization: 'Basic ' + Buffer.from(creds.id + ':' + creds.pw).toString('base64') };
  if (body) headers['Content-Type'] = 'application/xml; charset=utf-8';
  if (depth !== undefined) headers.Depth = String(depth);
  for (var k in extra) if (extra.hasOwnProperty(k)) headers[k] = extra[k];
  for (var hop = 0; hop < 4; hop++) {
    var r = await fetch(url, { method: method, headers: headers, body: body || undefined, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if ([301, 302, 307, 308].indexOf(r.status) >= 0 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).href; continue; }
    var text = await r.text();
    return { status: r.status, text: text, headers: r.headers, url: url };
  }
  throw new Error('too many redirects');
}
function absolute(href, base) { return new URL(href, base).href; }

/* ---------- discovery ---------- */
async function discover(creds) {
  var r = await dav(creds, 'PROPFIND', HOME, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', {}, 0);
  if (r.status === 401) { var e = new Error('Apple rejected the login'); e.code = 'AUTH'; throw e; }
  if (r.status >= 400) throw new Error('Apple Calendar answered ' + r.status);
  var principal = first(r.text, 'current-user-principal');
  var ph = principal && hrefOf(principal);
  if (!ph) throw new Error('could not find the calendar account');
  var pUrl = absolute(ph, r.url);
  r = await dav(creds, 'PROPFIND', pUrl, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>', {}, 0);
  if (r.status >= 400) throw new Error('Apple Calendar answered ' + r.status);
  var chs = first(r.text, 'calendar-home-set'), hh = chs && hrefOf(chs);
  if (!hh) throw new Error('could not find the calendar list');
  var homeUrl = absolute(hh, r.url);
  r = await dav(creds, 'PROPFIND', homeUrl, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>', {}, 1);
  if (r.status >= 400) throw new Error('Apple Calendar answered ' + r.status);
  return { cals: parseCalendars(r.text, r.url), at: Date.now() };
}
function parseCalendars(xml, base) {
  var rs = blocks(xml, 'response'), out = [], i;
  for (i = 0; i < rs.length; i++) {
    var x = rs[i], href = hrefOf(x), rt = first(x, 'resourcetype') || '', name = first(x, 'displayname');
    if (!href || !new RegExp('<' + P + 'calendar(?![\\w-])', 'i').test(rt)) continue;
    var comps = first(x, 'supported-calendar-component-set');
    if (comps && !/VEVENT/i.test(comps)) continue; // reminder lists etc.
    out.push({ url: absolute(href, base).replace(/\/?$/, '/'), name: unxml(name || '').trim() });
  }
  return out;
}

/* ---------- context (credentials + calendar list) ---------- */
var ctxCache = { token: null, at: 0, v: null };
async function readCfg(token) {
  var raw = await todos.rpc('cfg_get', { p_token: token, p_key: 'caldav' });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
async function getCtx(token, fresh) {
  if (!fresh && ctxCache.v && ctxCache.token === token && Date.now() - ctxCache.at < 60000) return ctxCache.v;
  var cfg = await readCfg(token);
  if (!cfg || !cfg.pw) { ctxCache = { token: token, at: Date.now(), v: null }; return null; }
  var creds = { id: cfg.id, pw: dec(cfg.pw) }, st = null;
  try { st = JSON.parse((await todos.rpc('cfg_get', { p_token: token, p_key: 'caldav_state' })) || 'null'); } catch (e) { st = null; }
  if (!st || !st.cals || !st.cals.length || Date.now() - (st.at || 0) > 24 * 3600000 || fresh) {
    st = await discover(creds);
    await todos.rpc('cfg_set', { p_token: token, p_key: 'caldav_state', p_value: JSON.stringify(st) });
  }
  var target = null, i, want = String(cfg.calendar || '').toLowerCase();
  for (i = 0; i < st.cals.length; i++) if (st.cals[i].name.toLowerCase() === want) target = st.cals[i];
  var v = { creds: creds, cals: st.cals, target: target, cfg: cfg };
  ctxCache = { token: token, at: Date.now(), v: v };
  return v;
}
async function enabled(token) {
  try { var c = await getCtx(token); return !!c; } catch (e) { return false; }
}

/* ---------- reading events ---------- */
function reportBody(range) {
  return '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' + (range ? '<c:time-range start="' + range[0] + '" end="' + range[1] + '"/>' : '') + '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
}
function stampDay(iso, add) {
  var d = new Date(Date.parse(iso + 'T00:00:00Z') + add * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, '') + 'T000000Z';
}
async function fetchEvents(ctx, calUrl, range) {
  var r = await dav(ctx.creds, 'REPORT', calUrl, reportBody(range), {}, 1);
  if (r.status >= 400) throw new Error('Apple Calendar answered ' + r.status);
  var rs = blocks(r.text, 'response'), out = [], i;
  for (i = 0; i < rs.length; i++) {
    var data = first(rs[i], 'calendar-data'), href = hrefOf(rs[i]);
    if (!data || !href) continue;
    out.push({ href: absolute(href, r.url), etag: unxml(first(rs[i], 'getetag') || '').replace(/"/g, ''), ics: unxml(data) });
  }
  return out;
}

var evCache = {};
// Events on one day from every calendar except the to-do calendar (those are already your tasks).
async function eventsFor(token, dayIso) {
  var ctx = await getCtx(token);
  if (!ctx) return undefined;
  var ck = token + '|' + dayIso;
  if (evCache[ck] && Date.now() - evCache[ck].at < 5 * 60000) return evCache[ck].v;
  var cals = ctx.cals.filter(function (c) { return !ctx.target || c.url !== ctx.target.url; });
  var range = [stampDay(dayIso, -1), stampDay(dayIso, 2)];
  var all = await Promise.all(cals.map(function (c) { return fetchEvents(ctx, c.url, range).catch(function (e) { console.error('cal', c.name, e.message); return []; }); }));
  var parsed = [], i, j;
  for (i = 0; i < all.length; i++) for (j = 0; j < all[i].length; j++) parsed = parsed.concat(glance.parseICS(all[i][j].ics));
  var v = glance.eventsOn(parsed, dayIso);
  evCache[ck] = { at: Date.now(), v: v };
  return v;
}

/* ---------- task <-> event ---------- */
function uidOf(t) { return (t.series_id || t.id) + SUFFIX; }
function sigOf(t) {
  return crypto.createHash('sha1').update([t.title, t.due_date, String(t.remind_time || '').slice(0, 5), t.recur || '', t.category || ''].concat(t.recur_until ? [t.recur_until] : []).join('|')).digest('hex').slice(0, 16);
}
function icsFor(t, uid) {
  var today = todos.todayISO(), now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  var lines = ics.eventLines(t, today, now);
  lines[1] = 'UID:' + uid; // series share one event; one-offs use their own id
  var out = ics.cal('To-do', lines).replace(/^(METHOD|X-WR-CALNAME|X-WR-TIMEZONE|REFRESH-INTERVAL|X-PUBLISHED-TTL)[^\r\n]*\r\n/gm, '');
  return out;
}
function wallOf(ev) { // event start in London wall-clock {date,time} or null (all-day events are left alone)
  var s = ev && ev.start;
  if (!s || s.allDay) return null;
  var p = glance.parts(glance.dtToMs(s), TZ), pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return { date: p.y + '-' + pad(p.m) + '-' + pad(p.d), time: pad(p.h) + ':' + pad(p.mi) };
}

async function sync(token, ctx) {
  if (!ctx.target) { var e = new Error('calendar "' + ctx.cfg.calendar + '" not found'); e.code = 'NOCAL'; throw e; }
  var started = Date.now(), changed = false, list = await todos.rpc('todo_list', { p_token: token }), i;
  var want = {}, rowsByUid = {};
  for (i = 0; i < list.length; i++) { // one wanted event per series; the earliest open occurrence represents it
    var t = list[i];
    if (t.done || t.list === 'work' || !t.remind_time || !t.due_date) continue; // Work tasks never go to the personal calendar
    var uid = uidOf(t);
    if (!want[uid] || t.due_date < want[uid].due_date) want[uid] = t;
  }
  var evs = await fetchEvents(ctx, ctx.target.url, null), byUid = {}, all = {};
  for (i = 0; i < evs.length; i++) { // Apple Calendar can rewrite an edited event's UID in upper case, so match ignoring case
    var parsed = glance.parseICS(evs[i].ics), hk = '';
    try { hk = decodeURIComponent(String(evs[i].href).split('/').pop()).replace(/\.ics$/i, '').toLowerCase(); } catch (e) { hk = ''; }
    for (var k = 0; k < parsed.length; k++) if (parsed[k].uid && !parsed[k].recId) {
      // Apple can rewrite the UID inside an event it edited, but keeps the file name we gave it: trust the file name when it is ours
      var nk = hk.slice(-SUFFIX.length) === SUFFIX ? hk : String(parsed[k].uid).toLowerCase();
      (all[nk] = all[nk] || []).push({ href: evs[i].href, etag: evs[i].etag, ev: parsed[k] });
      break;
    }
  }
  var jobs = [], uids = Object.keys(want), diag = [];
  function delJob(entry) { return async function () { var r = await dav(ctx.creds, 'DELETE', entry.href, null, {}); if (r.status >= 300 && r.status !== 404) throw new Error('Apple Calendar would not remove an event (' + r.status + ')'); }; }
  for (i = 0; i < uids.length; i++) {
    (function (uid) {
      var t = want[uid], sig = sigOf(t), appSame = t.cal_sig && t.cal_sig === sig && t.cal_uid === uid;
      var group = all[uid] || [], have = group[0] || null, tm5 = String(t.remind_time).slice(0, 5), gi;
      if (group.length > 1) { // duplicates (for example a re-created event): keep one, remove the rest
        var plain = uid + '.ics';
        have = null;
        if (appSame) { for (gi = 0; gi < group.length && !have; gi++) { var gw = wallOf(group[gi].ev); if (gw && (gw.date !== t.due_date || gw.time !== tm5)) have = group[gi]; } } // the one edited in Calendar
        for (gi = 0; gi < group.length && !have; gi++) if (decodeURIComponent(group[gi].href).toLowerCase().slice(-plain.length) === plain.toLowerCase()) have = group[gi];
        if (!have) have = group[0];
        for (gi = 0; gi < group.length; gi++) if (group[gi] !== have) jobs.push(delJob(group[gi]));
      }
      byUid[uid] = have;
      if (!have) delete byUid[uid];
      if (appSame && !have) { // deleted in Calendar: stop reminding, keep the task
        if (diag.length < 12) diag.push({ task: String(t.title).slice(0, 40), app: t.due_date + ' ' + String(t.remind_time).slice(0, 5), n: 0, cal: 'not found', act: 'checking if deleted' });
        jobs.push(async function () {
          var chk = await dav(ctx.creds, 'GET', ctx.target.url + encodeURIComponent(uid) + '.ics', null, {}); // make sure it is really gone, not just slow to list
          if (chk.status !== 404) return;
          await todos.rpc('todo_update', { p_token: token, p_id: t.id, p_patch: { remind_time: null } });
          await todos.rpc('todo_cal_set', { p_token: token, p_id: t.id, p_uid: null, p_etag: null, p_sig: null });
          changed = true;
        });
        return;
      }
      var dg = { task: String(t.title).slice(0, 40), app: t.due_date + ' ' + String(t.remind_time).slice(0, 5), n: group.length, cal: have ? '' : 'missing', act: appSame ? (have ? 'same' : 'gone') : 'app-wins' };
      if (diag.length < 12) diag.push(dg);
      if (appSame && have) { // app unchanged: take over any time/date edit made in Calendar
        var w = wallOf(have.ev), time = String(t.remind_time).slice(0, 5);
        dg.cal = w ? w.date + ' ' + w.time : 'all-day/unreadable';
        if (w && (w.date !== t.due_date || w.time !== time)) dg.act = 'pulled';
        if (w && (w.date !== t.due_date || w.time !== time)) {
          jobs.push(async function () {
            var upd = await todos.rpc('todo_update', { p_token: token, p_id: t.id, p_patch: { due_date: w.date, remind_time: w.time } });
            var nt = upd || t; nt.due_date = w.date; nt.remind_time = w.time;
            await todos.rpc('todo_cal_set', { p_token: token, p_id: t.id, p_uid: uid, p_etag: have.etag || null, p_sig: sigOf(nt) });
            changed = true;
          });
        }
        return;
      }
      jobs.push(async function () { // app changed (or new): the app wins
        var href = have ? have.href : ctx.target.url + encodeURIComponent(uid) + '.ics';
        var r = await dav(ctx.creds, 'PUT', href, icsFor(t, uid), { 'Content-Type': 'text/calendar; charset=utf-8' });
        if (r.status >= 300) throw new Error('Apple Calendar refused the event (' + r.status + ')');
        await todos.rpc('todo_cal_set', { p_token: token, p_id: t.id, p_uid: uid, p_etag: (r.headers.get('etag') || '').replace(/"/g, '') || null, p_sig: sig });
      });
    })(uids[i]);
  }
  // events we created that no longer have a matching open task (done, deleted, time removed)
  var have2 = Object.keys(all);
  for (i = 0; i < have2.length; i++) {
    (function (uid) {
      if (uid.slice(-SUFFIX.length) !== SUFFIX || want[uid]) return;
      for (var oi = 0; oi < all[uid].length; oi++) jobs.push(delJob(all[uid][oi]));
    })(have2[i]);
  }
  var failed = 0, pending = jobs.slice();
  async function worker() {
    while (pending.length && Date.now() - started < 20000) {
      var j = pending.shift();
      try { await j(); } catch (e) { failed++; console.error('cal job', e.message); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { changed: changed, failed: failed + pending.length, diag: diag, events: evs.length };
}

async function syncIfEnabled(token) {
  var ctx = await getCtx(token);
  if (!ctx) return null;
  var r = await sync(token, ctx);
  if (r.failed) throw new Error(r.failed + ' calendar updates failed');
  return r;
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
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) || {}; } catch (e) { return {}; }
}

async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      var cfg = await readCfg(token);
      return send(res, 200, { connected: !!(cfg && cfg.pw), apple_id: cfg && cfg.id || '', calendar: cfg && cfg.calendar || '' });
    }
    if (req.method === 'POST' && q.sync) {
      var ctx = await getCtx(token);
      if (!ctx) return send(res, 200, { changed: false, connected: false });
      var r = await sync(token, ctx);
      return send(res, 200, { changed: r.changed, failed: r.failed, connected: true, diag: r.diag, events: r.events });
    }
    if (req.method === 'POST') {
      var b = readBody(req), id = String(b.apple_id || '').trim(), pw = String(b.password || '').replace(/\s+/g, ''), name = String(b.calendar || '').trim() || 'To-Do';
      if (!id || !pw) return send(res, 400, { error: 'Enter your Apple ID and the app-specific password' });
      var st;
      try { st = await discover({ id: id, pw: pw }); }
      catch (e) { return send(res, e.code === 'AUTH' ? 401 : 502, { error: e.code === 'AUTH' ? 'Apple did not accept that Apple ID and app-specific password. Check both (the password looks like abcd-efgh-ijkl-mnop).' : 'Could not reach Apple Calendar: ' + e.message }); }
      var found = null, names = [], i;
      for (i = 0; i < st.cals.length; i++) { names.push(st.cals[i].name); if (st.cals[i].name.toLowerCase() === name.toLowerCase()) found = st.cals[i]; }
      if (!found) return send(res, 404, { error: 'Logged in, but there is no calendar called "' + name + '". Your calendars: ' + names.join(', ') + '.' });
      await todos.rpc('cfg_set', { p_token: token, p_key: 'caldav', p_value: JSON.stringify({ id: id, pw: enc(pw), calendar: found.name }) });
      await todos.rpc('cfg_set', { p_token: token, p_key: 'caldav_state', p_value: JSON.stringify(st) });
      ctxCache = { token: null, at: 0, v: null };
      var result = { connected: true, apple_id: id, calendar: found.name };
      try { var c2 = await getCtx(token, false); var sr = await sync(token, c2); result.synced = true; result.failed = sr.failed; } catch (e) { result.synced = false; result.syncError = e.message; }
      return send(res, 200, result);
    }
    if (req.method === 'DELETE') {
      await todos.rpc('cfg_set', { p_token: token, p_key: 'caldav', p_value: null });
      await todos.rpc('cfg_set', { p_token: token, p_key: 'caldav_state', p_value: null });
      ctxCache = { token: null, at: 0, v: null };
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'PGRST202' || e.code === '42P01') return send(res, 409, { error: 'run setup6.sql first' });
    console.error('cal api error', e.code, e.message);
    return send(res, 502, { error: e.message || 'upstream error' });
  }
}

module.exports = handler;
module.exports.syncIfEnabled = syncIfEnabled;
module.exports.eventsFor = eventsFor;
module.exports.enabled = enabled;
module.exports._t = { parseCalendars: parseCalendars, blocks: blocks, first: first, unxml: unxml, hrefOf: hrefOf, enc: enc, dec: dec, icsFor: icsFor, sigOf: sigOf, wallOf: wallOf };
