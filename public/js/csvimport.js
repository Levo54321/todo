(function () {
  'use strict';
  /* Settings > Import: add many tasks at once from a CSV file. Desktop only (PC / Mac); phones and the iPad never show it.
     The page reads the file, the server (api/_bulk.js) is the only place that judges the rows: first a dry run, then the real add. */
  var App = window.App; if (!App) return;
  var esc = App.esc;
  var ua = navigator.userAgent || '';
  var touchy = /iPad|iPhone|iPod|Android|Mobi/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (touchy || !window.FileReader) return;

  var COLS = ['title', 'list', 'category', 'due_date', 'remind_time', 'repeat', 'priority', 'quick', 'must_today', 'notes'];
  var CHUNK = 100, MAXROWS = 1000;
  var TEMPLATE = 'title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes\r\n' +
    'Call the dentist,personal,Health,2026-11-24,09:30,,,,,Ask about the October invoice\r\n' +
    'Send weekly report,work,,2026-11-27,,weekly,2,no,no,\r\n' +
    'Water the plants,personal,Home,,,weekly,,,,\r\n';
  var DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ALIAS = { name: 'title', task: 'title', task_name: 'title', item: 'title', summary: 'title', project: 'category', tag: 'category', label: 'category', list_name: 'list',
    due: 'due_date', date: 'due_date', deadline: 'due_date', due_on: 'due_date', time: 'remind_time', reminder: 'remind_time', remind: 'remind_time', reminder_time: 'remind_time',
    recur: 'repeat', recurrence: 'repeat', repeats: 'repeat', frequency: 'repeat', prio: 'priority', quick_task: 'quick', must: 'must_today', must_do_today: 'must_today',
    note: 'notes', details: 'notes', description: 'notes', comment: 'notes', comments: 'notes' };
  var st = null, body = null, hist = { list: null, unavailable: false, confirm: '', note: '', busy: false };
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
      App.api('POST', '?bulk=1', { rows: parts[at], batch: st.batch, name: st.file }, function (s, d) {
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

  function choose(file) {
    if (!file) return;
    var rd = new FileReader();
    st = fresh(); st.file = file.name; st.batch = uuid();
    rd.onload = function () {
      var b = build(String(rd.result || ''));
      if (b.error) { st.msg = b.error; paint(); return; }
      st.rows = b.rows; st.ignored = b.ignored; st.mapping = b.mapping; check();
    };
    rd.onerror = function () { st.msg = 'Could not read that file.'; paint(); };
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
  var PCOLS = [['row', 'Line'], ['title', 'Title'], ['list', 'List'], ['category', 'Category'], ['due_date', 'Due'], ['remind_time', 'Time'], ['recur', 'Repeat'], ['prio', 'Priority'], ['quick', 'Quick'], ['must', 'Must today'], ['notes', 'Notes']];
  var FIELD_KEY = { title: 'title', list: 'list', category: 'category', due_date: 'due_date', remind_time: 'remind_time', repeat: 'recur', priority: 'prio', quick: 'quick', must_today: 'must', notes: 'notes' };
  function cell(k, v, row) {
    var x;
    if (k === 'row') return String(row);
    if (k === 'due_date') x = fmtDate(v.due_date);
    else if (k === 'prio') x = v.prio ? new Array(v.prio + 1).join('!') + ' (' + v.prio + ')' : '';
    else if (k === 'quick' || k === 'must') x = v[k] ? 'yes' : '';
    else if (k === 'notes') x = v.notes && v.notes.length > 50 ? v.notes.slice(0, 50) + '…' : (v.notes || '');
    else x = v[k] == null ? '' : String(v[k]);
    return x === '' ? '<span class="impnone">–</span>' : esc(x);
  }
  function mappingHTML() {
    var h = '<div class="lbl">How your columns were read</div><div class="impmap" id="impMap">', i, m, found = {}, f, c, ok = [], blank = [], empty = [];
    for (i = 0; i < st.mapping.length; i++) { m = st.mapping[i]; found[m.field] = m; }
    for (i = 0; i < COLS.length; i++) {
      f = COLS[i]; m = found[f];
      if (m) ok.push('<b>' + esc(f) + '</b> ← “' + esc(m.header) + '”' + (m.alias ? ' <span class="impnote">(read as ' + esc(f) + ')</span>' : ''));
      else blank.push(f);
    }
    h += '<div class="impok">✓ ' + ok.join(' &nbsp;·&nbsp; ') + '</div>';
    for (i = 0; i < st.ignored.length; i++) h += '<div class="imperr2">⚠ column “' + esc(st.ignored[i]) + '” is not recognised: <b>its data will NOT be imported</b></div>';
    for (i = 1; i < COLS.length; i++) { // columns that exist but have nothing in them
      f = COLS[i]; if (!found[f] || f === 'list') continue;
      var any = false, k = FIELD_KEY[f], pi;
      for (pi = 0; pi < st.preview.length; pi++) { c = st.preview[pi].value[k]; if (c && c !== 0 && c !== false) { any = true; break; } }
      if (!any) empty.push(f);
    }
    if (empty.length) h += '<div class="impnote2">ℹ found but every cell is empty or “no”: ' + esc(empty.join(', ')) + '</div>';
    if (blank.length) h += '<div class="impnone2">Not in the file (left blank): ' + esc(blank.join(', ')) + '</div>';
    return h + '</div>';
  }
  function previewHTML() {
    var hasErr = st.errors.length > 0, h = mappingHTML(), i, j, p, shown = st.preview.slice(0, 200);
    h += '<div class="lbl">Preview: what will be added</div><div class="impwrap" id="impPreview"><table class="imptbl"><thead><tr>';
    for (j = 0; j < PCOLS.length; j++) h += '<th>' + esc(PCOLS[j][1]) + '</th>';
    if (hasErr) h += '<th>Problem</th>';
    h += '</tr></thead><tbody>';
    for (i = 0; i < shown.length; i++) {
      p = shown[i];
      h += '<tr' + (p.errors.length ? ' class="imprerr"' : '') + '>';
      for (j = 0; j < PCOLS.length; j++) h += '<td>' + cell(PCOLS[j][0], p.value, p.row) + '</td>';
      if (hasErr) h += '<td>' + (p.errors.length ? esc(p.errors.join('; ')) : '<span class="impnone">✓</span>') + '</td>';
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    if (st.preview.length > shown.length) h += '<div class="sethint">Showing the first ' + shown.length + ' of ' + st.preview.length + ' rows.</div>';
    return h;
  }

  function histHTML() {
    var h = '<div class="lbl" style="margin-top:18px">Previous imports</div>', i, x, list = hist.list;
    if (hist.note) h += '<div class="rvsub" id="impHistNote">' + esc(hist.note) + '</div>';
    if (list === null) return h + '<div class="sethint">Loading…</div>';
    if (hist.unavailable) return h + '<div class="sethint">Import history needs the database update (setup21.sql) first.</div>';
    if (!list.length) return h + '<div class="sethint" id="impHistEmpty">No imports yet. Each import you make will be listed here so it can be undone.</div>';
    h += '<div class="imphist" id="impHist">';
    for (i = 0; i < list.length; i++) {
      x = list[i];
      h += '<div class="imphrow' + (x.undone_at ? ' undone' : '') + '" data-id="' + esc(x.id) + '"><div class="imphinfo"><b>' + esc(x.name || 'Import') + '</b><br><span class="impnote">' + esc(fmtWhen(x.created_at)) + ' · ' + plural(x.n, 'task') + ' added' +
        (x.undone_at ? ' · undone (' + plural(x.undone_n || 0, 'task') + ' removed)' : ' · ' + x.alive + ' still in your lists') + '</span></div>';
      if (!x.undone_at) {
        if (hist.confirm === x.id) h += '<div class="imphact"><span class="impnote">Remove ' + plural(x.alive, 'task') + '?</span> <button class="btn danger" data-imp="yes" data-id="' + esc(x.id) + '" type="button">Yes, undo</button> <button class="btn" data-imp="no" type="button">Keep</button></div>';
        else h += '<div class="imphact"><button class="btn" data-imp="ask" data-id="' + esc(x.id) + '" type="button"' + (hist.busy ? ' disabled' : '') + '>Undo</button></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function paint() {
    if (!body) return;
    var h = '<div class="rvsub">Add many tasks at once from a CSV file. Columns: ' + esc(COLS.join(', ')) + '. Only <b>title</b> is required.</div>';
    h += '<div class="impline"><button class="btn" id="impTpl" type="button" style="margin-left:0">Download template</button></div>';
    if (st.phase === 'idle' || st.phase === 'ready' || st.phase === 'done' || st.phase === 'failed') {
      h += '<div class="lbl">Choose a CSV file</div><input type="file" id="impFile" accept=".csv,text/csv">';
    }
    if (st.msg) h += '<div class="imperr" id="impMsg">' + esc(st.msg) + '</div>';
    if (st.phase === 'checking') h += '<div class="rvsub" id="impBusy">Checking ' + esc(st.file) + '…</div>';
    if (st.phase === 'importing') h += '<div class="rvsub" id="impBusy">Adding tasks…</div>';
    if (st.phase === 'ready') {
      h += '<div class="rvsub" id="impSum"><b>' + esc(st.file) + '</b>: ' + plural(st.rows.length, 'task') + ' found.</div>';
      h += previewHTML();
      if (st.errors.length) {
        var i, shown = st.errors.slice(0, 30);
        h += '<div class="imperr" id="impErrs"><b>' + plural(st.errors.length, 'row') + ' need fixing. Nothing has been added.</b>';
        for (i = 0; i < shown.length; i++) h += '<div>Line ' + shown[i].row + ': ' + esc(shown[i].messages.join('; ')) + '</div>';
        if (st.errors.length > shown.length) h += '<div>…and ' + (st.errors.length - shown.length) + ' more.</div>';
        h += '<div class="sethint">Fix the file, then choose it again.</div></div>';
      } else {
        h += '<div class="impline"><button class="btn primary" id="impGo" type="button" style="margin-left:0">Add ' + plural(st.rows.length, 'task') + '</button></div>';
        h += '<div class="sethint">Importing the same file twice adds every task twice. You can undo an import below.</div>';
      }
    }
    if (st.phase === 'done') h += '<div class="rvsub" id="impDone">✓ Added ' + plural(st.added, 'task') + '. Close Settings to see them, or undo below.</div>';
    h += histHTML();
    body.innerHTML = h;
    var f = document.getElementById('impFile'), t = document.getElementById('impTpl'), g = document.getElementById('impGo');
    if (f) f.onchange = function () { choose(f.files && f.files[0]); };
    if (t) t.onclick = download;
    if (g) g.onclick = run;
  }

  function onClick(e) {
    var el = e.target, id;
    while (el && el !== body) { if (el.getAttribute && el.getAttribute('data-imp')) break; el = el.parentNode; }
    if (!el || el === body) return;
    var a = el.getAttribute('data-imp'); id = el.getAttribute('data-id');
    if (a === 'ask') { hist.confirm = id; hist.note = ''; paint(); }
    else if (a === 'no') { hist.confirm = ''; paint(); }
    else if (a === 'yes') undo(id);
  }

  App.addTab('import', 'Import', function (el) {
    if (body !== el) { body = el; body.onclick = onClick; }
    paint();
    if (hist.list === null || !hist.busy) loadHist();
  });
})();
