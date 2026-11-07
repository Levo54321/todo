(function () {
  'use strict';
  /* Settings > Import: add many tasks at once from a CSV file or pasted CSV text (works on Mac/PC, iPhone and iPad).
     The page reads the file, the server (api/_bulk.js) is the only place that judges the rows: first a dry run, then the real add. */
  var App = window.App; if (!App) return;
  var esc = App.esc;
  var ua = navigator.userAgent || '';
  var touchy = /iPad|iPhone|iPod|Android|Mobi/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var oldIOS = /iP(ad|hone|od)/.test(ua) && /OS [0-9]_/.test(ua); // iOS 9 and older cannot save a file or copy by script
  var canFile = !!window.FileReader && !/iPad|iPhone|iPod/.test(ua); // iOS 9 cannot pick a CSV from Files reliably: paste is the way there

  var COLS = ['title', 'list', 'category', 'due_date', 'remind_time', 'repeat', 'priority', 'quick', 'must_today', 'notes', 'subtasks'];
  var CHUNK = 100, MAXROWS = 1000;
  var TEMPLATE = 'title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks\r\n' +
    'Call the dentist,personal,Health,2026-11-24,09:30,,,,,Ask about the October invoice,\r\n' +
    'Send weekly report,work,,2026-11-27,,weekly,2,no,no,"**Include:**\n- Open risks\n- Next week plan","Draft summary|Check numbers|Send to team"\r\n' +
    'Water the plants,personal,Home,,,weekly,,,,,\r\n';
  var DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ALIAS = { name: 'title', task: 'title', task_name: 'title', item: 'title', summary: 'title', project: 'category', tag: 'category', label: 'category', list_name: 'list',
    due: 'due_date', date: 'due_date', deadline: 'due_date', due_on: 'due_date', time: 'remind_time', reminder: 'remind_time', remind: 'remind_time', reminder_time: 'remind_time',
    recur: 'repeat', recurrence: 'repeat', repeats: 'repeat', frequency: 'repeat', prio: 'priority', quick_task: 'quick', must: 'must_today', must_do_today: 'must_today',
    note: 'notes', details: 'notes', description: 'notes', comment: 'notes', comments: 'notes',
    subtask: 'subtasks', sub_tasks: 'subtasks', sub_task: 'subtasks', steps: 'subtasks', checklist: 'subtasks', items: 'subtasks' };
  var st = null, body = null, mode = canFile ? 'file' : 'paste', pasteText = '', hist = { list: null, unavailable: false, confirm: '', note: '', busy: false, show: null };
  function fresh() { return { phase: 'idle', file: '', batch: '', rows: [], ignored: [], mapping: [], errors: [], preview: [], msg: '', added: 0 }; }
  st = fresh();
  function uuid() {
    var c = window.crypto || window.msCrypto, b = [], i;
    if (c && c.getRandomValues) { var a = new Uint8Array(16); c.getRandomValues(a); for (i = 0; i < 16; i++) b.push(a[i]); }
    else for (i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = '', k; for (k = 0; k < 16; k++) { h += (b[k] < 16 ? '0' : '') + b[k].toString(16); if (k === 3 || k === 5 || k === 7 || k === 9) h += '-'; }
    return h;
  }


  function norm(h) { return String(h).replace(/^\s+|\s+$/g, '').toLowerCase().replace(/[\s\-]+/g, '_'); }

  /* RFC-4180-ish parser: quotes, doubled quotes, line breaks inside quotes, CRLF/LF/CR, BOM, "," or ";" separator. */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var first = text.split(/\r\n|\n|\r/)[0] || '';
    var delim = (first.indexOf(',') < 0 && first.indexOf(';') >= 0) ? ';' : ',';
    var recs = [], row = [], f = '', q = false, i = 0, c, line = 1, start = 1, n = text.length;
    function endField() { row.push(f); f = ''; }
    function endRec() {
      endField();
      var empty = true, k;
      for (k = 0; k < row.length; k++) if (row[k].replace(/\s+/g, '') !== '') { empty = false; break; }
      if (!empty) recs.push({ line: start, cells: row });
      row = [];
    }
    while (i < n) {
      c = text.charAt(i);
      if (q) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else q = false; }
        else { if (c === '\n') line++; f += c; }
      } else if (c === '"' && f === '') q = true;
      else if (c === delim) endField();
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        endRec(); line++; start = line;
      } else f += c;
      i++;
    }
    if (q) return { error: 'The file has a quote mark that is never closed.' };
    if (f !== '' || row.length) endRec();
    return { recs: recs };
  }

  function build(text) {
    var p = parseCSV(text), head, map = {}, mapping = [], ignored = [], rows = [], i, j, r, o, key, used = {}, f;
    if (p.error) return { error: p.error };
    if (!p.recs.length) return { error: 'The file is empty.' };
    head = p.recs[0].cells;
    for (j = 0; j < head.length; j++) { // exact column names first
      key = norm(head[j]);
      if (key && COLS.indexOf(key) >= 0 && map[key] === undefined) { map[key] = j; used[j] = true; mapping.push({ field: key, header: String(head[j]).replace(/^\s+|\s+$/g, ''), alias: false }); }
    }
    for (j = 0; j < head.length; j++) { // then well-known alternative names (Due, Project, Details...) for fields still missing
      key = norm(head[j]);
      if (!key || used[j]) continue;
      f = ALIAS[key];
      if (f && map[f] === undefined) { map[f] = j; used[j] = true; mapping.push({ field: f, header: String(head[j]).replace(/^\s+|\s+$/g, ''), alias: true }); }
    }
    for (j = 0; j < head.length; j++) if (!used[j] && norm(head[j])) ignored.push(String(head[j]).replace(/^\s+|\s+$/g, ''));
    if (map.title === undefined) return { error: 'There is no "title" column in the first row. Download the template to see the layout.' };
    for (i = 1; i < p.recs.length; i++) {
      r = p.recs[i]; o = { row: r.line };
      for (key in map) if (map.hasOwnProperty(key)) o[key] = r.cells[map[key]] === undefined ? '' : r.cells[map[key]];
      rows.push(o);
    }
    if (!rows.length) return { error: 'The file has a header row but no tasks under it.' };
    if (rows.length > MAXROWS) return { error: 'The file has ' + rows.length + ' tasks; the limit is ' + MAXROWS + ' per file. Split it and import the parts one at a time.' };
    return { rows: rows, ignored: ignored, mapping: mapping };
  }

  /* The clean CSV of what was understood (same 11 columns the app reads), kept with the import so it can be downloaded or copied later. */
  function csvCell(x) { x = x == null ? '' : String(x); return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }
  function canonCSV() {
    var out = [COLS.join(',')], i, v, subs, k, row;
    for (i = 0; i < st.preview.length; i++) {
      v = st.preview[i].value; subs = [];
      for (k = 0; k < (v.subtasks || []).length; k++) subs.push((v.subtasks[k].d ? '[x] ' : '') + v.subtasks[k].t);
      row = [v.title, v.list, v.category || '', v.due_date || '', v.remind_time || '', v.recur || '', v.prio ? v.prio : '', v.quick ? 'yes' : '', v.must ? 'yes' : '', v.notes || '', subs.join('|')];
      for (k = 0; k < row.length; k++) row[k] = csvCell(row[k]);
      out.push(row.join(','));
    }
    return out.join('\r\n') + '\r\n';
  }

  function chunks() { var out = [], i; for (i = 0; i < st.rows.length; i += CHUNK) out.push(st.rows.slice(i, i + CHUNK)); return out; }

  function check() {
    var parts = chunks(), at = 0;
    st.phase = 'checking'; st.errors = []; st.preview = []; st.msg = ''; paint();
    function next() {
      if (at >= parts.length) { st.phase = 'ready'; paint(); return; }
      App.api('POST', '?bulk=1', { rows: parts[at], dry: true }, function (s, d) {
        if (s === 200 || (s === 400 && d && d.errors)) {
          if (d && d.errors) st.errors = st.errors.concat(d.errors);
          if (d && d.preview) st.preview = st.preview.concat(d.preview);
          at++; next();
        } else { st.phase = 'idle'; st.msg = 'Could not check the file (' + (d && d.error ? d.error : 'error ' + s) + '). Nothing was added.'; paint(); }
      });
    }
    next();
  }

  function run() {
    var parts = chunks(), at = 0;
    st.phase = 'importing'; st.added = 0; st.msg = ''; paint();
    function finish() { App.mutated(); App.reloadWhenSettingsClose(); loadHist(); }
    function next() {
      if (at >= parts.length) { st.phase = 'done'; finish(); paint(); return; }
      var req = { rows: parts[at], batch: st.batch, name: st.file }; if (at === 0) req.csv = canonCSV();
      App.api('POST', '?bulk=1', req, function (s, d) {
        if (s === 201 && d && d.ok) { st.added += d.added; at++; next(); }
        else {
          st.added += (d && d.added) || 0;
          st.phase = 'failed'; st.msg = 'Stopped part-way: ' + st.added + ' of ' + st.rows.length + ' tasks were added. Use Undo in "Previous imports" below to remove them, fix the file, then import it again.';
          finish(); paint();
        }
      });
    }
    next();
  }

  function start(text, name) {
    st = fresh(); st.file = name; st.batch = uuid();
    var b = build(String(text || ''));
    if (b.error) { st.msg = b.error; paint(); return; }
    st.rows = b.rows; st.ignored = b.ignored; st.mapping = b.mapping; check();
  }
  function choose(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () { start(rd.result, file.name); };
    rd.onerror = function () { st = fresh(); st.msg = 'Could not read that file.'; paint(); };
    rd.readAsText(file, 'UTF-8');
  }

  function download() {
    try {
      var blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'luc-todo-import-template.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { st.msg = 'Could not make the template on this browser.'; paint(); }
  }

  /* ---------- previous imports + undo ---------- */
  function loadHist() {
    App.api('GET', '?imports=1', null, function (s, d) {
      if (s === 200 && d) { hist.list = d.imports || []; hist.unavailable = !!d.unavailable; }
      else if (hist.list === null) hist.list = [];
      paint();
    });
  }
  function undo(id) {
    hist.busy = true; hist.confirm = ''; hist.note = ''; paint();
    App.api('POST', '?import_undo=' + encodeURIComponent(id), { go: 1 }, function (s, d) {
      hist.busy = false;
      if (s === 200 && d && d.ok) { hist.note = 'Undone: ' + d.removed + ' task' + (d.removed === 1 ? '' : 's') + ' removed.'; App.mutated(); App.reloadWhenSettingsClose(); }
      else if (s === 409) hist.note = 'That import was already undone.';
      else hist.note = 'Could not undo that import (' + (d && d.error ? d.error : 'error ' + s) + '). Nothing was changed.';
      loadHist();
    });
  }

  function fileName(n) { return String(n || 'import').replace(/\.csv$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-') + '-copy.csv'; }
  function withCsv(id, cb) {
    hist.note = ''; hist.show = null;
    App.api('GET', '?import_csv=' + encodeURIComponent(id), null, function (s, d) {
      if (s === 200 && d && d.csv) cb(d); else { hist.note = s === 404 ? 'No copy was saved for that import (only imports made since this feature was added have one).' : 'Could not get that import (error ' + s + ').'; paint(); }
    });
  }
  function showText(d, why) { hist.show = { name: d.name, csv: d.csv, why: why }; paint(); var ta = document.getElementById('impCsvBox'); if (ta) { ta.focus(); ta.select(); } }
  function copyImport(id) {
    withCsv(id, function (d) {
      var done = function () { hist.note = 'Copied “' + (d.name || 'import') + '” (' + d.csv.split('\n').length + ' lines) to the clipboard.'; paint(); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) { navigator.clipboard.writeText(d.csv).then(done, function () { showText(d, 'Select all and copy this text.'); }); return; }
        var t = document.createElement('textarea'); t.value = d.csv; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(t); t.focus(); t.select(); try { t.setSelectionRange(0, d.csv.length); } catch (e1) {}
        var ok = document.execCommand && document.execCommand('copy'); document.body.removeChild(t);
        if (ok) done(); else showText(d, 'Your browser would not copy automatically. Select all and copy this text.');
      } catch (e) { showText(d, 'Select all and copy this text.'); }
    });
  }
  function downloadImport(id) {
    withCsv(id, function (d) {
      if (oldIOS) { showText(d, 'This browser cannot save files. Select all and copy this text instead.'); return; }
      try {
        var blob = new Blob([d.csv], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fileName(d.name);
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        hist.note = 'Downloaded ' + fileName(d.name) + '.'; paint();
      } catch (e) { showText(d, 'Could not save a file here. Select all and copy this text instead.'); }
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(iso) {
    if (!iso) return '';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return String(iso);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DAYN[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MONN[+m[2] - 1] + ' ' + m[1];
  }
  function fmtWhen(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONN[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* ---------- preview ---------- */
  var FIELD_KEY = { title: 'title', list: 'list', category: 'category', due_date: 'due_date', remind_time: 'remind_time', repeat: 'recur', priority: 'prio', quick: 'quick', must_today: 'must', notes: 'notes', subtasks: 'subtasks' };
  function chip(cls, txt) { return '<span class="impchip ' + cls + '">' + esc(txt) + '</span>'; }
  function mappingHTML() {
    var h = '<div class="imph">Columns</div><div class="impmap" id="impMap">', i, m, found = {}, f, c, blank = [], empty = [];
    for (i = 0; i < st.mapping.length; i++) { m = st.mapping[i]; found[m.field] = m; }
    h += '<div class="impchips">';
    for (i = 0; i < COLS.length; i++) {
      f = COLS[i]; m = found[f];
      if (m) h += '<span class="impchip ok">✓ <b>' + esc(f) + '</b> ← “' + esc(m.header) + '”' + (m.alias ? ' <span class="impsoft">(read as ' + esc(f) + ')</span>' : '') + '</span>';
      else blank.push(f);
    }
    h += '</div>';
    for (i = 0; i < st.ignored.length; i++) h += '<div class="impwarn">⚠ Column “' + esc(st.ignored[i]) + '” is not recognised: <b>its data will NOT be imported</b></div>';
    for (i = 1; i < COLS.length; i++) {
      f = COLS[i]; if (!found[f] || f === 'list') continue;
      var any = false, k = FIELD_KEY[f], pi;
      for (pi = 0; pi < st.preview.length; pi++) { c = st.preview[pi].value[k]; if (c && c !== 0 && c !== false && !(c.length === 0)) { any = true; break; } }
      if (!any) empty.push(f);
    }
    if (empty.length) h += '<div class="impinfo">ℹ Found but every cell is empty or “no”: ' + esc(empty.join(', ')) + '</div>';
    if (blank.length) h += '<div class="impinfo">Not in the file (left blank): ' + esc(blank.join(', ')) + '</div>';
    return h + '</div>';
  }
  function cardHTML(p) {
    var v = p.value, bad = p.errors.length > 0, h = '<div class="impcard' + (bad ? ' bad' : '') + (v.list === 'work' ? ' work' : '') + '">', c = '', n, k;
    h += '<div class="imptop"><span class="implnum">Line ' + p.row + '</span><span class="impttl">' + (v.title ? esc(v.title) : '<i>no title</i>') + '</span></div>';
    c += chip(v.list === 'work' ? 'w' : '', v.list);
    if (v.category) c += chip('', v.category);
    if (v.due_date) c += chip('d', '📅 ' + fmtDate(v.due_date));
    if (v.remind_time) c += chip('d', '⏰ ' + v.remind_time);
    if (v.recur) c += chip('d', '↻ ' + v.recur);
    if (v.prio) c += chip('p', new Array(v.prio + 1).join('!') + ' (' + v.prio + ')');
    if (v.quick) c += chip('q', 'quick');
    if (v.must) c += chip('m', 'must today');
    h += '<div class="impchips">' + c + '</div>';
    if (v.notes) h += '<div class="impnotes">' + esc(v.notes.length > 140 ? v.notes.slice(0, 140) + '…' : v.notes).replace(/\n+/g, ' · ') + '</div>';
    if (v.subtasks && v.subtasks.length) {
      n = []; for (k = 0; k < v.subtasks.length && k < 4; k++) n.push((v.subtasks[k].d ? '☑ ' : '☐ ') + v.subtasks[k].t);
      h += '<div class="impsubs"><b>' + plural(v.subtasks.length, 'sub-task') + '</b> · ' + esc(n.join(' · ')) + (v.subtasks.length > 4 ? ' …' : '') + '</div>';
    }
    if (bad) h += '<div class="impbad">' + esc(p.errors.join('; ')) + '</div>';
    return h + '</div>';
  }
  function previewHTML() {
    var h = mappingHTML(), i, shown = st.preview.slice(0, 200);
    h += '<div class="imph">Review: what will be added</div><div class="impscroll" id="impPreview">';
    for (i = 0; i < shown.length; i++) h += cardHTML(shown[i]);
    h += '</div>';
    if (st.preview.length > shown.length) h += '<div class="impinfo">Showing the first ' + shown.length + ' of ' + st.preview.length + ' tasks.</div>';
    return h;
  }

  function histHTML() {
    var h = '<div class="imph">Previous imports</div>', i, x, list = hist.list;
    if (hist.note) h += '<div class="impinfo" id="impHistNote">' + esc(hist.note) + '</div>';
    if (hist.show) h += '<div class="impcsvpanel" id="impCsvPanel"><div class="impinfo">' + esc(hist.show.why || '') + '</div><textarea id="impCsvBox" class="impta" rows="8" readonly spellcheck="false">' + esc(hist.show.csv) + '</textarea><div class="improw"><button class="btn" data-imp="closecsv" type="button">Close</button></div></div>';
    if (list === null) return h + '<div class="impinfo">Loading…</div>';
    if (hist.unavailable) return h + '<div class="impinfo">Import history needs the database update (setup21.sql) first.</div>';
    if (!list.length) return h + '<div class="impinfo" id="impHistEmpty">No imports yet. Each import you make is listed here so it can be undone.</div>';
    h += '<div class="imphist" id="impHist">';
    for (i = 0; i < list.length; i++) {
      x = list[i];
      h += '<div class="imphrow' + (x.undone_at ? ' undone' : '') + '"><div class="imphinfo"><b>' + esc(x.name || 'Import') + '</b><span class="impsoft">' + esc(fmtWhen(x.created_at)) + ' · ' + plural(x.n, 'task') + ' added' +
        (x.undone_at ? ' · undone (' + plural(x.undone_n || 0, 'task') + ' removed)' : ' · ' + x.alive + ' still in your lists') + '</span></div>';
      if (x.has_csv) h += '<div class="imphact imphcopy"><button class="btn" data-imp="copy" data-id="' + esc(x.id) + '" type="button">Copy</button><button class="btn" data-imp="dl" data-id="' + esc(x.id) + '" type="button">Download</button></div>';
      if (!x.undone_at) {
        if (hist.confirm === x.id) h += '<div class="imphact"><span class="impsoft">Remove ' + plural(x.alive, 'task') + '?</span><button class="btn danger" data-imp="yes" data-id="' + esc(x.id) + '" type="button">Yes, undo</button><button class="btn" data-imp="no" type="button">Keep</button></div>';
        else h += '<div class="imphact"><button class="btn" data-imp="ask" data-id="' + esc(x.id) + '" type="button"' + (hist.busy ? ' disabled' : '') + '>Undo</button></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function sourceHTML() {
    var h = '<div class="seg impseg">' + (canFile ? '<button type="button" id="impModeFile" data-imp="mfile" class="' + (mode === 'file' ? 'on' : '') + '">Upload file</button>' : '') +
      '<button type="button" id="impModePaste" data-imp="mpaste" class="' + (mode === 'paste' ? 'on' : '') + '">Paste CSV</button></div>';
    if (mode === 'file') {
      h += '<div class="impdrop"><div class="impdropt">Choose a <b>.csv</b> file from this computer</div>' +
        '<label class="btn primary impfilebtn" for="impFile">Choose CSV file</label><input type="file" id="impFile" class="impfile" accept=".csv,text/csv"></div>';
    } else {
      h += '<textarea id="impPaste" class="impta" rows="7" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="Paste the CSV text here, header line first:\ntitle,list,category,due_date,...">' + esc(pasteText) + '</textarea>' +
        '<div class="improw"><button class="btn primary" id="impCheck" data-imp="check" type="button">Review pasted CSV</button>' +
        '<button class="btn" id="impExample" data-imp="example" type="button">Use the example</button>' +
        '<button class="btn" data-imp="clear" type="button">Clear</button></div>';
    }
    if (!touchy) h += '<div class="improw"><button class="btn" id="impTpl" type="button">Download template</button></div>';
    return h;
  }

  function paint() {
    if (!body) return;
    var h = '<div class="imp"><div class="impintro">Add many tasks at once from a CSV. Columns: <span class="impsoft">' + esc(COLS.join(', ')) + '</span>. Only <b>title</b> is required. Sub-tasks go in one cell separated by <b>|</b>.</div>', i, shown;
    if (st.phase === 'idle' || st.phase === 'ready' || st.phase === 'done' || st.phase === 'failed') h += '<div class="impcardbox">' + sourceHTML() + '</div>';
    if (st.msg) h += '<div class="imperr" id="impMsg">' + esc(st.msg) + '</div>';
    if (st.phase === 'checking') h += '<div class="impinfo" id="impBusy">Checking ' + esc(st.file) + '…</div>';
    if (st.phase === 'importing') h += '<div class="impinfo" id="impBusy">Adding tasks…</div>';
    if (st.phase === 'ready') {
      var nbad = st.errors.length, nwarn = st.ignored.length;
      h += '<div class="impstats" id="impSum"><div class="impstat"><b>' + st.rows.length + '</b><span>' + (st.rows.length === 1 ? 'task' : 'tasks') + ' found</span></div>' +
        '<div class="impstat"><b>' + st.mapping.length + '</b><span>columns read</span></div>' +
        '<div class="impstat' + (nbad || nwarn ? ' warn' : '') + '"><b>' + (nbad + nwarn) + '</b><span>' + (nbad + nwarn === 1 ? 'problem' : 'problems') + '</span></div></div>';
      h += '<div class="impsrc">' + esc(st.file) + '</div>';
      h += previewHTML();
      if (nbad) {
        shown = st.errors.slice(0, 30);
        h += '<div class="imperr" id="impErrs"><b>' + plural(nbad, 'row') + ' need fixing. Nothing has been added.</b>';
        for (i = 0; i < shown.length; i++) h += '<div>Line ' + shown[i].row + ': ' + esc(shown[i].messages.join('; ')) + '</div>';
        if (nbad > shown.length) h += '<div>…and ' + (nbad - shown.length) + ' more.</div>';
        h += '<div class="impsoft">Fix the file or text, then load it again.</div></div>';
      } else {
        h += '<div class="impgo"><button class="btn primary impgobtn" id="impGo" type="button">Add ' + plural(st.rows.length, 'task') + '</button></div>';
        h += '<div class="impinfo">Importing the same file twice adds every task twice. You can undo an import below.</div>';
      }
    }
    if (st.phase === 'done') h += '<div class="impdone" id="impDone">✓ Added ' + plural(st.added, 'task') + '. Close Settings to see them, or undo below.</div>';
    h += histHTML() + '</div>';
    var keep = document.getElementById('impPaste'); if (keep) pasteText = keep.value;
    body.innerHTML = h;
    var f = document.getElementById('impFile'), t = document.getElementById('impTpl'), g = document.getElementById('impGo');
    if (f) f.onchange = function () { choose(f.files && f.files[0]); };
    if (t) t.onclick = download;
    if (g) g.onclick = run;
  }

  function onClick(e) {
    var el = e.target, id, a;
    while (el && el !== body) { if (el.getAttribute && el.getAttribute('data-imp')) break; el = el.parentNode; }
    if (!el || el === body) return;
    a = el.getAttribute('data-imp'); id = el.getAttribute('data-id');
    var ta = document.getElementById('impPaste'); if (ta) pasteText = ta.value;
    if (a === 'ask') { hist.confirm = id; hist.note = ''; paint(); }
    else if (a === 'no') { hist.confirm = ''; paint(); }
    else if (a === 'yes') undo(id);
    else if (a === 'copy') copyImport(id);
    else if (a === 'dl') downloadImport(id);
    else if (a === 'closecsv') { hist.show = null; paint(); }
    else if (a === 'mfile') { mode = 'file'; paint(); }
    else if (a === 'mpaste') { mode = 'paste'; paint(); }
    else if (a === 'example') { pasteText = TEMPLATE; paint(); }
    else if (a === 'clear') { pasteText = ''; st = fresh(); paint(); }
    else if (a === 'check') start(pasteText, 'Pasted CSV');
  }

  App.addTab('import', 'Import', function (el) {
    if (body !== el) { body = el; body.onclick = onClick; }
    paint();
    if (hist.list === null || !hist.busy) loadHist();
  });
})();
