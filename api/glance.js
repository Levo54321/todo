// /api/glance — "today at a glance": weather (Open-Meteo, no key) + today's calendar events
// from a private iCal feed. Token-gated like /api/todos (checked by making a cheap list call).
// Env (all optional): GLANCE_LAT, GLANCE_LON, GLANCE_PLACE (default London), CAL_ICS_URL (secret iCal address).

var TZ = 'Europe/London';
var fmtCache = {};

function fmt(tz) {
  if (!fmtCache[tz]) {
    fmtCache[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    });
  }
  return fmtCache[tz];
}
function parts(ms, tz) {
  var o = {}, ps = fmt(tz).formatToParts(new Date(ms));
  for (var i = 0; i < ps.length; i++) if (ps[i].type !== 'literal') o[ps[i].type] = parseInt(ps[i].value, 10);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute };
}
function safeTz(tz) {
  try { fmt(tz); return tz; } catch (e) { return TZ; }
}
function wallToMs(tz, y, m, d, h, mi) {
  var guess = Date.UTC(y, m - 1, d, h, mi);
  function off(ms) { var p = parts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000; }
  var o1 = off(guess), ms = guess - o1, o2 = off(ms);
  if (o2 !== o1) ms = guess - o2;
  return ms;
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
function dayNum(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
function fromDayNum(n) { var dt = new Date(n * 86400000); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }; }
function isoDow(y, m, d) { var g = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return g === 0 ? 7 : g; }

/* ---------- iCal parsing ---------- */
function unescapeText(s) { return String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }

function parseDT(name, params, value) {
  var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value || '');
  if (!m) return null;
  var tzm = /TZID=([^;:]+)/i.exec(params || '');
  return {
    y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0,
    allDay: !m[4], utc: !!m[7], tz: tzm ? safeTz(tzm[1].replace(/"/g, '')) : TZ
  };
}
function dtToMs(dt) {
  if (dt.utc) return Date.UTC(dt.y, dt.m - 1, dt.d, dt.h, dt.mi);
  return wallToMs(dt.tz, dt.y, dt.m, dt.d, dt.h, dt.mi);
}
// Normalise UTC-stamped starts into London wall time so recurrence runs on wall clock.
function toWall(dt) {
  if (!dt.utc) return dt;
  var p = parts(Date.UTC(dt.y, dt.m - 1, dt.d, dt.h, dt.mi), TZ);
  return { y: p.y, m: p.m, d: p.d, h: p.h, mi: p.mi, allDay: false, utc: false, tz: TZ };
}

function parseICS(text) {
  var lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  var events = [], cur = null;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (ln === 'BEGIN:VEVENT') { cur = { exdates: {} }; continue; }
    if (ln === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    var ci = ln.indexOf(':'); if (ci < 0) continue;
    var left = ln.slice(0, ci), value = ln.slice(ci + 1);
    var si = left.indexOf(';');
    var name = (si < 0 ? left : left.slice(0, si)).toUpperCase(), params = si < 0 ? '' : left.slice(si + 1);
    if (name === 'DTSTART') cur.start = parseDT(name, params, value);
    else if (name === 'DTEND') cur.end = parseDT(name, params, value);
    else if (name === 'DURATION') cur.duration = value;
    else if (name === 'SUMMARY') cur.title = unescapeText(value);
    else if (name === 'UID') cur.uid = value;
    else if (name === 'STATUS') cur.status = value.toUpperCase();
    else if (name === 'RRULE') cur.rrule = value;
    else if (name === 'RECURRENCE-ID') cur.recId = parseDT(name, params, value);
    else if (name === 'EXDATE') {
      var vs = value.split(',');
      for (var k = 0; k < vs.length; k++) { var ed = parseDT(name, params, vs[k]); if (ed) cur.exdates[ymd(ed.y, ed.m, ed.d)] = 1; }
    }
  }
  return events;
}

function parseRule(r) {
  var o = { freq: null, interval: 1, count: 0, until: null, byday: [], bymonthday: [] }, ps = r.split(';');
  for (var i = 0; i < ps.length; i++) {
    var kv = ps[i].split('='), k = kv[0].toUpperCase(), v = kv[1] || '';
    if (k === 'FREQ') o.freq = v.toUpperCase();
    else if (k === 'INTERVAL') o.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'COUNT') o.count = parseInt(v, 10) || 0;
    else if (k === 'UNTIL') { var u = parseDT('UNTIL', '', v); if (u) o.until = dayNum(u.y, u.m, u.d); }
    else if (k === 'BYDAY') o.byday = v.split(',');
    else if (k === 'BYMONTHDAY') o.bymonthday = v.split(',').map(function (x) { return parseInt(x, 10); });
  }
  return o;
}
var WD = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

// Does the rule produce an occurrence on wall-date (y,m,d) given start s?
function ruleMatches(rule, s, y, m, d) {
  var dn = dayNum(y, m, d), sn = dayNum(s.y, s.m, s.d);
  if (dn < sn) return false;
  if (rule.until !== null && dn > rule.until) return false;
  var dw = isoDow(y, m, d), n, i, bd;
  if (rule.freq === 'DAILY') return (dn - sn) % rule.interval === 0;
  if (rule.freq === 'WEEKLY') {
    var days = [];
    for (i = 0; i < rule.byday.length; i++) { bd = WD[rule.byday[i].slice(-2)]; if (bd) days.push(bd); }
    if (!days.length) days = [isoDow(s.y, s.m, s.d)];
    if (days.indexOf(dw) < 0) return false;
    var w0 = Math.floor((sn - (isoDow(s.y, s.m, s.d) - 1)) / 7), w1 = Math.floor((dn - (dw - 1)) / 7);
    return (w1 - w0) % rule.interval === 0;
  }
  if (rule.freq === 'MONTHLY') {
    if (((y - s.y) * 12 + (m - s.m)) % rule.interval !== 0) return false;
    if (rule.byday.length) {
      for (i = 0; i < rule.byday.length; i++) {
        var mm = /^(-?\d+)?([A-Z]{2})$/.exec(rule.byday[i]); if (!mm || WD[mm[2]] !== dw) continue;
        if (!mm[1]) return true;
        n = parseInt(mm[1], 10);
        var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        if (n > 0 && Math.ceil(d / 7) === n) return true;
        if (n < 0 && Math.ceil((dim - d + 1) / 7) === -n) return true;
      }
      return false;
    }
    if (rule.bymonthday.length) return rule.bymonthday.indexOf(d) >= 0;
    return d === s.d;
  }
  if (rule.freq === 'YEARLY') return ((y - s.y) % rule.interval === 0) && m === s.m && d === s.d;
  return false;
}
function countOK(rule, s, y, m, d) {
  if (!rule.count) return true;
  var sn = dayNum(s.y, s.m, s.d), dn = dayNum(y, m, d), c = 0;
  if (dn - sn > 4000) return false;
  for (var n = sn; n <= dn; n++) {
    var p = fromDayNum(n);
    if (ruleMatches(rule, s, p.y, p.m, p.d)) { c++; if (c > rule.count) return false; }
  }
  return c <= rule.count;
}

// Events happening on London date `todayIso` (YYYY-MM-DD).
function eventsOn(events, todayIso) {
  var t = todayIso.split('-'), ty = +t[0], tm = +t[1], td = +t[2], tn = dayNum(ty, tm, td);
  var out = [], overridden = {}, i;
  for (i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.recId && ev.uid) overridden[ev.uid + '|' + ymd(ev.recId.y, ev.recId.m, ev.recId.d)] = 1;
  }
  for (i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.status === 'CANCELLED' || !e.title) continue;
    var s = e.start.allDay ? e.start : toWall(e.start);
    var durMs = 0, endDays = 1;
    if (s.allDay) {
      endDays = e.end ? Math.max(1, dayNum(e.end.y, e.end.m, e.end.d) - dayNum(s.y, s.m, s.d)) : 1;
    } else if (e.end && !e.end.allDay) durMs = Math.max(0, dtToMs(e.end) - dtToMs(e.start));
    else if (e.duration) {
      var dm = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(e.duration);
      if (dm) durMs = ((+dm[1] || 0) * 86400 + (+dm[2] || 0) * 3600 + (+dm[3] || 0) * 60) * 1000;
    }
    var rule = e.rrule && !e.recId ? parseRule(e.rrule) : null;
    // candidate wall dates: yesterday..tomorrow (+ multi-day lookback for all-day)
    for (var off = -1 - (s.allDay ? endDays : 0); off <= 1; off++) {
      var c = fromDayNum(tn + off), key = ymd(c.y, c.m, c.d);
      var hit = rule ? (ruleMatches(rule, s, c.y, c.m, c.d) && countOK(rule, s, c.y, c.m, c.d))
                     : (c.y === s.y && c.m === s.m && c.d === s.d);
      if (!hit || e.exdates[key]) continue;
      if (rule && e.uid && overridden[e.uid + '|' + key]) continue;
      if (s.allDay) {
        var cn = dayNum(c.y, c.m, c.d);
        if (tn >= cn && tn < cn + endDays) out.push({ title: e.title, allDay: true, s: null, e: null, sort: -1 });
      } else {
        var startMs = wallToMs(s.tz, c.y, c.m, c.d, s.h, s.mi), endMs = startMs + durMs;
        var sp = parts(startMs, TZ), ep = parts(endMs, TZ);
        var sn2 = dayNum(sp.y, sp.m, sp.d), en2 = dayNum(ep.y, ep.m, ep.d);
        if (tn >= sn2 && (tn <= en2 && (durMs > 0 || tn === sn2))) {
          if (durMs > 0 && tn === en2 && tn > sn2 && ep.h === 0 && ep.mi === 0) continue; // ended at midnight
          out.push({
            title: e.title, allDay: false,
            s: tn === sn2 ? pad(sp.h) + ':' + pad(sp.mi) : '00:00',
            e: durMs ? (tn === en2 ? pad(ep.h) + ':' + pad(ep.mi) : '23:59') : null,
            sort: tn === sn2 ? sp.h * 60 + sp.mi : 0
          });
        }
      }
    }
  }
  out.sort(function (a, b) { return a.sort - b.sort || (a.title < b.title ? -1 : 1); });
  var seen = {}, res = [];
  for (i = 0; i < out.length; i++) {
    var k2 = out[i].title + '|' + out[i].s;
    if (!seen[k2]) { seen[k2] = 1; res.push({ title: out[i].title, allDay: out[i].allDay, s: out[i].s, e: out[i].e }); }
  }
  return res;
}

/* ---------- weather ---------- */
var WMO = [
  [[0], 'Clear', '☀️'], [[1], 'Mostly clear', '🌤'], [[2], 'Part cloud', '⛅'], [[3], 'Cloudy', '☁️'],
  [[45, 48], 'Fog', '🌫'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦'], [[61, 63, 65, 66, 67], 'Rain', '🌧'],
  [[71, 73, 75, 77], 'Snow', '❄️'], [[80, 81, 82], 'Showers', '🌦'], [[85, 86], 'Snow showers', '❄️'], [[95, 96, 99], 'Thunder', '⛈']
];
function describe(code) {
  for (var i = 0; i < WMO.length; i++) if (WMO[i][0].indexOf(code) >= 0) return { text: WMO[i][1], icon: WMO[i][2] };
  return { text: '', icon: '' };
}

var wCache = { at: 0, v: null }, cCache = { at: 0, v: null };

async function getWeather(cfg) {
  var lat = String(cfg.lat || process.env.GLANCE_LAT || '51.5072'), lon = String(cfg.lon || process.env.GLANCE_LON || '-0.1276');
  var units = cfg.units === 'f' ? 'f' : 'c', key = lat + ',' + lon + ',' + units;
  if (wCache.v && wCache.key === key && Date.now() - wCache.at < 10 * 60000) return wCache.v;
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=' +
    encodeURIComponent(TZ) + '&forecast_days=1' + (units === 'f' ? '&temperature_unit=fahrenheit' : '');
  var r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('weather ' + r.status);
  var j = await r.json();
  var d = describe(j.current.weather_code);
  var v = {
    temp: Math.round(j.current.temperature_2m), hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]),
    rain: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[0] : null,
    text: d.text, icon: d.icon, place: cfg.place || process.env.GLANCE_PLACE || '', unit: units === 'f' ? 'F' : 'C'
  };
  wCache = { at: Date.now(), v: v, key: key };
  return v;
}

async function getCalendar(cfg, todayIso, token) {
  var apple = await require('./cal.js').eventsFor(token, todayIso); // Apple Calendar (CalDAV) when connected
  if (apple !== undefined) return apple;
  var url = cfg.cal_url || process.env.CAL_ICS_URL;
  if (!url) return null;
  var text;
  if (cCache.v && cCache.url === url && Date.now() - cCache.at < 5 * 60000) text = cCache.v;
  else {
    var r = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error('calendar ' + r.status);
    text = await r.text();
    cCache = { at: Date.now(), v: text, url: url };
  }
  return eventsOn(parseICS(text), todayIso);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  var token = req.headers['x-todo-token'] || (req.query || {}).t;
  if (!token) { res.statusCode = 401; return res.end('{"error":"missing token"}'); }
  var cfg;
  try {
    cfg = (await require('./todos.js').rpc('todo_settings_get', { p_token: token })) || {}; // also the auth check
  } catch (e) {
    res.statusCode = e.code === '28000' ? 401 : 502;
    return res.end(JSON.stringify({ error: res.statusCode === 401 ? 'bad token' : 'upstream error' }));
  }
  var today = require('./todos.js').todayISO();
  var apple = await require('./cal.js').enabled(token);
  var hasCal = apple || !!(cfg.cal_url || process.env.CAL_ICS_URL);
  if ((req.query || {}).day === 'tomorrow') { // Plan Tomorrow: just tomorrow's events
    var tm = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    var te = await getCalendar(cfg, tm, token).catch(function (e) { console.error('calendar', e.message); return undefined; });
    res.statusCode = 200;
    return res.end(JSON.stringify({ day: 'tomorrow', events: te === undefined ? null : te, calendar: hasCal }));
  }
  var out = await Promise.all([
    getWeather(cfg).catch(function (e) { console.error('weather', e.message); return null; }),
    getCalendar(cfg, today, token).catch(function (e) { console.error('calendar', e.message); return undefined; })
  ]);
  res.statusCode = 200;
  res.end(JSON.stringify({ weather: out[0], events: out[1] === undefined ? null : out[1], calendar: hasCal, calendarError: out[1] === undefined && hasCal }));
};

module.exports.parseICS = parseICS;
module.exports.eventsOn = eventsOn;
module.exports.parts = parts;
module.exports.dtToMs = dtToMs;
