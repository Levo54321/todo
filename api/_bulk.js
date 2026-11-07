// Bulk CSV import: row validation shared by POST /api/todos?bulk=1 (not an endpoint: the leading _ keeps it from counting as a function).
// One row = one task. Column names and rules are documented in docs/import/ (schema + column guide) and enforced here only.
'use strict';

var RECURS = ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'];
var COLUMNS = ['title', 'list', 'category', 'due_date', 'remind_time', 'repeat', 'priority', 'quick', 'must_today', 'notes', 'subtasks'];
var MAX_ROWS = 100; // per request; the page sends bigger files in several requests

function str(v) { return v == null ? '' : String(v).replace(/^\s+|\s+$/g, ''); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function validYMD(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
var WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function addDays(ymd, n) { var m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/), d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
// "2026-11-24", UK "24/11/2026" (Excel), or words: today, tomorrow, mon / next friday (today if it is that day), "9 Nov", "Mon 9 November 2026" -> "2026-11-24", else null
function parseDate(s, today) {
  var m, t = s.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/^\s|\s$/g, '');
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return validYMD(+m[1], +m[2], +m[3]) ? s : null;
  if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/))) return validYMD(+m[3], +m[2], +m[1]) ? m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]) : null;
  if (!today) return null;
  if (t === 'today') return today;
  if (t === 'tomorrow' || t === 'tmrw') return addDays(today, 1);
  if ((m = t.match(/^(?:next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/))) {
    var tm = today.match(/^(\d{4})-(\d{2})-(\d{2})$/), dow = new Date(Date.UTC(+tm[1], +tm[2] - 1, +tm[3])).getUTCDay(), want = WD.indexOf(m[1]);
    return addDays(today, (want - dow + 7) % 7);
  }
  if ((m = t.match(/^(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]* )?(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?: (\d{4}))?$/))) {
    var mo = MON.indexOf(m[2]) + 1, y = m[3] ? +m[3] : +today.slice(0, 4), out;
    if (!validYMD(y, mo, +m[1])) return null;
    out = y + '-' + pad(mo) + '-' + pad(+m[1]);
    if (!m[3] && out < today) { y++; if (!validYMD(y, mo, +m[1])) return null; out = y + '-' + pad(mo) + '-' + pad(+m[1]); }
    return out;
  }
  return null;
}
// "09:30", "9:30", "9am", "3.30pm", "12am" -> "HH:MM", else null
function parseTime(s) {
  var m = s.toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?(am|pm)?$/), h, mi;
  if (!m || (m[2] === undefined && !m[3])) return null;
  h = +m[1]; mi = m[2] === undefined ? 0 : +m[2];
  if (m[3]) { if (h < 1 || h > 12) return null; if (m[3] === 'am') h = h === 12 ? 0 : h; else h = h === 12 ? 12 : h + 12; }
  if (h > 23 || mi > 59) return null;
  return pad(h) + ':' + pad(mi);
}
function parsePrio(s) {
  var v = s.toLowerCase();
  if (/^[0-3]$/.test(v)) return +v;
  if (/^!{1,3}$/.test(v)) return v.length;
  if (v === 'high' || v === 'urgent' || v === 'critical') return 3;
  if (v === 'medium' || v === 'med' || v === 'normal') return 2;
  if (v === 'low') return 1;
  if (v === 'none') return 0;
  return null;
}
function parseRepeat(s) {
  var v = s.toLowerCase().replace(/^every\s+/, '').replace(/\s+/g, ' ');
  if (RECURS.indexOf(v) >= 0) return v;
  if (v === 'none' || v === 'no' || v === 'never' || v === '-') return '';
  if (v === 'day') return 'daily';
  if (v === 'week') return 'weekly';
  if (v === 'weekday' || v === 'week day') return 'weekdays';
  if (v === 'fortnight' || v === 'biweekly' || v === 'bi-weekly' || v === '2 weeks' || v === 'two weeks' || v === 'other week') return 'fortnightly';
  if (v === 'month') return 'monthly';
  if (v === 'year' || v === 'annually' || v === 'annual') return 'yearly';
  return null;
}
// Sub-task cell: items split on | or a line break; write \| for a literal pipe inside an item.
function splitSubs(s) {
  var out = [], cur = '', i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charAt(i);
    if (c === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; }
    else if (c === '|' || c === '\n' || c === '\r') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function parseBool(s) {
  var v = s.toLowerCase();
  if (v === '' || v === 'no' || v === 'n' || v === 'false' || v === '0') return false;
  if (v === 'yes' || v === 'y' || v === 'true' || v === '1') return true;
  return null;
}

// raw: object keyed by column name (lower case). Returns { errors: [...], value: {...} }.
function validateRow(raw, today) {
  var e = [], v = {}, s, x;
  raw = raw && typeof raw === 'object' ? raw : {};

  s = str(raw.title).replace(/\s+/g, ' ');
  if (!s) e.push('title is required'); else if (s.length > 500) e.push('title is longer than 500 characters');
  v.title = s;

  s = str(raw.list).toLowerCase();
  if (s === '' || s === 'personal') v.list = 'personal';
  else if (s === 'work') v.list = 'work';
  else { e.push('list must be personal or work'); v.list = 'personal'; }

  s = str(raw.category).replace(/\s+/g, ' ');
  if (s.length > 60) e.push('category is longer than 60 characters');
  v.category = s || null;

  s = str(raw.due_date);
  v.due_date = null;
  if (s) { x = parseDate(s, today); if (x) v.due_date = x; else e.push('due_date must be YYYY-MM-DD (or DD/MM/YYYY, today, tomorrow, a weekday, or like 9 Nov) and a real date'); }

  s = str(raw.remind_time);
  v.remind_time = null;
  if (s) { x = parseTime(s); if (x) v.remind_time = x; else e.push('remind_time must be a time like 09:30 or 9am'); }

  s = str(raw.repeat).toLowerCase();
  v.recur = null;
  if (s) { x = parseRepeat(s); if (x === null) e.push('repeat must be one of ' + RECURS.join(', ')); else v.recur = x || null; }

  s = str(raw.priority);
  v.prio = 0;
  if (s) { x = parsePrio(s); if (x === null) e.push('priority must be 0, 1, 2 or 3'); else v.prio = x; }

  x = parseBool(str(raw.quick));
  if (x === null) { e.push('quick must be yes or no'); x = false; }
  v.quick = x;

  x = parseBool(str(raw.must_today));
  if (x === null) { e.push('must_today must be yes or no'); x = false; }
  v.must = x;

  s = str(raw.notes);
  if (s.length > 2000) e.push('notes is longer than 2000 characters');
  v.notes = s;

  // Sub-tasks: separated by | or line breaks; "[x] " at the start marks one as already done. Shown in the task's Sub-tasks list.
  s = str(raw.subtasks);
  v.subtasks = [];
  if (s) {
    var parts = splitSubs(s), j, it, done;
    for (j = 0; j < parts.length; j++) {
      it = str(parts[j]); done = false;
      if (/^\[[xX]\]/.test(it)) { done = true; it = str(it.replace(/^\[[xX]\]/, '')); } else if (/^\[ ?\]/.test(it)) it = str(it.replace(/^\[ ?\]/, ''));
      it = it.replace(/^[-*•]\s+/, '');
      if (!it) continue;
      if (it.length > 200) { e.push('each sub-task must be 200 characters or fewer'); break; }
      v.subtasks.push({ t: it, d: done });
    }
    if (v.subtasks.length > 100) e.push('at most 100 sub-tasks per task');
  }

  // Optional id of an existing task: the row then UPDATES that task (only the columns present in the file) instead of adding one.
  s = str(raw.id);
  v.id = null;
  if (s) { if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) v.id = s.toLowerCase(); else e.push('id is not a valid task id'); }
  v.present = [];
  for (x = 0; x < COLUMNS.length; x++) if (Object.prototype.hasOwnProperty.call(raw, COLUMNS[x])) v.present.push(COLUMNS[x]);

  // Same defaults as quick add: repeats, reminders and "must do today" start today unless a date is given.
  if (!v.due_date && (v.recur || v.remind_time || v.must)) v.due_date = today;
  if (v.must && v.due_date > today) e.push('must_today needs a due_date of today or earlier');
  return { errors: e, value: v };
}

module.exports = { validateRow: validateRow, COLUMNS: COLUMNS, RECURS: RECURS, MAX_ROWS: MAX_ROWS };
