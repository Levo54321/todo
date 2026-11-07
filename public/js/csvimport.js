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
  var st = { phase: 'idle', file: '', rows: [], ignored: [], errors: [], msg: '', added: 0, done: 0 }, body = null;

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
    var p = parseCSV(text), head, map = {}, ignored = [], rows = [], i, j, r, o, key;
    if (p.error) return { error: p.error };
    if (!p.recs.length) return { error: 'The file is empty.' };
    head = p.recs[0].cells;
    for (j = 0; j < head.length; j++) {
      key = norm(head[j]);
      if (!key) continue;
      if (COLS.indexOf(key) >= 0 && map[key] === undefined) map[key] = j; else ignored.push(String(head[j]).replace(/^\s+|\s+$/g, ''));
    }
    if (map.title === undefined) return { error: 'There is no "title" column in the first row. Download the template to see the layout.' };
    for (i = 1; i < p.recs.length; i++) {
      r = p.recs[i]; o = { row: r.line };
      for (key in map) if (map.hasOwnProperty(key)) o[key] = r.cells[map[key]] === undefined ? '' : r.cells[map[key]];
      rows.push(o);
    }
    if (!rows.length) return { error: 'The file has a header row but no tasks under it.' };
    if (rows.length > MAXROWS) return { error: 'The file has ' + rows.length + ' tasks; the limit is ' + MAXROWS + ' per file. Split it and import the parts one at a time.' };
    return { rows: rows, ignored: ignored };
  }

  function chunks() { var out = [], i; for (i = 0; i < st.rows.length; i += CHUNK) out.push(st.rows.slice(i, i + CHUNK)); return out; }

  function check() {
    var parts = chunks(), at = 0;
    st.phase = 'checking'; st.errors = []; st.msg = ''; paint();
    function next() {
      if (at >= parts.length) { st.phase = 'ready'; paint(); return; }
      App.api('POST', '?bulk=1', { rows: parts[at], dry: true }, function (s, d) {
        if (s === 200 || (s === 400 && d && d.errors)) {
          if (d && d.errors) st.errors = st.errors.concat(d.errors);
          at++; next();
        } else { st.phase = 'idle'; st.msg = 'Could not check the file (' + (d && d.error ? d.error : 'error ' + s) + '). Nothing was added.'; paint(); }
      });
    }
    next();
  }

  function run() {
    var parts = chunks(), at = 0;
    st.phase = 'importing'; st.added = 0; st.msg = ''; paint();
    function finish() { App.mutated(); App.reloadWhenSettingsClose(); }
    function next() {
      if (at >= parts.length) { st.phase = 'done'; finish(); paint(); return; }
      App.api('POST', '?bulk=1', { rows: parts[at] }, function (s, d) {
        if (s === 201 && d && d.ok) { st.added += d.added; at++; next(); }
        else {
          st.added += (d && d.added) || 0;
          st.phase = 'failed'; st.msg = 'Stopped part-way: ' + st.added + ' of ' + st.rows.length + ' tasks were added. Do not import the whole file again or those will be added twice. Remove the added rows from the CSV and import the rest.';
          finish(); paint();
        }
      });
    }
    next();
  }

  function choose(file) {
    if (!file) return;
    var rd = new FileReader();
    st = { phase: 'idle', file: file.name, rows: [], ignored: [], errors: [], msg: '', added: 0 };
    rd.onload = function () {
      var b = build(String(rd.result || ''));
      if (b.error) { st.msg = b.error; paint(); return; }
      st.rows = b.rows; st.ignored = b.ignored; check();
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
    if (st.phase === 'ready' || st.phase === 'done') {
      h += '<div class="rvsub" id="impSum"><b>' + esc(st.file) + '</b>: ' + st.rows.length + ' task' + (st.rows.length === 1 ? '' : 's') + ' found.</div>';
      if (st.ignored.length) h += '<div class="sethint">Ignored columns (not part of the import): ' + esc(st.ignored.join(', ')) + '</div>';
    }
    if (st.phase === 'ready' && st.errors.length) {
      var i, shown = st.errors.slice(0, 30);
      h += '<div class="imperr" id="impErrs"><b>' + st.errors.length + ' row' + (st.errors.length === 1 ? '' : 's') + ' need fixing. Nothing has been added.</b>';
      for (i = 0; i < shown.length; i++) h += '<div>Line ' + shown[i].row + ': ' + esc(shown[i].messages.join('; ')) + '</div>';
      if (st.errors.length > shown.length) h += '<div>…and ' + (st.errors.length - shown.length) + ' more.</div>';
      h += '<div class="sethint">Fix the file, then choose it again.</div></div>';
    } else if (st.phase === 'ready') {
      h += '<div class="impline"><button class="btn primary" id="impGo" type="button" style="margin-left:0">Add ' + st.rows.length + ' task' + (st.rows.length === 1 ? '' : 's') + '</button></div>';
      h += '<div class="sethint">Importing the same file twice adds every task twice.</div>';
    }
    if (st.phase === 'done') h += '<div class="rvsub" id="impDone">✓ Added ' + st.added + ' task' + (st.added === 1 ? '' : 's') + '. Close Settings to see them.</div>';
    body.innerHTML = h;
    var f = document.getElementById('impFile'), t = document.getElementById('impTpl'), g = document.getElementById('impGo');
    if (f) f.onchange = function () { choose(f.files && f.files[0]); };
    if (t) t.onclick = download;
    if (g) g.onclick = run;
  }

  App.addTab('import', 'Import', function (el) { body = el; paint(); });
})();
