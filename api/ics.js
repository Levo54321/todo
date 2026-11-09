// /api/ics — calendar reminders for tasks that have a time.
//   GET /api/ics?id=<uuid>&t=<token>   -> one event (.ics) with an alert; opens "Add to Calendar" on iPhone
//   GET /api/ics?feed=1&t=<token>      -> subscribable feed of all open timed tasks (webcal://)
//   GET /api/ics?bills=1&t=<token>     -> subscribable feed of bill reminders (bills with a reminder set in Budget)
// Auth: ?t=<token> (calendar apps cannot send headers) or x-todo-token.
var todos = require('./todos.js');
var TZ = 'Europe/London';
var crypto = require('crypto');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pad(n) { return (n < 10 ? '0' : '') + n; }

// London wall-clock (date + "HH:MM") -> UTC Date
function londonToUTC(date, time) {
  var d = date.split('-'), t = time.split(':');
  var guess = Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1], 0);
  var off = tzOffsetMs(guess);
  var utc = guess - off;
  var off2 = tzOffsetMs(utc);
  return new Date(guess - off2);
}
function tzOffsetMs(ms) {
  var p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  var o = {};
  for (var i = 0; i < p.length; i++) o[p[i].type] = +p[i].value;
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(ms / 1000) * 1000;
}
function stamp(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line) {
  var out = [], b = Buffer.from(line, 'utf8');
  if (b.length <= 74) return line;
  var cur = '', curLen = 0;
  for (var ch of line) {
    var l = Buffer.byteLength(ch, 'utf8');
    if (curLen + l > (out.length ? 73 : 74)) { out.push(cur); cur = ''; curLen = 0; }
    cur += ch; curLen += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

var RRULES = {
  daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY',
  fortnightly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY'
};
// Local (London wall-clock) stamp for TZID events: date "YYYY-MM-DD" + "HH:MM" + minutes -> "YYYYMMDDTHHMM00"
function localStamp(date, time, addMin) {
  var d = date.split('-'), t = time.split(':');
  var x = new Date(Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1] + (addMin || 0), 0));
  return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()) + 'T' + pad(x.getUTCHours()) + pad(x.getUTCMinutes()) + '00';
}
function nextWeekday(date) { // Sat/Sun -> following Monday
  var g = new Date(date + 'T00:00:00Z').getUTCDay();
  if (g === 6) g = 2; else if (g === 0) g = 1; else g = 0;
  var x = new Date(date + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + g);
  return x.toISOString().slice(0, 10);
}
var VTZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/London',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];

// Everything useful about a task as plain text for a calendar event description (Apple and Google Work).
function detailText(t) {
  var L = [], items = Array.isArray(t.items) ? t.items : [], meta = [], i, it;
  if (t.notes && String(t.notes).trim()) L.push(String(t.notes).trim());
  if (items.length) {
    if (L.length) L.push('');
    L.push('Sub-tasks:');
    for (i = 0; i < items.length; i++) { it = items[i] || {}; if (it.t) L.push((it.d ? '\u2611 ' : '\u2610 ') + it.t); }
  }
  if (t.category) meta.push('Project: ' + t.category);
  if (t.prio) meta.push('Priority: ' + new Array(+t.prio + 1).join('!'));
  if (t.quick) meta.push('Quick win');
  if (t.must) meta.push('Must do today');
  if (t.recur) meta.push('Repeats ' + t.recur);
  if (meta.length) { if (L.length) L.push(''); L.push(meta.join(' \u00b7 ')); }
  if (L.length) L.push('');
  L.push('From your to-do list');
  return L.join('\n').slice(0, 6000);
}

function eventLines(t, today, nowStamp) {
  var date = t.due_date || today, time = String(t.remind_time).slice(0, 5);
  var rrule = t.recur && RRULES[t.recur] ? RRULES[t.recur] : null;
  var L = ['BEGIN:VEVENT'];
  if (rrule) {
    // One repeating event for the whole series. Local London time so it stays put across BST/GMT changes.
    // The UID depends on what repeats, not on the task row, so each new occurrence updates the same series.
    if (t.recur === 'weekdays') date = nextWeekday(date);
    var uid = crypto.createHash('sha1').update(String(t.title).toLowerCase() + '|' + t.recur + '|' + time).digest('hex').slice(0, 24);
    L.push('UID:r-' + uid + '@luc-todo', 'DTSTAMP:' + nowStamp,
      'DTSTART;TZID=' + TZ + ':' + localStamp(date, time, 0),
      'DTEND;TZID=' + TZ + ':' + localStamp(date, time, 30),
      'RRULE:' + rrule + (t.recur_until ? ';UNTIL=' + stamp(londonToUTC(t.recur_until, '23:59')) : ''));
  } else {
    var start = londonToUTC(date, time);
    var end = new Date(start.getTime() + 30 * 60000);
    L.push('UID:' + t.id + '@luc-todo', 'DTSTAMP:' + nowStamp, 'DTSTART:' + stamp(start), 'DTEND:' + stamp(end));
  }
  L.push('SUMMARY:' + esc('☐ ' + t.title));
  if (t.category) L.push('CATEGORIES:' + esc(t.category));
  L.push('DESCRIPTION:' + esc(detailText(t)));
  L.push('TRANSP:TRANSPARENT');
  L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(t.title), 'TRIGGER:PT0M', 'END:VALARM');
  L.push('END:VEVENT');
  return L;
}

// One event per bill per month (9am London), with an alert N days earlier. Stateless: rebuilt from the budget config each fetch.
function money2(n) { var s = (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, ''); return '\u00a3' + s; }
function billEvents(bills, today, nowStamp) {
  var out = [], p = today.split('-'), y0 = +p[0], m0 = +p[1], i, k;
  for (i = 0; i < bills.length; i++) {
    var b = bills[i], r = (b.r === 0 || b.r > 0) ? Math.min(30, Math.floor(+b.r)) : -1;
    if (r < 0 || !b || !b.n) continue;
    var day = Math.min(31, Math.max(1, parseInt(b.d, 10) || 1)), key = crypto.createHash('sha1').update(String(b.n).toLowerCase()).digest('hex').slice(0, 16);
    for (k = 0; k < 14; k++) {
      var mm = m0 + k, yy = y0;
      while (mm > 12) { mm -= 12; yy++; }
      var dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate(), date = yy + '-' + pad(mm) + '-' + pad(Math.min(day, dim));
      if (date < today) continue;
      var title = String(b.n) + ' ' + money2(+b.a || 0) + ' comes out' + (b.c ? ' (marked to cancel)' : '');
      var desc = (r === 0 ? 'Leaves your account today.' : 'Leaves your account in ' + r + (r === 1 ? ' day.' : ' days.')) + (b.x ? ' Note: ' + b.x : '');
      out.push('BEGIN:VEVENT', 'UID:bill-' + key + '-' + date.replace(/-/g, '') + '@luc-bills', 'DTSTAMP:' + nowStamp,
        'DTSTART;TZID=' + TZ + ':' + localStamp(date, '09:00', 0), 'DTEND;TZID=' + TZ + ':' + localStamp(date, '09:00', 15),
        'SUMMARY:' + esc('\ud83d\udcb3 ' + title), 'DESCRIPTION:' + esc(desc), 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'TRIGGER:' + (r === 0 ? 'PT0M' : '-P' + r + 'D'), 'END:VALARM', 'END:VEVENT');
    }
  }
  return out;
}

function cal(name, events) {
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//luc-todo//reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(name), 'X-WR-TIMEZONE:' + TZ, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
  return L.concat(VTZ).concat(events).concat(['END:VCALENDAR']).map(fold).join('\r\n') + '\r\n';
}

module.exports = async function handler(req, res) {
  var q = req.query || {};
  var token = req.headers['x-todo-token'] || q.t;
  if (!token) { res.statusCode = 401; return res.end('missing token'); }
  try {
    var list = await todos.rpc('todo_list', { p_token: token });
    var today = todos.todayISO(), nowStamp = stamp(new Date()), evs = [], name = 'To-do reminders', fn = 'reminders.ics', seen = {};
    if (q.id) {
      if (!UUID.test(q.id)) { res.statusCode = 400; return res.end('bad id'); }
      var t = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === q.id) t = list[i];
      if (!t || !t.remind_time) { res.statusCode = 404; return res.end('no reminder time on that task'); }
      evs = eventLines(t, today, nowStamp);
      name = t.title; fn = 'reminder.ics';
    } else if (q.feed) {
      for (var j = 0; j < list.length; j++) {
        var x = list[j];
        if (x.done || !x.remind_time) continue;
        if (x.due_date && x.due_date < today && !x.recur) continue; // old overdue one-off tasks stop alerting; repeating series keep going
        var ls = eventLines(x, today, nowStamp);
        if (seen[ls[1]]) continue; // two identical repeating tasks -> one series
        seen[ls[1]] = 1;
        evs = evs.concat(ls);
      }
    } else if (q.bills) {
      var raw = await todos.rpc('cfg_get', { p_token: token, p_key: 'budget' }), bc = null;
      try { bc = raw ? JSON.parse(raw) : null; } catch (e2) { bc = null; }
      evs = billEvents((bc && bc.bills) || [], today, nowStamp);
      name = 'Bills'; fn = 'bills.ics';
    } else { res.statusCode = 400; return res.end('use ?id=, ?feed=1 or ?bills=1'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="' + fn + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(cal(name, evs));
  } catch (e) {
    if (e.code === '28000') { res.statusCode = 401; return res.end('bad token'); }
    console.error('ics error', e.code, e.message);
    res.statusCode = 502; res.end('upstream error');
  }
};
module.exports.londonToUTC = londonToUTC;
module.exports.eventLines = eventLines;
module.exports.detailText = detailText;
module.exports.cal = cal;
module.exports.billEvents = billEvents;
module.exports.RRULES = RRULES;
