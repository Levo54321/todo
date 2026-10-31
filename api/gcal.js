// /api/gcal — a Google Calendar shown on the screensaver, and (optionally) a calendar your timed Work tasks are added to.
//   GET                 -> { configured, connected, email, calendars:[{id,name,color,primary}], selected:[id], expired }
//   GET ?events=1       -> { events:[...], now }   today + tomorrow from the selected calendars
//   GET ?action=start&t=<token> -> redirects to Google sign-in
//   GET ?code=..&state=.. (Google's redirect back) -> stores the login, redirects to the app
//   POST {selected:[id]} -> choose calendars       POST {refresh:true} -> reload the calendar list
//   GET ?sched=1        -> { map:{ taskId:{on,dur,vis} } }   per-task 'add to calendar' choices
//   POST {wcal:id}      -> choose the calendar timed Work tasks are added to (needs the edit permission)
//   POST {sched:{id,on,dur,vis}, sync:true} -> save a task's choice and update its event now
//   DELETE              -> disconnect (revokes the Google login)
// Needs env GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. The Google refresh token is encrypted at rest.
var crypto = require('crypto');
var todos = require('./todos.js');

var TZ = 'Europe/London';
var REDIRECT = process.env.GOOGLE_REDIRECT_URI || 'https://luc-todo.vercel.app/api/gcal';
var SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events email';

function key() {
  var k = process.env.CALDAV_KEY || process.env.SUPABASE_KEY || 'luc-todo';
  return crypto.createHash('sha256').update('luc-todo-gcal|' + k).digest();
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
function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function sign(payload) { return b64u(crypto.createHmac('sha256', key()).update(payload).digest()); }
function makeState(token) { var p = b64u(JSON.stringify({ t: token, e: Date.now() + 10 * 60000 })); return p + '.' + sign(p); }
function readState(s) {
  var parts = String(s || '').split('.');
  if (parts.length !== 2) return null;
  var want = sign(parts[0]), a = Buffer.from(want), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    var o = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return o && o.e > Date.now() && typeof o.t === 'string' ? o : null;
  } catch (e) { return null; }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function page(res, status, title, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>' +
    '<body style="font:17px/1.5 Georgia,serif;background:#f4eee1;color:#2a2520;padding:40px 24px;max-width:520px;margin:auto"><h2>' + title + '</h2><p>' + text + '</p><p><a href="/">Back to To-Do</a></p>');
}
function readBody(req) {
  var b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) || {}; } catch (e) { return {}; }
}
function configured() { return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }

/* ---------- stored config ---------- */
async function readCfg(token) {
  var raw = await todos.rpc('cfg_get', { p_token: token, p_key: 'gcal' });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function writeCfg(token, cfg) {
  return todos.rpc('cfg_set', { p_token: token, p_key: 'gcal', p_value: cfg ? JSON.stringify(cfg) : null });
}
function view(cfg) {
  return {
    configured: configured(), connected: !!(cfg && cfg.rt), email: (cfg && cfg.email) || '',
    calendars: (cfg && cfg.cals) || [], selected: (cfg && cfg.sel) || [], expired: !!(cfg && cfg.expired),
    can_write: !!(cfg && cfg.canWrite), write_cal: (cfg && cfg.wcal) || '',
    redirect_uri: REDIRECT
  };
}

/* ---------- Google calls ---------- */
async function form(url, params) {
  var r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(10000)
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j: j || {} };
}
async function gget(url, at) {
  var r = await fetch(url, { headers: { Authorization: 'Bearer ' + at }, signal: AbortSignal.timeout(10000) });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j: j || {} };
}
async function greq(method, url, at, body) {
  var r = await fetch(url, {
    method: method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000)
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j: j || {} };
}
var atCache = {};
async function accessToken(token, cfg) {
  var c = atCache[token];
  if (c && c.exp > Date.now() + 60000) return c.at;
  var r = await form('https://oauth2.googleapis.com/token', {
    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: dec(cfg.rt), grant_type: 'refresh_token'
  });
  if (!r.ok) {
    var e = new Error(r.j.error || 'refresh failed'); e.reauth = r.j.error === 'invalid_grant'; throw e;
  }
  atCache[token] = { at: r.j.access_token, exp: Date.now() + (r.j.expires_in || 3600) * 1000 };
  return r.j.access_token;
}
async function listCals(at) {
  var r = await gget('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=items(id,summary,summaryOverride,primary,backgroundColor,accessRole,selected)', at);
  if (!r.ok) throw new Error('calendar list failed (' + r.status + ')');
  return (r.j.items || []).map(function (c) {
    return { id: c.id, name: String(c.summaryOverride || c.summary || c.id).slice(0, 80), color: c.backgroundColor || '', primary: !!c.primary, w: c.accessRole === 'owner' || c.accessRole === 'writer' };
  }).sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name); });
}

/* ---------- day helpers (UK time) ---------- */
function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function londonMidnight(iso) {
  var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var base = Date.parse(iso + 'T00:00:00Z'), offs = [1, 0], i, ms, p, m;
  for (i = 0; i < offs.length; i++) {
    ms = base - offs[i] * 3600000; m = {};
    fmt.formatToParts(new Date(ms)).forEach(function (x) { m[x.type] = x.value; });
    if (m.year + '-' + m.month + '-' + m.day === iso && m.hour === '00' && m.minute === '00') return ms;
  }
  return base;
}

var evCache = {};
async function events(token, cfg) {
  var c = evCache[token];
  if (c && Date.now() - c.at < 90000 && c.sig === (cfg.sel || []).join(',')) return c.v;
  var sel = (cfg.sel || []).slice(0, 12), names = {}, i;
  (cfg.cals || []).forEach(function (k) { names[k.id] = k.name; });
  if (!sel.length) return { events: [], now: Date.now() };
  var at = await accessToken(token, cfg);
  var today = todos.todayISO(), tomorrow = addDays(today, 1);
  var tMin = new Date(londonMidnight(today)).toISOString(), tMax = new Date(londonMidnight(addDays(today, 2))).toISOString();
  var results = await Promise.all(sel.map(function (id) {
    return gget('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(id) + '/events?singleEvents=true&orderBy=startTime&maxResults=40&timeZone=' + encodeURIComponent(TZ) +
      '&timeMin=' + encodeURIComponent(tMin) + '&timeMax=' + encodeURIComponent(tMax) +
      '&fields=items(id,summary,location,status,eventType,start,end,attendees(self,responseStatus))', at).then(function (r) { return { id: id, r: r }; }, function () { return { id: id, r: { ok: false, status: 0, j: {} } }; });
  }));
  var out = [], failed = 0, authFail = false;
  results.forEach(function (x) {
    if (!x.r.ok) { failed++; if (x.r.status === 401 || x.r.status === 403) authFail = true; return; }
    (x.r.j.items || []).forEach(function (e) {
      if (e.status === 'cancelled' || e.eventType === 'workingLocation' || e.eventType === 'birthday') return;
      var me = (e.attendees || []).filter(function (a) { return a.self; })[0];
      if (me && me.responseStatus === 'declined') return;
      var allDay = !!(e.start && e.start.date && !e.start.dateTime), sD, eD, s, en, sm, em, day;
      if (allDay) {
        sD = e.start.date; eD = e.end && e.end.date ? e.end.date : addDays(sD, 1);
        if (eD <= today) return;
        day = sD <= today ? 'today' : (sD === tomorrow ? 'tomorrow' : null);
        if (!day) return;
        sm = londonMidnight(sD); em = londonMidnight(eD); s = ''; en = '';
      } else {
        if (!e.start || !e.start.dateTime) return;
        sm = Date.parse(e.start.dateTime); em = e.end && e.end.dateTime ? Date.parse(e.end.dateTime) : sm;
        sD = e.start.dateTime.slice(0, 10);
        day = sD <= today ? 'today' : (sD === tomorrow ? 'tomorrow' : null);
        if (!day) return;
        s = e.start.dateTime.slice(11, 16); en = e.end && e.end.dateTime ? e.end.dateTime.slice(11, 16) : '';
      }
      out.push({
        id: x.id + ':' + e.id, title: String(e.summary || '(No title)').slice(0, 140), loc: String(e.location || '').split('\n')[0].slice(0, 90),
        cal: names[x.id] || '', day: day, allDay: allDay, s: s, e: en, sm: sm, em: em
      });
    });
  });
  out.sort(function (a, b) {
    if (a.day !== b.day) return a.day === 'today' ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.sm - b.sm || a.em - b.em;
  });
  var v = { events: out.slice(0, 30), now: Date.now() };
  if (failed === results.length && failed) { var er = new Error('events failed'); er.reauth = authFail; throw er; }
  evCache[token] = { at: Date.now(), sig: (cfg.sel || []).join(','), v: v };
  return v;
}

/* ---------- adding timed Work tasks to a calendar ---------- */
function eventId(taskId) { return 'td' + String(taskId).replace(/-/g, '').toLowerCase(); }
function wallPlus(date, time, mins) {
  var d = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5)) + mins * 60000;
  return new Date(d).toISOString().slice(0, 19);
}
function cleanSched(b) {
  var dur = parseInt(b.dur, 10);
  return { on: b.on === true, dur: dur >= 5 && dur <= 480 ? dur : 30, vis: b.vis === 'public' ? 'public' : 'private', u: Date.now() };
}
function evUrl(cal, eid) { return 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal) + '/events' + (eid ? '/' + encodeURIComponent(eid) : ''); }
function gerr(r) {
  var e = new Error('google ' + r.status + (r.j && r.j.error && r.j.error.message ? ': ' + r.j.error.message : ''));
  e.status = r.status; return e;
}
// Bring the task's event in line with the task (create, move, rename, or remove). Returns true when something was checked.
async function syncTask(token, id, gone) {
  var cfg = await readCfg(token);
  if (!cfg || !cfg.rt || !cfg.canWrite || !cfg.wcal || !cfg.map || !cfg.map[id] || !configured()) return false;
  var m = cfg.map[id], at = await accessToken(token, cfg), eid = eventId(id), t = null, i;
  if (!gone && m.on) {
    var all = await todos.rpc('todo_list', { p_token: token });
    for (i = 0; i < all.length; i++) if (all[i].id === id) t = all[i];
  }
  var want = !gone && m.on && t && !t.done && t.list === 'work' && t.due_date && t.remind_time;
  if (!want) {
    var d = await greq('DELETE', evUrl(cfg.wcal, eid), at);
    if (!d.ok && d.status !== 404 && d.status !== 410) throw gerr(d);
    if (gone) { delete cfg.map[id]; await writeCfg(token, cfg); }
    return true;
  }
  var time = String(t.remind_time).slice(0, 5), pub = m.vis === 'public';
  var body = {
    summary: pub ? String(t.title).slice(0, 200) : 'Busy', visibility: pub ? 'public' : 'private', transparency: 'opaque', status: 'confirmed',
    start: { dateTime: t.due_date + 'T' + time + ':00', timeZone: TZ },
    end: { dateTime: wallPlus(t.due_date, time, m.dur || 30), timeZone: TZ },
    extendedProperties: { private: { todoId: id } }
  };
  var ins = body; ins.id = eid;
  var r = await greq('POST', evUrl(cfg.wcal) + '?sendUpdates=none', at, ins);
  if (r.status === 409) { // already there (or deleted earlier): update it in place and bring it back
    delete body.id;
    r = await greq('PATCH', evUrl(cfg.wcal, eid) + '?sendUpdates=none', at, body);
  }
  if (!r.ok) throw gerr(r);
  return true;
}

/* ---------- OAuth ---------- */
async function start(req, res, q) {
  if (!configured()) return page(res, 503, 'Google not set up yet', 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing on the server.');
  var token = q.t;
  if (!token) return page(res, 401, 'Not signed in', 'Open the To-Do app first, then try again from Settings.');
  try { await todos.rpc('cfg_get', { p_token: token, p_key: 'gcal' }); } catch (e) { return page(res, 401, 'Not signed in', 'That token was not accepted.'); }
  var url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent select_account', state: makeState(token)
  }).toString();
  res.statusCode = 302; res.setHeader('Location', url); res.setHeader('Cache-Control', 'no-store'); res.end();
}
async function callback(req, res, q) {
  var st = readState(q.state);
  if (!st) return page(res, 400, 'Link expired', 'That sign-in took too long or was not started from the app. Start again from Settings → Screensaver.');
  if (q.error) return page(res, 200, 'Sign-in cancelled', 'Nothing was connected.');
  try {
    var r = await form('https://oauth2.googleapis.com/token', {
      code: q.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code'
    });
    if (!r.ok || !r.j.access_token) return page(res, 502, 'Google said no', 'Google rejected the sign-in (' + (r.j.error || r.status) + '). Check the redirect address in your Google Cloud client.');
    if (!r.j.refresh_token) return page(res, 502, 'No long-term access', 'Google did not give long-term access. Remove "To-Do" from myaccount.google.com/permissions and try again.');
    var me = await gget('https://www.googleapis.com/oauth2/v3/userinfo', r.j.access_token);
    var cals = await listCals(r.j.access_token), old = await readCfg(st.t), keep = [];
    if (old && old.sel) keep = old.sel.filter(function (id) { return cals.some(function (c) { return c.id === id; }); });
    var can = /calendar\.events|auth\/calendar(\s|$)/.test(String(r.j.scope || ''));
    var keepW = old && old.wcal && can && cals.some(function (c) { return c.id === old.wcal && c.w; }) ? old.wcal : '';
    await writeCfg(st.t, { email: (me.j && me.j.email) || '', rt: enc(r.j.refresh_token), cals: cals, sel: keep, at: Date.now(), canWrite: can, wcal: keepW, map: (old && old.map) || {} });
    atCache[st.t] = { at: r.j.access_token, exp: Date.now() + (r.j.expires_in || 3600) * 1000 };
    delete evCache[st.t];
    res.statusCode = 302; res.setHeader('Location', '/#gcal'); res.setHeader('Cache-Control', 'no-store'); res.end();
  } catch (e) {
    if (e.code === '28000') return page(res, 401, 'Not signed in', 'That token was not accepted.');
    console.error('gcal callback error', e.code, e.message);
    page(res, 502, 'Something went wrong', 'Could not finish connecting. Try again from Settings.');
  }
}

module.exports = async function handler(req, res) {
  var q = req.query || {};
  if (req.method === 'GET' && (q.code || q.error)) return callback(req, res, q);
  if (req.method === 'GET' && q.action === 'start') return start(req, res, q);
  var token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    var cfg = await readCfg(token);
    if (req.method === 'GET') {
      if (q.events) {
        if (!cfg || !cfg.rt || !configured()) return send(res, 200, { events: [], now: Date.now() });
        try { return send(res, 200, await events(token, cfg)); }
        catch (e) {
          if (e.reauth) { cfg.expired = true; await writeCfg(token, cfg); return send(res, 200, { events: [], now: Date.now(), expired: true }); }
          console.error('gcal events error', e.message);
          return send(res, 200, { events: [], now: Date.now(), error: true });
        }
      }
      if (q.sched) {
        var wn = '';
        if (cfg && cfg.wcal) (cfg.cals || []).forEach(function (c) { if (c.id === cfg.wcal) wn = c.name; });
        return send(res, 200, { map: (cfg && cfg.map) || {}, can_write: !!(cfg && cfg.canWrite && cfg.wcal), cal: wn, write_error: !!(cfg && cfg.canWrite && !cfg.wcal) });
      }
      return send(res, 200, view(cfg));
    }
    if (req.method === 'POST') {
      if (!cfg || !cfg.rt) return send(res, 409, { error: 'not connected' });
      var b = readBody(req);
      if (b.sched) {
        var sid = b.sched && typeof b.sched.id === 'string' ? b.sched.id : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) return send(res, 400, { error: 'bad task id' });
        if (!cfg.canWrite || !cfg.wcal) return send(res, 409, { error: 'Choose a calendar to add tasks to in Settings first' });
        cfg.map = cfg.map || {};
        cfg.map[sid] = cleanSched(b.sched);
        var keys = Object.keys(cfg.map);
        if (keys.length > 300) { keys.sort(function (x, y) { return (cfg.map[x].u || 0) - (cfg.map[y].u || 0); }); for (var ki = 0; ki < keys.length - 300; ki++) delete cfg.map[keys[ki]]; }
        await writeCfg(token, cfg);
        if (b.sync) {
          try { await syncTask(token, sid, false); }
          catch (e) {
            if (e.reauth) { cfg.expired = true; await writeCfg(token, cfg); return send(res, 200, { ok: false, error: 'Google needs you to sign in again (Settings, Screensaver)' }); }
            console.error('gcal sched sync', e.message);
            return send(res, 200, { ok: false, error: e.status === 403 || e.status === 404 ? 'Google would not let this account add to that calendar' : 'Could not reach Google, try again' });
          }
        }
        return send(res, 200, { ok: true });
      }
      if (typeof b.wcal === 'string') {
        if (!cfg.canWrite) return send(res, 409, { error: 'Allow editing first' });
        if (b.wcal && !cfg.cals.some(function (c) { return c.id === b.wcal && c.w; })) return send(res, 400, { error: 'You cannot edit that calendar' });
        cfg.wcal = b.wcal; await writeCfg(token, cfg);
        return send(res, 200, view(cfg));
      }
      if (b.refresh) {
        try { cfg.cals = await listCals(await accessToken(token, cfg)); cfg.expired = false; }
        catch (e) { if (e.reauth) { cfg.expired = true; await writeCfg(token, cfg); return send(res, 200, view(cfg)); } return send(res, 502, { error: 'Could not reach Google' }); }
        cfg.sel = (cfg.sel || []).filter(function (id) { return cfg.cals.some(function (c) { return c.id === id; }); });
      } else if (Array.isArray(b.selected)) {
        cfg.sel = b.selected.filter(function (id) { return cfg.cals.some(function (c) { return c.id === id; }); }).slice(0, 12);
      } else return send(res, 400, { error: 'nothing to change' });
      await writeCfg(token, cfg); delete evCache[token];
      return send(res, 200, view(cfg));
    }
    if (req.method === 'DELETE') {
      if (cfg && cfg.rt && configured()) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(dec(cfg.rt)), { method: 'POST', signal: AbortSignal.timeout(6000) }); } catch (e) {} }
      await writeCfg(token, null); delete atCache[token]; delete evCache[token];
      return send(res, 200, view(null));
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === '23514') return send(res, 409, { error: 'run the gcal migration first' });
    console.error('gcal api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};

module.exports.syncTask = syncTask;
