// Bulk CSV import: row validation shared by POST /api/todos?bulk=1 (not an endpoint: the leading _ keeps it from counting as a function).
// One row = one task. Column names and rules are documented in docs/import/ (schema + column guide) and enforced here only.
'use strict';

var RECURS = ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'];
var COLUMNS = ['title', 'list', 'category', 'due_date', 'remind_time', 'repeat', 'priority', 'quick', 'must_today', 'notes'];
var MAX_ROWS = 100; // per request; the page sends bigger files in several requests

function str(v) { return v == null ? '' : String(v).replace(/^\s+|\s+$/g, ''); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function validYMD(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// "2026-11-24" or UK "24/11/2026" (Excel rewrites dates this way) -> "2026-11-24", else null
function parseDate(s) {
  var m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return validYMD(+m[1], +m[2], +m[3]) ? s : null;
  if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/))) return validYMD(+m[3], +m[2], +m[1]) ? m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]) : null;
  return null;
}
function parseTime(s) {
  var m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return pad(+m[1]) + ':' + m[2];
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
  if (s) { x = parseDate(s); if (x) v.due_date = x; else e.push('due_date must be YYYY-MM-DD (or DD/MM/YYYY) and a real date'); }

  s = str(raw.remind_time);
  v.remind_time = null;
  if (s) { x = parseTime(s); if (x) v.remind_time = x; else e.push('remind_time must be HH:MM, 24-hour (e.g. 09:30)'); }

  s = str(raw.repeat).toLowerCase();
  v.recur = null;
  if (s) { if (RECURS.indexOf(s) >= 0) v.recur = s; else e.push('repeat must be one of ' + RECURS.join(', ')); }

  s = str(raw.priority);
  v.prio = 0;
  if (s) { if (/^[0-3]$/.test(s)) v.prio = +s; else e.push('priority must be 0, 1, 2 or 3'); }

  x = parseBool(str(raw.quick));
  if (x === null) { e.push('quick must be yes or no'); x = false; }
  v.quick = x;

  x = parseBool(str(raw.must_today));
  if (x === null) { e.push('must_today must be yes or no'); x = false; }
  v.must = x;

  s = str(raw.notes);
  if (s.length > 2000) e.push('notes is longer than 2000 characters');
  v.notes = s;

  // Same defaults as quick add: repeats, reminders and "must do today" start today unless a date is given.
  if (!v.due_date && (v.recur || v.remind_time || v.must)) v.due_date = today;
  if (v.must && v.due_date > today) e.push('must_today needs a due_date of today or earlier');
  return { errors: e, value: v };
}

module.exports = { validateRow: validateRow, COLUMNS: COLUMNS, RECURS: RECURS, MAX_ROWS: MAX_ROWS };
