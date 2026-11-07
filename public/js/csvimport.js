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
    task_id: 'id', uuid: 'id', subtask: 'subtasks', sub_tasks: 'subtasks', sub_task: 'subtasks', steps: 'subtasks', checklist: 'subtasks', items: 'subtasks' };
  var st = null, body = null, mode = canFile ? 'file' : 'paste', pasteText = '', hist = { list: null, unavailable: false, confirm: '', note: '', busy: false, show: null }, exp = { note: '' }, projects = null;
  function fresh() { return { phase: 'idle', file: '', batch: '', rows: [], items: [], ignored: [], mapping: [], msg: '', added: 0, updated: 0, skipped: 0, bad: 0 }; }
  st = fresh();
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
      if (key && (COLS.indexOf(key) >= 0 || key === 'id') && map[key] === undefined) { map[key] = j; used[j] = true; mapping.push({ field: key, header: String(head[j]).replace(/^\s+|\s+$/g, ''), alias: false }); }
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

  /* ---------- text forms of a task (also used to tell what an edit changed) ---------- */
  function escPipe(x) { return String(x).replace(/\|/g, '\\|'); }
  function subLines(subs) { var out = [], k; for (k = 0; k < (subs || []).length; k++) out.push((subs[k].d ? '[x] ' : '') + subs[k].t); return out; }
  function subsStr(subs) { var l = subLines(subs), k; for (k = 0; k < l.length; k++) l[k] = escPipe(l[k]); return l.join('\n'); }
  function colStr(v, col) {
    switch (col) {
      case 'title': return v.title || '';
      case 'list': return v.list || 'personal';
      case 'category': return v.category || '';
      case 'due_date': return v.due_date || '';
      case 'remind_time': return v.remind_time || '';
      case 'repeat': return v.recur || '';
      case 'priority': return String(v.prio || 0);
      case 'quick': return v.quick ? 'yes' : 'no';
      case 'must_today': return v.must ? 'yes' : 'no';
      case 'notes': return v.notes || '';
      default: return subsStr(v.subtasks);
    }
  }

  /* The clean CSV of what was understood (same 11 columns the app reads), kept with the import so it can be downloaded or copied later. */
  function csvCell(x) { x = x == null ? '' : String(x); return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }
  function canonCSV(vals) {
    var out = [COLS.join(',')], i, v, k, row;
    for (i = 0; i < vals.length; i++) {
      v = vals[i];
      row = [v.title, v.list, v.category || '', v.due_date || '', v.remind_time || '', v.recur || '', v.prio ? v.prio : '', v.quick ? 'yes' : '', v.must ? 'yes' : '', v.notes || '', subLines(v.subtasks).map(escPipe).join('|')];
      for (k = 0; k < row.length; k++) row[k] = csvCell(row[k]);
      out.push(row.join(','));
    }
    return out.join('\r\n') + '\r\n';
  }
  /* Export of the open tasks: the 11 columns plus the task's id, so a corrected file can be imported back as updates. */
  function exportCSV(l) {
    var out = [COLS.concat(['id']).join(',')], i, t, k, row;
    for (i = 0; i < l.length; i++) {
      t = l[i]; if (t.done) continue;
      row = [t.title, t.list || 'personal', t.category || '', t.due_date || '', t.remind_time ? String(t.remind_time).slice(0, 5) : '', t.recur || '', String(t.prio || 0), t.quick ? 'yes' : 'no', t.must ? 'yes' : 'no', t.notes || '', subLines(t.items).map(escPipe).join('|'), t.id];
      for (k = 0; k < row.length; k++) row[k] = csvCell(row[k]);
      out.push(row.join(','));
    }
    return { n: out.length - 1, csv: out.join('\r\n') + '\r\n' };
  }

  /* ---------- checking the file, duplicates, projects ---------- */
  function normT(t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').replace(/^ | $/g, ''); }
  /* Settings pauses the app's own refresh, so ask the server for the current list when it matters (a duplicate check or an export). */
  function freshTodos(cb) {
    App.api('GET', '', null, function (s, d) { cb(s === 200 && d && d.todos ? d.todos : ((App.todos && App.todos()) || [])); });
  }
  function openTasks(l) {
    var out = {}, i, k;
    for (i = 0; i < l.length; i++) { if (l[i].done) continue; k = normT(l[i].title); if (k && !out[k]) out[k] = l[i]; }
    return out;
  }
  function knownProject(c) { var i, x = String(c).toLowerCase(); for (i = 0; i < projects.length; i++) if (String(projects[i]).toLowerCase() === x) return projects[i]; return null; }
  function loadProjects(cb) {
    if (projects !== null) { cb(); return; }
    App.getProjects(function (s, d) {
      if (s === 200 && d && d.projects) { projects = []; for (var i = 0; i < d.projects.length; i++) projects.push(d.projects[i].name); }
      cb();
    });
  }
  /* Work out, for one card, whether it matches a task you already have and whether its project is new. */
  function setup(it, known) {
    var v = it.p.value, t = v.title ? known[normT(v.title)] : null, c;
    if (v.id) { it.act = 'update'; it.target = v.id; it.dup = null; }
    else if (t) { if (!it.dup || it.dup.id !== t.id) { it.dup = { id: t.id, due: t.due_date || '', title: t.title }; it.act = 'skip'; } }
    else { it.dup = null; if (it.act === 'skip') it.act = 'add'; }
    it.proj = null; c = v.category;
    if (v.list === 'work' && c && projects && !knownProject(c)) it.proj = { name: c };
    else if (v.list === 'work' && c && projects) { var kp = knownProject(c); if (kp !== c) { it.raw.category = kp; v.category = kp; } }
  }
  function tally() {
    var o = { add: 0, upd: 0, skip: 0, bad: 0, dups: 0, names: [] }, seen = {}, i, it, k;
    for (i = 0; i < st.items.length; i++) {
      it = st.items[i];
      if (it.dup && !it.p.value.id) o.dups++;
      if (it.p.errors.length) { o.bad++; continue; }
      if (it.act === 'skip') { o.skip++; continue; }
      if (it.act === 'update') o.upd++; else o.add++;
      if (it.proj) { k = it.proj.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; o.names.push(it.proj.name); } }
    }
    return o;
  }

  function check() {
    var parts = [], at = 0, prev = [], i;
    for (i = 0; i < st.rows.length; i += CHUNK) parts.push(st.rows.slice(i, i + CHUNK));
    st.phase = 'checking'; st.msg = ''; st.items = []; paint();
    function done() {
      freshTodos(function (list) {
        var k, it; st.known = openTasks(list);
        for (k = 0; k < st.rows.length; k++) { it = { raw: st.rows[k], p: prev[k], act: 'add', target: null, dup: null, proj: null, open: false }; setup(it, st.known); st.items.push(it); }
        st.phase = 'ready'; paint();
      });
    }
    function next() {
      if (at >= parts.length) { projects = null; loadProjects(done); return; }
      App.api('POST', '?bulk=1', { rows: parts[at], dry: true }, function (s, d) {
        if ((s === 200 || s === 400) && d && d.preview) { prev = prev.concat(d.preview); at++; next(); }
        else { st.phase = 'idle'; st.msg = 'Could not check the file (' + (d && d.error ? d.error : 'error ' + s) + '). Nothing was added.'; paint(); }
      });
    }
    next();
  }

  function cloneRaw(o) { var r = {}, k; for (k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }
  function run() {
    var send = [], adds = [], upds = [], addVals = [], names = [], seen = {}, i, it, r, k, parts = [], at = 0, nSkip = 0, nBad = 0, t = tally();
    for (i = 0; i < st.items.length; i++) {
      it = st.items[i];
      if (it.p.errors.length) { nBad++; continue; }
      if (it.act === 'skip') { nSkip++; continue; }
      r = cloneRaw(it.raw);
      if (it.act === 'update') { r.id = it.target || it.dup.id; upds.push(r); } else { delete r.id; adds.push(r); addVals.push(it.p.value); }
      if (it.proj) { k = it.proj.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; names.push(it.proj.name); } }
    }
    send = adds.concat(upds); // new tasks first: the first request carries the CSV copy kept in Previous imports
    if (!send.length) return;
    for (i = 0; i < send.length; i += CHUNK) parts.push(send.slice(i, i + CHUNK));
    st.phase = 'importing'; st.added = 0; st.updated = 0; st.skipped = nSkip; st.bad = nBad; st.msg = ''; paint();
    function finish() { App.mutated(); App.reloadWhenSettingsClose(); loadHist(); }
    function go() {
      if (at >= parts.length) { st.phase = 'done'; finish(); paint(); return; }
      var req = { rows: parts[at], batch: st.batch, name: st.file }; if (at === 0 && addVals.length) req.csv = canonCSV(addVals);
      App.api('POST', '?bulk=1', req, function (s, d) {
        if (s === 201 && d && d.ok) { st.added += d.added || 0; st.updated += d.updated || 0; at++; go(); }
        else {
          st.added += (d && d.added) || 0; st.updated += (d && d.updated) || 0;
          st.phase = 'failed'; st.msg = 'Stopped part-way: ' + st.added + ' added and ' + st.updated + ' updated of ' + send.length + '. Use Undo in "Previous imports" below to remove the added ones (updates are not undone), then fix the file and import again.';
          finish(); paint();
        }
      });
    }
    function makeProjects(n) { // new project names the person chose to create; a failure here never blocks the import
      if (n >= names.length) { go(); return; }
      App.api('POST', '', { name: names[n] }, function () { makeProjects(n + 1); }, '/api/projects');
    }
    makeProjects(0);
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
  function say(where, msg) { if (where === 'exp') exp.note = msg; else hist.note = msg; }
  function showText(d, why, where) { hist.show = { name: d.name, csv: d.csv, why: why, where: where || 'hist' }; paint(); var ta = document.getElementById('impCsvBox'); if (ta) { ta.focus(); ta.select(); } }
  /* d = { name, csv, file? }. where = 'hist' (Previous imports) or 'exp' (Export). */
  function copyData(d, where) {
    var done = function () { say(where, 'Copied “' + (d.name || 'import') + '” (' + d.csv.split('\n').length + ' lines) to the clipboard.'); paint(); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) { navigator.clipboard.writeText(d.csv).then(done, function () { showText(d, 'Select all and copy this text.', where); }); return; }
      var t = document.createElement('textarea'); t.value = d.csv; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t); t.focus(); t.select(); try { t.setSelectionRange(0, d.csv.length); } catch (e1) {}
      var ok = document.execCommand && document.execCommand('copy'); document.body.removeChild(t);
      if (ok) done(); else showText(d, 'Your browser would not copy automatically. Select all and copy this text.', where);
    } catch (e) { showText(d, 'Select all and copy this text.', where); }
  }
  function saveData(d, where) {
    var fn = d.file || fileName(d.name);
    if (oldIOS) { showText(d, 'This browser cannot save files. Select all and copy this text instead.', where); return; }
    try {
      var blob = new Blob([d.csv], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fn;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      say(where, 'Downloaded ' + fn + '.'); paint();
    } catch (e) { showText(d, 'Could not save a file here. Select all and copy this text instead.', where); }
  }
  function copyImport(id) { withCsv(id, function (d) { copyData(d, 'hist'); }); }
  function downloadImport(id) { withCsv(id, function (d) { saveData(d, 'hist'); }); }
  function exportData(list) {
    var x = exportCSV(list), n = new Date(), day = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
    exp.note = ''; hist.show = null;
    return { name: 'your ' + plural(x.n, 'open task'), csv: x.csv, file: 'luc-todo-open-tasks-' + day + '.csv', n: x.n };
  }
  function panelHTML(where) {
    if (!hist.show || hist.show.where !== where) return '';
    return '<div class="impcsvpanel" id="impCsvPanel"><div class="impinfo">' + esc(hist.show.why || '') + '</div><textarea id="impCsvBox" class="impta" rows="8" readonly spellcheck="false">' + esc(hist.show.csv) + '</textarea><div class="improw"><button class="btn" data-imp="closecsv" type="button">Close</button></div></div>';
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
    if (found.id) h += '<span class="impchip ok">✓ <b>id</b> ← “' + esc(found.id.header) + '” <span class="impsoft">(rows with an id update that task)</span></span>';
    h += '</div>';
    for (i = 0; i < st.ignored.length; i++) h += '<div class="impwarn">⚠ Column “' + esc(st.ignored[i]) + '” is not recognised: <b>its data will NOT be imported</b></div>';
    for (i = 1; i < COLS.length; i++) {
      f = COLS[i]; if (!found[f] || f === 'list') continue;
      var any = false, k = FIELD_KEY[f], pi;
      for (pi = 0; pi < st.items.length; pi++) { c = st.items[pi].p.value[k]; if (c && c !== 0 && c !== false && !(c.length === 0)) { any = true; break; } }
      if (!any) empty.push(f);
    }
    if (empty.length) h += '<div class="impinfo">ℹ Found but every cell is empty or “no”: ' + esc(empty.join(', ')) + '</div>';
    if (blank.length) h += '<div class="impinfo">Not in the file (left blank): ' + esc(blank.join(', ')) + '</div>';
    return h + '</div>';
  }
  /* ---------- review cards (tap a card to edit it) ---------- */
  function fld(label, inner, wide) { return '<label class="impfld' + (wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' + inner + '</label>'; }
  function opt(val, label, cur) { return '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function editorHTML(it, i) {
    var v = it.p.value, id = function (n) { return 'impE_' + n + '_' + i; }, h = '<div class="impedit" id="impEdit' + i + '">', rep = ['', 'daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'], j, r = '', pr = '';
    for (j = 0; j < rep.length; j++) r += opt(rep[j], rep[j] || 'does not repeat', v.recur || '');
    for (j = 0; j <= 3; j++) pr += opt(j, j === 0 ? '0 – none' : j === 3 ? '3 – most important' : String(j), v.prio || 0);
    h += fld('Title', '<input type="text" class="impin" id="' + id('title') + '" value="' + esc(v.title) + '">', true);
    h += fld('List', '<select class="impin" id="' + id('list') + '">' + opt('personal', 'Personal', v.list) + opt('work', 'Work', v.list) + '</select>');
    h += fld('Category / project', '<input type="text" class="impin" id="' + id('category') + '" value="' + esc(v.category || '') + '">');
    h += fld('Due date', '<input type="date" class="impin" id="' + id('due_date') + '" value="' + esc(v.due_date || '') + '">');
    h += fld('Reminder time', '<input type="time" class="impin" id="' + id('remind_time') + '" value="' + esc(v.remind_time || '') + '">');
    h += fld('Repeat', '<select class="impin" id="' + id('repeat') + '">' + r + '</select>');
    h += fld('Priority', '<select class="impin" id="' + id('priority') + '">' + pr + '</select>');
    h += '<div class="impfld wide impchecks"><label><input type="checkbox" id="' + id('quick') + '"' + (v.quick ? ' checked' : '') + '> Quick</label><label><input type="checkbox" id="' + id('must_today') + '"' + (v.must ? ' checked' : '') + '> Must do today</label></div>';
    h += fld('Notes', '<textarea class="impin" rows="4" id="' + id('notes') + '">' + esc(v.notes || '') + '</textarea>', true);
    h += fld('Sub-tasks (one per line, start with [x] if done)', '<textarea class="impin" rows="4" id="' + id('subtasks') + '">' + esc(subLines(v.subtasks).join('\n')) + '</textarea>', true);
    return h + '<div class="improw"><button class="btn primary" data-imp="save" data-i="' + i + '" type="button">Save changes</button><button class="btn" data-imp="open" data-i="' + i + '" type="button">Cancel</button></div></div>';
  }
  function cardHTML(it, i) {
    var p = it.p, v = p.value, bad = p.errors.length > 0, skip = !bad && it.act === 'skip', h, c = '', n, k;
    h = '<div class="impcard' + (bad ? ' bad' : '') + (skip ? ' skipped' : '') + (v.list === 'work' ? ' work' : '') + (it.open ? ' open' : '') + '" id="impCard' + i + '">';
    h += '<div class="imptop"><button class="impopen" data-imp="open" data-i="' + i + '" type="button" aria-label="Edit this task"><span class="implnum">Line ' + p.row + '</span><span class="impttl">' + (v.title ? esc(v.title) : '<i>no title</i>') + '</span></button>' +
      '<button class="impx" data-imp="del" data-i="' + i + '" type="button" aria-label="Remove this task from the import">×</button></div>';
    c += chip(v.list === 'work' ? 'w' : '', v.list);
    if (v.category) c += chip('', v.category);
    if (v.due_date) c += chip('d', '📅 ' + fmtDate(v.due_date));
    if (v.remind_time) c += chip('d', '⏰ ' + v.remind_time);
    if (v.recur) c += chip('d', '↻ ' + v.recur);
    if (v.prio) c += chip('p', new Array(v.prio + 1).join('!') + ' (' + v.prio + ')');
    if (v.quick) c += chip('q', 'quick');
    if (v.must) c += chip('m', 'must today');
    if (!bad && it.act === 'update') c += chip('u', 'updates existing task');
    h += '<div class="impchips">' + c + '</div>';
    if (v.notes) h += '<div class="impnotes">' + esc(v.notes.length > 140 ? v.notes.slice(0, 140) + '…' : v.notes).replace(/\n+/g, ' · ') + '</div>';
    if (v.subtasks && v.subtasks.length) {
      n = []; for (k = 0; k < v.subtasks.length && k < 4; k++) n.push((v.subtasks[k].d ? '☑ ' : '☐ ') + v.subtasks[k].t);
      h += '<div class="impsubs"><b>' + plural(v.subtasks.length, 'sub-task') + '</b> · ' + esc(n.join(' · ')) + (v.subtasks.length > 4 ? ' …' : '') + '</div>';
    }
    if (bad) h += '<div class="impbad">' + esc(p.errors.join('; ')) + ' <span class="impsoft">Tap the card to fix it, or remove it. It is skipped until fixed.</span></div>';
    if (it.dup && !v.id && !bad) {
      h += '<div class="impdup"><span>Looks like a task you already have: “' + esc(it.dup.title || v.title) + '”' + (it.dup.due ? ' (due ' + esc(fmtDate(it.dup.due)) + ')' : '') + '</span><div class="seg impseg">' +
        ['skip:Skip', 'update:Update it', 'add:Add as new'].map(function (x) { var a = x.split(':'); return '<button type="button" data-imp="act" data-i="' + i + '" data-v="' + a[0] + '" class="' + (it.act === a[0] ? 'on' : '') + '">' + a[1] + '</button>'; }).join('') + '</div></div>';
    }
    if (it.proj && !bad && it.act !== 'skip') {
      var po = '<option value="">Create new project “' + esc(it.proj.name) + '”</option>', q;
      for (q = 0; q < (projects || []).length; q++) po += '<option value="' + esc(projects[q]) + '">Use “' + esc(projects[q]) + '”</option>';
      h += '<div class="impwarn impproj">⚠ “' + esc(it.proj.name) + '” is not one of your Work projects.<select class="impin" id="impPS' + i + '" data-i="' + i + '" aria-label="Project">' + po + '</select></div>';
    }
    if (it.open) h += editorHTML(it, i);
    return h + '</div>';
  }
  function previewHTML() {
    var h = mappingHTML(), i, shown = Math.min(st.items.length, 200);
    h += '<div class="imph">Review: what will be added</div><div id="impPreview">';
    for (i = 0; i < shown; i++) h += cardHTML(st.items[i], i);
    h += '</div>';
    if (st.items.length > shown) h += '<div class="impinfo">Showing the first ' + shown + ' of ' + st.items.length + ' tasks; the rest are imported as they are.</div>';
    return h;
  }

  function histHTML() {
    var h = '<div class="imph">Previous imports</div>', i, x, list = hist.list;
    if (hist.note) h += '<div class="impinfo" id="impHistNote">' + esc(hist.note) + '</div>';
    h += panelHTML('hist');
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
    h += '<div class="imph impsub">Improve tasks you already have</div><div class="impinfo">Export your open tasks (each has an id). Have them corrected or improved, then import the file back: tasks with an id are <b>updated</b> instead of added again. Updates cannot be undone, so keep the export.</div>' +
      '<div class="improw"><button class="btn" id="impExpCopy" data-imp="expcopy" type="button">Copy my open tasks</button><button class="btn" id="impExpDl" data-imp="expdl" type="button">Download my open tasks</button></div>';
    if (exp.note) h += '<div class="impinfo" id="impExpNote">' + esc(exp.note) + '</div>';
    return h + panelHTML('exp');
  }
  function goLabel(t) {
    var p = [];
    if (t.add) p.push('Add ' + plural(t.add, 'task'));
    if (t.upd) p.push((p.length ? 'update ' : 'Update ') + plural(t.upd, 'task'));
    return p.length ? p.join(' and ') : 'Nothing to import';
  }

  function paint() {
    if (!body) return;
    var h = '<div class="imp"><div class="impintro">Add many tasks at once from a CSV. Columns: <span class="impsoft">' + esc(COLS.join(', ')) + '</span>. Only <b>title</b> is required. Sub-tasks go in one cell separated by <b>|</b>.</div>', i, t;
    if (st.phase === 'idle' || st.phase === 'ready' || st.phase === 'done' || st.phase === 'failed') h += '<div class="impcardbox">' + sourceHTML() + '</div>';
    if (st.msg) h += '<div class="imperr" id="impMsg">' + esc(st.msg) + '</div>';
    if (st.phase === 'checking') h += '<div class="impinfo" id="impBusy">Checking ' + esc(st.file) + '…</div>';
    if (st.phase === 'importing') h += '<div class="impinfo" id="impBusy">Adding tasks…</div>';
    if (st.phase === 'ready') {
      t = tally();
      h += '<div class="impstats" id="impSum"><div class="impstat"><b>' + st.items.length + '</b><span>' + (st.items.length === 1 ? 'task' : 'tasks') + ' found</span></div>' +
        '<div class="impstat"><b>' + st.mapping.length + '</b><span>columns read</span></div>' +
        '<div class="impstat' + (t.bad || st.ignored.length ? ' warn' : '') + '"><b>' + (t.bad + st.ignored.length) + '</b><span>' + (t.bad + st.ignored.length === 1 ? 'problem' : 'problems') + '</span></div>' +
        (t.dups ? '<div class="impstat warn"><b>' + t.dups + '</b><span>already in your list</span></div>' : '') + '</div>';
      h += '<div class="impsrc">' + esc(st.file) + '</div>';
      h += '<div class="impgo top"><button class="btn primary impgobtn" id="impGoTop" data-imp="go" type="button"' + (t.add + t.upd ? '' : ' disabled') + '>' + esc(goLabel(t)) + '</button></div>';
      if (t.dups) h += '<div class="impdupbar"><span><b>' + plural(t.dups, 'task') + '</b> look like tasks you already have (skipped unless you change it):</span><div class="seg impseg"><button type="button" data-imp="dupall" data-v="skip">Skip all</button><button type="button" data-imp="dupall" data-v="update">Update them all</button><button type="button" data-imp="dupall" data-v="add">Add all anyway</button></div></div>';
      if (t.bad) h += '<div class="imperr" id="impErrs"><b>' + plural(t.bad, 'task') + ' with problems will be skipped.</b> Tap a card to fix it, or remove it. The rest import normally.</div>';
      if (t.names.length) h += '<div class="impinfo" id="impNewProj">New Work project' + (t.names.length === 1 ? '' : 's') + ' to be created: <b>' + esc(t.names.join(', ')) + '</b>. Pick an existing one on the card instead if it is a typo.</div>';
      h += previewHTML();
      h += '<div class="impgo"><button class="btn primary impgobtn" id="impGo" data-imp="go" type="button"' + (t.add + t.upd ? '' : ' disabled') + '>' + esc(goLabel(t)) + '</button></div>';
      h += '<div class="impinfo">Importing the same file twice adds every task twice unless you skip or update the matches. Added tasks can be undone below; updates cannot.</div>';
    }
    if (st.phase === 'done') h += '<div class="impdone" id="impDone">✓ Added ' + plural(st.added, 'task') + (st.updated ? ' and updated ' + plural(st.updated, 'task') : '') + '.' + (st.skipped ? ' Skipped ' + st.skipped + ' you already had.' : '') + (st.bad ? ' Left out ' + plural(st.bad, 'task') + ' with problems.' : '') + ' Close Settings to see them' + (st.added ? ', or undo below.' : '.') + '</div>';
    h += histHTML() + '</div>';
    var keep = document.getElementById('impPaste'); if (keep) pasteText = keep.value;
    body.innerHTML = h;
    var f = document.getElementById('impFile'), tp = document.getElementById('impTpl');
    if (f) f.onchange = function () { choose(f.files && f.files[0]); };
    if (tp) tp.onclick = download;
  }

  /* ---------- editing a card ---------- */
  function readDraft(i) {
    var g = function (n) { return document.getElementById('impE_' + n + '_' + i); }, d = {}, lines, k, s;
    d.title = g('title').value.replace(/\s+/g, ' ').replace(/^ | $/g, '');
    d.list = g('list').value; d.category = g('category').value.replace(/\s+/g, ' ').replace(/^ | $/g, '');
    d.due_date = g('due_date').value; d.remind_time = g('remind_time').value; d.repeat = g('repeat').value; d.priority = g('priority').value;
    d.quick = g('quick').checked ? 'yes' : 'no'; d.must_today = g('must_today').checked ? 'yes' : 'no';
    d.notes = g('notes').value.replace(/^\s+|\s+$/g, '');
    lines = g('subtasks').value.split(/\r?\n/); s = [];
    for (k = 0; k < lines.length; k++) { lines[k] = lines[k].replace(/^\s+|\s+$/g, ''); if (lines[k]) s.push(escPipe(lines[k])); }
    d.subtasks = s.join('\n');
    return d;
  }
  function saveEdit(i) {
    var it = st.items[i], v = it.p.value, d = readDraft(i), c, changed = false;
    for (c in d) if (d.hasOwnProperty(c) && d[c] !== colStr(v, c)) { it.raw[c] = d[c]; changed = true; }
    it.open = false;
    if (!changed) { paint(); return; }
    App.api('POST', '?bulk=1', { rows: [it.raw], dry: true }, function (s, r) {
      if ((s === 200 || s === 400) && r && r.preview && r.preview[0]) { it.p = r.preview[0]; setup(it, st.known || {}); }
      else st.msg = 'Could not re-check that task (' + (r && r.error ? r.error : 'error ' + s) + '). Its old values are still shown.';
      paint();
    });
  }

  function onClick(e) {
    var el = e.target, id, a, i, v, j;
    while (el && el !== body) { if (el.getAttribute && el.getAttribute('data-imp')) break; el = el.parentNode; }
    if (!el || el === body) return;
    a = el.getAttribute('data-imp'); id = el.getAttribute('data-id'); i = +el.getAttribute('data-i'); v = el.getAttribute('data-v');
    var ta = document.getElementById('impPaste'); if (ta) pasteText = ta.value;
    if (a === 'ask') { hist.confirm = id; hist.note = ''; paint(); }
    else if (a === 'no') { hist.confirm = ''; paint(); }
    else if (a === 'yes') undo(id);
    else if (a === 'copy') copyImport(id);
    else if (a === 'dl') downloadImport(id);
    else if (a === 'expcopy') freshTodos(function (l) { copyData(exportData(l), 'exp'); });
    else if (a === 'expdl') freshTodos(function (l) { saveData(exportData(l), 'exp'); });
    else if (a === 'closecsv') { hist.show = null; paint(); }
    else if (a === 'mfile') { mode = 'file'; paint(); }
    else if (a === 'mpaste') { mode = 'paste'; paint(); }
    else if (a === 'example') { pasteText = TEMPLATE; paint(); }
    else if (a === 'clear') { pasteText = ''; st = fresh(); paint(); }
    else if (a === 'check') start(pasteText, 'Pasted CSV');
    else if (a === 'go') run();
    else if (a === 'open' && st.items[i]) { st.items[i].open = !st.items[i].open; paint(); var ed = document.getElementById('impCard' + i); if (ed && ed.scrollIntoView && st.items[i].open) ed.scrollIntoView(); }
    else if (a === 'save' && st.items[i]) saveEdit(i);
    else if (a === 'del' && st.items[i]) { st.items.splice(i, 1); if (!st.items.length) { st = fresh(); st.msg = 'Every task was removed from this import.'; } paint(); }
    else if (a === 'act' && st.items[i]) { st.items[i].act = v; paint(); }
    else if (a === 'dupall') { for (j = 0; j < st.items.length; j++) if (st.items[j].dup && !st.items[j].p.value.id) st.items[j].act = v; paint(); }
  }
  function onChange(e) { // choosing an existing project on a card whose project is new
    var el = e.target, i, it, pick;
    if (!el || !el.id || el.id.indexOf('impPS') !== 0) return;
    i = +el.getAttribute('data-i'); it = st.items[i]; if (!it) return;
    pick = el.value; if (!pick) return;
    it.raw.category = pick; it.p.value.category = pick; it.proj = null; paint();
  }

  App.addTab('import', 'Import', function (el) {
    if (body !== el) { body = el; body.onclick = onClick; body.onchange = onChange; }
    paint();
    if (hist.list === null || !hist.busy) loadHist();
  });
})();
