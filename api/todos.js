// /api/todos — thin, token-gated API in front of Supabase.
// The iPad (iOS 9) and phone only ever talk to this endpoint, never to Supabase directly.
// GET    /api/todos                 -> { today, todos: [...] }
// POST   /api/todos                 -> body { text } (quick add, with shorthand) or { title, due_date, category }
// PATCH  /api/todos?id=<uuid>       -> body { done?, title?, due_date?, category?, recur?, recur_until?, low?, remind_time?, list?, focus?, reviewed?, is_session?, items?, notes?, prio?, quick?, must?, blocked?, unblock_action? }
// DELETE /api/todos?id=<uuid>
// Auth: header "x-todo-token: <token>" (or ?t=<token> as a fallback).

var SB_URL = process.env.SUPABASE_URL;
var SB_KEY = process.env.SUPABASE_KEY;
var TZ = 'Europe/London';

var DAYS = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7
};
var MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function toDate(iso) { return new Date(iso + 'T00:00:00Z'); }
function addDays(iso, n) {
  var d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(iso) { var g = toDate(iso).getUTCDay(); return g === 0 ? 7 : g; } // Mon=1 .. Sun=7
function pad(n) { return (n < 10 ? '0' : '') + n; }
function validYMD(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function fromDM(d, m, y, today) {
  var ty = parseInt(today.slice(0, 4), 10);
  var year = y ? (y < 100 ? 2000 + y : y) : ty;
  if (!validYMD(year, m, d)) return null;
  var iso = year + '-' + pad(m) + '-' + pad(d);
  if (!y && iso < today) {
    if (!validYMD(ty + 1, m, d)) return null;
    iso = (ty + 1) + '-' + pad(m) + '-' + pad(d);
  }
  return iso;
}

// Resolve a single date phrase ("fri", "tomorrow", "next week", "14/10", "14 oct", "in 3 days") or null.
function resolveDate(phrase, today) {
  var p = phrase.toLowerCase().replace(/[.,]+$/, '').trim();
  var m;
  if (p === 'today' || p === 'tonight') return today;
  if (p === 'tomorrow' || p === 'tmrw' || p === 'tmr') return addDays(today, 1);
  if (p === 'next week') return addDays(today, 8 - dow(today));
  if ((m = p.match(/^in (\d{1,2}) days?$/))) return addDays(today, parseInt(m[1], 10));
  if ((m = p.match(/^(next )?([a-z]+)$/)) && DAYS[m[2]]) {
    var diff = (DAYS[m[2]] - dow(today) + 7) % 7;
    if (diff === 0) diff = 7;
    if (m[1] && diff < 8 - dow(today)) diff += 7;
    return addDays(today, diff);
  }
  if ((m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return validYMD(+m[1], +m[2], +m[3]) ? p : null;
  }
  if ((m = p.match(/^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?$/))) {
    return fromDM(+m[1], +m[2], m[3] ? +m[3] : 0, today);
  }
  if ((m = p.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/)) && MONTHS[m[2]]) {
    return fromDM(+m[1], MONTHS[m[2]], 0, today);
  }
  return null;
}

// Trailing clock time: "3pm", "at 3:30pm", "at 15:30", "15:30". Returns "HH:MM" or null.
function parseTimeTail(text) {
  var m = text.match(/(^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)$/i), h, mi;
  if (m) {
    h = +m[2]; mi = m[3] ? +m[3] : 0;
    if (h < 1 || h > 12 || mi > 59) return null;
    if (/pm/i.test(m[4])) { if (h < 12) h += 12; } else if (h === 12) h = 0;
    return { time: pad(h) + ':' + pad(mi), index: m.index, len: m[0].length };
  }
  m = text.match(/(^|\s)(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m) return { time: pad(+m[2]) + ':' + m[3], index: m.index, len: m[0].length };
  return null;
}

var SESSION = /\bsession\b/i; // any title containing "session" becomes a checklist item


// Work-list ordering tags: "!" / "!!" / "!!!" (priority 1-3), "quick", "must" (or "must today"). Also "[quick]" / "[must]".
// Words are only taken from the END of the text, and at least one word of title is always kept, so "I must go" stays as typed.
function takeTags(text, st) {
  var m, guard = 0;
  while (guard++ < 12) {
    if ((m = text.match(/(^|\s)(!{1,3})(?=\s|$)/)) && text.length > m[0].length) {
      st.prio = Math.max(st.prio, m[2].length);
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else if ((m = text.match(/(\S)(!{2,3})$/))) {
      st.prio = Math.max(st.prio, m[2].length);
      text = text.slice(0, text.length - m[2].length).trim();
    } else if ((m = text.match(/(^|\s)\[(quick|must(?: today)?)\](?=\s|$)/i)) && text.length > m[0].length) {
      if (/^quick$/i.test(m[2])) st.quick = true; else st.must = true;
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else if ((m = text.match(/(^|\s)(must today|musttoday|quick|must)$/i)) && text.length > m[0].length) {
      if (/^quick$/i.test(m[2])) st.quick = true; else st.must = true;
      text = text.slice(0, m.index).trim();
    } else break;
  }
  return text;
}

// Quick-add shorthand: "#category" anywhere, "@date" anywhere, or a trailing date phrase.
// Examples: "call dentist fri", "pay council tax #money 14 oct", "buy milk @tomorrow".
function parseQuick(raw, today) {
  var text = String(raw || '').replace(/\s+/g, ' ').trim();
  var category = null, due = null, recur = null, remind = null, list = 'personal', m, tg = { prio: 0, quick: false, must: false };

  // Trailing "work" sends the task to the Work list and is removed from the title.
  if ((m = text.match(/(^|\s)work[.!]*$/i)) && text.length > m[0].length) {
    list = 'work';
    text = text.slice(0, m.index).trim();
  }
  text = takeTags(text, tg);
  if ((m = text.match(/(^|\s)#([A-Za-z][\w-]{0,39})(?=\s|$)/))) {
    category = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  }
  if ((m = text.match(/(^|\s)@([^\s]+(?: [^\s]+)?)(?=\s|$)/))) {
    // try two-word phrase first ("@next week"), then one word
    var two = resolveDate(m[2], today);
    var one = resolveDate(m[2].split(' ')[0], today);
    if (two) {
      due = two;
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else if (one) {
      due = one;
      var cut = m[0].length - (m[2].length - m[2].split(' ')[0].length);
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + cut)).replace(/\s+/g, ' ').trim();
    }
  }
  var tm = parseTimeTail(text);
  if (tm && text.length > tm.len) { remind = tm.time; text = text.slice(0, tm.index).trim(); }
  var RECUR = { daily: 'daily', 'every day': 'daily', weekdays: 'weekdays', 'every weekday': 'weekdays', weekly: 'weekly', 'every week': 'weekly',
    fortnightly: 'fortnightly', 'every fortnight': 'fortnightly', monthly: 'monthly', 'every month': 'monthly', yearly: 'yearly', 'every year': 'yearly' };
  var rm = text.match(/(^|\s)(daily|weekdays|weekly|fortnightly|monthly|yearly|every (?:day|weekday|week|fortnight|month|year))$/i);
  if (rm && text.length > rm[0].length) {
    recur = RECUR[rm[2].toLowerCase()];
    text = text.slice(0, rm.index).trim();
  }
  if (!due) {
    var tokens = text ? text.split(' ') : [];
    var sizes = [3, 2, 1];
    for (var i = 0; i < sizes.length && !due; i++) {
      var n = sizes[i];
      if (tokens.length > n) { // keep at least one word of title
        var d = resolveDate(tokens.slice(tokens.length - n).join(' '), today);
        if (d) { due = d; tokens = tokens.slice(0, tokens.length - n); }
      }
    }
    text = tokens.join(' ');
  }
  text = takeTags(text, tg);
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  var isSession = SESSION.test(text);
  if (isSession) { // "Home Clean Session" -> "Home Clean"
    var stripped = text.replace(/\bsession\b[:\-]?/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s:\-]+|[\s:\-]+$/g, '');
    if (stripped) text = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }
  if ((recur || isSession || remind || tg.must) && !due) due = today; // repeats and sessions start today unless told otherwise
  return { title: text, due_date: due, category: category, recur: recur, is_session: isSession, remind_time: remind, list: list, prio: tg.prio, quick: tg.quick, must: tg.must };
}

// On the Work list a #tag that matches one of your projects (any capitalisation) uses the project's exact name.
async function projectList(token) {
  try { var raw = await rpc('cfg_get', { p_token: token, p_key: 'projects' }), l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
async function canonProject(token, name) {
  var list = await projectList(token), i;
  for (i = 0; i < list.length; i++) if (String(list[i].name).toLowerCase() === String(name).toLowerCase()) return list[i].name;
  return name;
}

async function rpc(name, args) {
  var headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (SB_KEY && SB_KEY.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + SB_KEY;
  var r = await fetch(SB_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers, body: JSON.stringify(args) });
  var body = await r.text();
  var data = null;
  try { data = body ? JSON.parse(body) : null; } catch (e) { data = body; }
  if (!r.ok) {
    var err = new Error((data && data.message) || 'database error');
    err.code = data && data.code;
    err.status = r.status;
    throw err;
  }
  return data;
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
  var s = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
  try { var j = JSON.parse(s); return (j && typeof j === 'object') ? j : { text: String(j) }; }
  catch (e) { return { text: s }; } // plain-text body (handy for Shortcuts)
}

// After a change, bring Apple Calendar up to date (only when it is connected). Returns 'ok', 'error' or null (not connected).
async function calHook(token) {
  try {
    var r = await Promise.race([require('./cal.js').syncIfEnabled(token), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('calendar timed out')); }, 8500); })]);
    return r ? 'ok' : null;
  } catch (e) { console.error('cal sync', e.message); return 'error'; }
}

// After a change, keep the Google work-calendar event for a task in step (only when that task was set to go there).
async function gcalHook(token, id, gone) {
  try {
    await Promise.race([require('./gcal.js').syncTask(token, id, gone), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('google timed out')); }, 6000); })]);
    return null;
  } catch (e) { console.error('gcal sync', e.message); return 'error'; }
}

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO = /^\d{4}-\d{2}-\d{2}$/;
var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
var RECURS = ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'];

module.exports = async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return send(res, 500, { error: 'server not configured' });

  var query = req.query || {};
  var token = req.headers['x-todo-token'] || query.t;
  if (!token) return send(res, 401, { error: 'missing token' });

  try {
    var today = todayISO();

    if (req.method === 'GET') {
      var list = await rpc('todo_list', { p_token: token });
      return send(res, 200, { today: today, now: new Date().toISOString(), todos: list });
    }

    if (req.method === 'POST') {
      var b = readBody(req);
      if (Array.isArray(b.plan)) { // Daily Preview: save today's running order
        var ids = [];
        for (var pi = 0; pi < b.plan.length && pi < 200; pi++) if (typeof b.plan[pi] === 'string' && UUID.test(b.plan[pi])) ids.push(b.plan[pi]);
        var plist = b.list === 'work' ? 'work' : 'personal';
        var pdate = typeof b.date === 'string' && ISO.test(b.date) ? b.date : null; // Plan Tomorrow saves for a future date
        try {
          await rpc('todo_plan', pdate ? { p_token: token, p_ids: ids, p_list: plist, p_date: pdate } : { p_token: token, p_ids: ids, p_list: plist });
        } catch (pe) {
          if (pe.code !== 'PGRST202') throw pe; // database not updated yet (setup6.sql): fall back to the older functions
          if (pdate && pdate !== today) return send(res, 409, { error: 'run setup6.sql to plan other days' });
          try {
            await rpc('todo_plan', { p_token: token, p_ids: ids, p_list: plist });
          } catch (pe2) {
            if (pe2.code !== 'PGRST202') throw pe2;
            await rpc('todo_plan', { p_token: token, p_ids: ids });
          }
        }
        return send(res, 200, { ok: true });
      }
      var title, due = null, category = null, recur = null, isSession = false, remind = null, prio = 0, quick = false, must = false, listName = b.list === 'work' ? 'work' : 'personal';
      if (typeof b.text === 'string') {
        var q = parseQuick(b.text, today);
        title = q.title; due = q.due_date; category = q.category; recur = q.recur; isSession = q.is_session; remind = q.remind_time; prio = q.prio; quick = q.quick; must = q.must; if (q.list === 'work') listName = 'work';
      } else {
        title = typeof b.title === 'string' ? b.title.trim() : '';
        due = b.due_date && ISO.test(b.due_date) ? b.due_date : null;
        category = typeof b.category === 'string' && b.category.trim() ? b.category.trim() : null;
        recur = typeof b.recur === 'string' && RECURS.indexOf(b.recur) >= 0 ? b.recur : null;
        remind = typeof b.remind_time === 'string' && HHMM.test(b.remind_time) ? b.remind_time : null;
        prio = (b.prio === 1 || b.prio === 2 || b.prio === 3) ? b.prio : 0;
        quick = b.quick === true; must = b.must === true;
        if (must && !due) due = today;
      }
      if (!title) return send(res, 400, { error: 'empty item' });
      if (category && listName === 'work') category = await canonProject(token, category);
      if (typeof b.text !== 'string') isSession = SESSION.test(title);
      var addArgs = { p_token: token, p_title: title, p_due: due, p_category: category, p_recur: recur, p_session: isSession, p_remind: remind, p_list: listName }, row;
      if (prio || quick || must) {
        try {
          addArgs.p_prio = prio; addArgs.p_quick = quick; addArgs.p_must = must;
          row = await rpc('todo_add', addArgs);
        } catch (ae) {
          if (ae.code !== 'PGRST202') throw ae; // database not updated yet (setup10.sql): add the task without its tags
          delete addArgs.p_prio; delete addArgs.p_quick; delete addArgs.p_must;
          row = await rpc('todo_add', addArgs);
        }
      } else row = await rpc('todo_add', addArgs);
      var addCal = remind ? await calHook(token) : null;
      var out = { todo: row, cal: addCal };
      if (listName === 'work' && !category) { // the Shortcut uses this to offer a project picker
        out.needs_project = true;
        out.project_prompt = 'yes'; // plain text, easier for a Shortcut to test than a true/false
        out.project_names = (await projectList(token)).map(function (p) { return p.name; });
        out.project_choices = out.project_names.concat(['+ New project', 'No project']);
      } else { out.needs_project = false; out.project_prompt = 'no'; }
      return send(res, 201, out);
    }

    if (req.method === 'PATCH') {
      var id = query.id;
      if (!id || !UUID.test(id)) return send(res, 400, { error: 'bad id' });
      var pb = readBody(req), patch = {};
      if (typeof pb.done === 'boolean') patch.done = pb.done;
      if (typeof pb.title === 'string') {
        if (!pb.title.trim()) return send(res, 400, { error: 'empty title' });
        patch.title = pb.title.trim();
      }
      if ('due_date' in pb) {
        if (pb.due_date !== null && !(typeof pb.due_date === 'string' && ISO.test(pb.due_date))) return send(res, 400, { error: 'bad date' });
        patch.due_date = pb.due_date;
      }
      if ('recur' in pb) {
        if (pb.recur !== null && RECURS.indexOf(pb.recur) < 0) return send(res, 400, { error: 'bad repeat' });
        patch.recur = pb.recur;
      }
      if ('recur_until' in pb) {
        if (pb.recur_until !== null && !(typeof pb.recur_until === 'string' && ISO.test(pb.recur_until))) return send(res, 400, { error: 'bad end date' });
        patch.recur_until = pb.recur_until;
      }
      if (typeof pb.low === 'boolean') patch.low = pb.low;
      if (typeof pb.is_session === 'boolean') patch.is_session = pb.is_session;
      if ('prio' in pb) {
        if (!(pb.prio === 0 || pb.prio === 1 || pb.prio === 2 || pb.prio === 3)) return send(res, 400, { error: 'bad priority' });
        patch.prio = pb.prio;
      }
      if (typeof pb.quick === 'boolean') patch.quick = pb.quick;
      if (typeof pb.must === 'boolean') patch.must = pb.must;
      if (typeof pb.blocked === 'boolean') patch.blocked = pb.blocked;
      if (typeof pb.unblock_action === 'string' || pb.unblock_action === null) patch.unblock_action = pb.unblock_action === null ? null : pb.unblock_action.slice(0, 300);
      if ('items' in pb) {
        if (!Array.isArray(pb.items) || pb.items.length > 100) return send(res, 400, { error: 'bad items' });
        patch.items = [];
        for (var ii = 0; ii < pb.items.length; ii++) {
          var it = pb.items[ii], tx = it && typeof it.t === 'string' ? it.t.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
          if (tx) patch.items.push({ t: tx, d: it.d === true });
        }
      }
      if ('remind_time' in pb) {
        if (pb.remind_time !== null && !(typeof pb.remind_time === 'string' && HHMM.test(pb.remind_time))) return send(res, 400, { error: 'bad time' });
        patch.remind_time = pb.remind_time;
      }
      if ('list' in pb) {
        if (pb.list !== 'personal' && pb.list !== 'work') return send(res, 400, { error: 'bad list' });
        patch.list = pb.list;
      }
      if (typeof pb.focus === 'boolean') patch.focus = pb.focus;
      if (pb.reviewed === true) patch.reviewed = true;
      if ('notes' in pb) patch.notes = typeof pb.notes === 'string' ? pb.notes.trim().slice(0, 2000) : '';
      if ('category' in pb) patch.category = typeof pb.category === 'string' ? pb.category.trim() : null;
      var updated = await rpc('todo_update', { p_token: token, p_id: id, p_patch: patch });
      var calKeys = ['done', 'title', 'due_date', 'remind_time', 'recur', 'recur_until', 'category'], calRel = false;
      for (var ck = 0; ck < calKeys.length; ck++) if (calKeys[ck] in patch) calRel = true;
      var patchCal = calRel ? await calHook(token) : null;
      var gKeys = ['done', 'title', 'due_date', 'remind_time', 'list'], gRel = false;
      for (var gk = 0; gk < gKeys.length; gk++) if (gKeys[gk] in patch) gRel = true;
      var patchG = gRel ? await gcalHook(token, id, false) : null;
      return send(res, 200, { todo: updated, cal: patchCal, gcal: patchG });
    }

    if (req.method === 'DELETE') {
      var did = query.id;
      if (!did || !UUID.test(did)) return send(res, 400, { error: 'bad id' });
      if (query.scope === 'one') {
        // Skip only this occurrence of a repeating task: finishing it creates the next one, then this row is removed.
        var all = await rpc('todo_list', { p_token: token }), cur = null;
        for (var di = 0; di < all.length; di++) if (all[di].id === did) cur = all[di];
        if (cur && cur.recur && !cur.done && !cur.successor_id) await rpc('todo_update', { p_token: token, p_id: did, p_patch: { done: true } });
      }
      await gcalHook(token, did, true);
      await rpc('todo_delete', { p_token: token, p_id: did });
      var delCal = await calHook(token);
      return send(res, 200, { ok: true, cal: delCal });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23514' && /focus full/.test(e.message || '')) return send(res, 409, { error: 'focus full' });
    if (e.code === '23514' || e.code === '22007' || e.code === '22P02') return send(res, 400, { error: 'invalid input' });
    console.error('todos api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};

module.exports.HHMM = HHMM;
module.exports.parseQuick = parseQuick; // exported for local tests
module.exports.rpc = rpc;
module.exports.projectList = projectList;
module.exports.todayISO = todayISO;
