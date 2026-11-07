// Scan helper (not an endpoint: the leading _ keeps it out of Vercel's 12-function limit). Used by POST /api/todos?scan=1.
// Sends a photo of handwritten notes to Gemini and gets back import CSV text (the same 11 columns as Settings > Import).
// The key lives ONLY in the Vercel env var GEMINI_API_KEY (Luc sets it); the model is GEMINI_MODEL (default below).
// Never log the key, the image or the CSV text.

var HEADER = 'title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks';
var DEFAULT_MODEL = 'gemini-3.8-flash';
var MAX_BYTES = 3500000; // Vercel allows 4.5 MB per request; this leaves room
var MAX_ROWS = 100;
var TIMEOUT_MS = 25000; // the function limit is 30 s (vercel.json)

function fail(status, msg) { var e = new Error(msg); e.status = status; return e; }

// What kind of image is this? (checked from the first bytes, not from a header the sender could get wrong)
function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.slice(4, 8).toString('latin1') === 'ftyp') { var brand = b.slice(8, 12).toString('latin1'); if (/^(heic|heix|hevc|mif1|msf1)/.test(brand)) return 'image/heic'; }
  return null;
}

// The request body can be the raw photo (Shortcuts "File" body), or base64 text, or JSON { image: "<base64>" }.
function imageFrom(body) {
  var b = body, s;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) b = typeof b.image === 'string' ? b.image : null;
  if (b == null || b === '') throw fail(400, 'No photo was received.');
  if (typeof b === 'string') b = Buffer.from(b.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''), 'base64');
  if (!Buffer.isBuffer(b) || !b.length) throw fail(400, 'No photo was received.');
  if (b.length > MAX_BYTES * 1.4) throw fail(413, 'That photo is too big. Make the Resize step in the Shortcut smaller (width 1200).');
  if (!sniff(b)) { // maybe the raw body was base64 text
    s = b.toString('latin1').replace(/\s+/g, '');
    if (/^[A-Za-z0-9+\/=]+$/.test(s) && s.length > 100) b = Buffer.from(s, 'base64');
  }
  if (b.length > MAX_BYTES) throw fail(413, 'That photo is too big. Make the Resize step in the Shortcut smaller (width 1200).');
  if (!sniff(b)) throw fail(400, 'That is not a photo I can read (use JPEG: add Convert Image to JPEG in the Shortcut).');
  return b;
}

function buildPrompt(today, projects) {
  var known = (projects && projects.length) ? ' known Work projects are ' + projects.slice(0, 40).join(', ') + ', so if a heading clearly means one of those use that exact name.' : '';
  return 'You are converting a photo of handwritten notes into an import file for a to-do app. Output ONLY CSV text: no code fences, no commentary, no blank lines. ' +
    'The first line is the header row: ' + HEADER + ' (copy it exactly). Every following line is one task with exactly 11 cells (10 commas outside quotes); leave unused cells empty; ' +
    'wrap any cell containing a comma, quote mark or line break in quote marks and double any quote mark inside it. ' +
    'READING THE PAGE: a line with no dash is a heading and becomes the category of the dash lines below it until the next heading; every line that starts with a dash is one task (its title). ' +
    'Skip anything ticked off or crossed out. Ignore ink showing through from the other side of the page. ' +
    'Fix obvious handwriting or spelling slips using context, for example healh becomes health; keep a trailing question mark; if a word is truly unreadable write [?] in its place. ' +
    'COLUMNS: list is work or personal, default work unless the heading or task is clearly personal. category is the heading text (tidy spelling, max 60 characters), or empty if there is no heading;' + known + ' ' +
    'due_date is YYYY-MM-DD and only if a day or date is written; today is ' + today + ', and a weekday name means the next such day (today if it is that day). ' +
    'remind_time is HH:MM in 24-hour time and only if a time is written. repeat is one of daily, weekdays, weekly, fortnightly, monthly, yearly and only if written. ' +
    'priority is a single digit 0 to 3 (3 is most important), only if shown by marks such as ! !! !!! or the word urgent or high, otherwise empty. ' +
    'quick is yes only if the page says quick, otherwise empty. must_today is yes only if the page says must do today, otherwise empty. ' +
    'notes is only extra context actually written next to a task, never invented, otherwise empty. subtasks is empty unless sub-items are clearly written under a task, then separate them with |. ' +
    'title is required, one line, max 500 characters. Do not add any column, number, or text of your own. If nothing is readable output only the header line.';
}

// Tidy what the model sent: no BOM, no ``` fences, must start with the header.
function cleanCsv(text) {
  var t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  t = t.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (!/^title\s*,/i.test(t)) throw fail(502, 'The reply was not a task list. Try again, or retake the photo.');
  return t;
}

// Number of task lines (quote-aware, ignores blank lines and the header).
function countRows(csv) {
  var n = 0, q = false, any = false, i, c;
  for (i = 0; i < csv.length; i++) {
    c = csv.charAt(i);
    if (c === '"') { q = !q; any = true; }
    else if (c === '\n' && !q) { if (any) n++; any = false; }
    else if (!/\s/.test(c)) any = true;
  }
  if (any) n++;
  return Math.max(0, n - 1);
}

// Ask Gemini. Returns { csv, rows }. Throws an Error with .status (what to answer) and a message safe to show.
async function readNotes(buf, opt) {
  var key = process.env.GEMINI_API_KEY;
  if (!key) throw fail(503, 'Scanning is not set up yet: GEMINI_API_KEY is missing in Vercel.');
  var model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL); if (!/^[A-Za-z0-9._-]+$/.test(model)) model = DEFAULT_MODEL;
  var mime = sniff(buf), ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, opt.timeout || TIMEOUT_MS), r, raw, data = null;
  var body = { generationConfig: { temperature: 0 }, contents: [{ parts: [{ text: buildPrompt(opt.today, opt.projects) }, { inline_data: { mime_type: mime, data: buf.toString('base64') } }] }] };
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal
    });
    raw = await r.text();
  } catch (e) {
    if (e && e.name === 'AbortError') throw fail(504, 'Gemini took too long. Try again.');
    throw fail(502, 'Could not reach Gemini.');
  } finally { clearTimeout(timer); }
  try { data = raw ? JSON.parse(raw) : null; } catch (e2) { data = null; }
  if (!r.ok) {
    if (r.status === 429) throw fail(429, 'Gemini is busy or the free limit was reached. Try again in a minute.');
    if (r.status === 404) throw fail(502, 'The Gemini model name is no longer available. Set GEMINI_MODEL in Vercel.');
    if (r.status === 401 || r.status === 403) throw fail(502, 'Gemini refused the key. Check GEMINI_API_KEY in Vercel.');
    throw fail(502, 'Gemini could not read that photo' + (data && data.error && data.error.message ? ': ' + String(data.error.message).slice(0, 160) : '.'));
  }
  var parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts, text = '', i;
  for (i = 0; parts && i < parts.length; i++) if (typeof parts[i].text === 'string' && !parts[i].thought) text += parts[i].text;
  if (!text) throw fail(502, 'Gemini sent back nothing. Try again, or retake the photo.');
  var csv = cleanCsv(text), rows = countRows(csv);
  if (rows > MAX_ROWS) throw fail(502, 'That page produced ' + rows + ' tasks; the limit is ' + MAX_ROWS + '.');
  return { csv: csv, rows: rows };
}

module.exports = { HEADER: HEADER, sniff: sniff, imageFrom: imageFrom, buildPrompt: buildPrompt, cleanCsv: cleanCsv, countRows: countRows, readNotes: readNotes };
