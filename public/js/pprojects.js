/* My projects: Personal Projects (apps, home projects ...). Separate from Work projects (projects.js / board.js).
   A Personal task joins a project through todos.pproject_id (set in the task editor or added from a project page).
   Statuses: Active, Paused, Not pursued, Shut down. Tasks in a project that is not Active are "shelved" by core.js:
   out of Overdue and the counts, listed under "On-hold projects" on the Personal list. ES5 only (iPad 2, iOS 9). */
(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var STAT = ['active', 'paused', 'not_pursued', 'shut_down'];
  var LABEL = { active: 'Active', paused: 'Paused', not_pursued: 'Not pursued', shut_down: 'Shut down' };
  var list = [], known = false, failed = false, tries = 0, busy = false;
  var sel = store.get('ppSel') || '', editId = '', showClosed = false, showDone = false, onView = false;

  /* styles (tokens from app.css; flexbox only, no grid/sticky) */
  var css = '.ppadd{display:-webkit-flex;display:flex;margin:12px 0 4px}.ppadd .setinput{-webkit-flex:1;flex:1;min-width:0;margin-right:8px}' +
    '.ppadd .btn{white-space:nowrap;min-height:44px}' +
    '.ppst{margin:2px 0 6px}.ppst .chip{min-height:36px;margin:0 6px 6px 0}' +
    '.ppbar{height:8px;border-radius:4px;background:var(--rule);overflow:hidden;margin:6px 0 2px}' +
    '.ppbar i{display:block;height:100%;background:var(--accent);border-radius:4px}' +
    '.ppmeta{font-size:13px;color:var(--muted);margin-bottom:6px}' +
    '.ppback{border:0;background:none;color:var(--accent);font-size:15px;padding:12px 0;min-height:44px;-webkit-appearance:none}' +
    '.prow2.ppoff .pname{color:var(--muted)}.ppbadge{font-size:12px;color:var(--muted);margin-left:6px;white-space:nowrap}' +
    '.pjc{border-style:dashed}';
  var st = document.createElement('style'); st.type = 'text/css';
  if (st.styleSheet) st.styleSheet.cssText = css; else st.appendChild(document.createTextNode(css));
  document.getElementsByTagName('head')[0].appendChild(st);

  /* ---------- data ---------- */
  function load(cb) {
    if (!App.token()) { if (tries++ < 8) setTimeout(function () { load(cb); }, 1500); return; }
    App.api('GET', '', null, function (s, d) {
      if (s === 200 && d && d.projects) { list = d.projects; known = true; failed = false; App.setPProjects(list); }
      else if (!known) failed = true;
      if (cb) cb();
    }, '/api/pprojects');
  }
  setTimeout(function () { load(function () { if (onView) paint(); }); }, 700);
  document.addEventListener('visibilitychange', function () { if (!App.hidden()) load(function () { if (onView) paint(); }); }, false);

  function byId(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function tasksOf(id) { // this project's Personal tasks the app has loaded (open ones, plus those finished in the last 7 days)
    var all = App.todos(), out = { open: [], done: [] }, i, t;
    for (i = 0; i < all.length; i++) {
      t = all[i];
      if (t.pproject_id !== id || (t.list || 'personal') !== 'personal') continue;
      if (t.done) out.done.push(t); else out.open.push(t);
    }
    out.open.sort(function (a, b) {
      if ((a.due_date || '') !== (b.due_date || '')) { if (!a.due_date) return 1; if (!b.due_date) return -1; return a.due_date < b.due_date ? -1 : 1; }
      return App.parseTS(a.created_at) - App.parseTS(b.created_at);
    });
    out.done.sort(function (a, b) { return App.parseTS(b.done_at) - App.parseTS(a.done_at); });
    return out;
  }
  function progress(p) { // done = finished more than a week ago (from the server) + finished recently (live)
    var t = tasksOf(p.id), done = (p.done_old || 0) + t.done.length, open = t.open.length, all = done + open;
    return { done: done, open: open, all: all, pct: all ? Math.round(done * 100 / all) : 0 };
  }
  function setStore(k, v) { if (v) store.set(k, v); else store.del(k); }

  /* ---------- painting ---------- */
  function barHTML(pg) { return '<div class="ppbar" role="img" aria-label="' + pg.pct + ' percent done"><i style="width:' + pg.pct + '%"></i></div>'; }
  function progText(pg) { return pg.all ? pg.done + ' of ' + pg.all + ' done · ' + pg.open + ' open' : 'No tasks yet'; }
  function statusChips(p) {
    var h = '<div class="ppst">', i;
    for (i = 0; i < STAT.length; i++) h += '<button class="chip' + (p.status === STAT[i] ? ' on' : '') + '" data-pp="stat" data-id="' + esc(p.id) + '" data-val="' + STAT[i] + '">' + LABEL[STAT[i]] + '</button>';
    return h + '</div>';
  }
  function editRow(p) {
    return '<li class="prow editing"><input class="setinput" id="ppEdit" type="text" maxlength="60" autocomplete="off" autocorrect="off" value="' + esc(p.name) + '">' +
      '<button class="btn sm primary" data-pp="save" data-id="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + '>Save</button><button class="btn sm" data-pp="cancel">Cancel</button></li>';
  }
  function rowHTML(p) {
    if (editId === p.id) return editRow(p);
    var pg = progress(p);
    return '<li class="prow2' + (p.status !== 'active' ? ' ppoff' : '') + '"><div class="prow top">' +
      '<button class="pname" data-pp="open" data-id="' + esc(p.id) + '">' + esc(p.name) + (p.status !== 'active' ? '<span class="ppbadge">' + LABEL[p.status] + '</span>' : '') + '</button>' +
      '<span class="pcount">' + (pg.all ? pg.done + '/' + pg.all + ' done' : 'no tasks') + '</span>' +
      '<button class="pbtn" data-pp="edit" data-id="' + esc(p.id) + '" aria-label="Rename project">✎</button></div>' +
      (pg.all ? barHTML(pg) : '') + statusChips(p) + '</li>';
  }
  function listPage() {
    var h = '<div class="rvsub">Personal projects, separate from Work. Tap a project to see its tasks. ' +
      'Tasks in a paused, not pursued or shut down project stay out of Overdue and your counts.</div>';
    h += '<form class="ppadd" id="ppNewForm" autocomplete="off"><input class="setinput" id="ppNew" type="text" maxlength="60" placeholder="New project, e.g. Holmlodge Hub" autocorrect="off">' +
      '<button class="btn primary" type="submit"' + (busy ? ' disabled' : '') + '>Add</button></form>';
    if (!known) return h + '<div class="sethint">' + (failed ? 'Could not load your projects. Check your connection.' : 'Loading…') + '</div>';
    var act = [], off = [], i;
    for (i = 0; i < list.length; i++) (list[i].status === 'active' ? act : off).push(list[i]);
    if (!list.length) h += '<p class="empty">No projects yet. Add your first one above.</p>';
    else if (!act.length) h += '<p class="empty">No active projects.</p>';
    if (act.length) { h += '<ul class="plist">'; for (i = 0; i < act.length; i++) h += rowHTML(act[i]); h += '</ul>'; }
    if (off.length) {
      h += '<button class="donebtn" data-pp="closed">' + (showClosed ? '▾' : '▸') + ' Paused, not pursued or shut down (' + off.length + ')</button>';
      if (showClosed) { h += '<ul class="plist">'; for (i = 0; i < off.length; i++) h += rowHTML(off[i]); h += '</ul>'; }
    }
    return h;
  }
  function detailPage(p) {
    var t = tasksOf(p.id), pg = progress(p), h = '<button class="ppback" data-pp="back">‹ All projects</button>';
    if (editId === p.id) h += '<ul class="plist">' + editRow(p) + '</ul>';
    else h += '<div class="prow top"><div class="pname" style="cursor:default">' + esc(p.name) + '</div>' +
      '<button class="pbtn" data-pp="edit" data-id="' + esc(p.id) + '" aria-label="Rename project">✎</button></div>';
    h += statusChips(p);
    h += barHTML(pg) + '<div class="ppmeta">' + progText(pg) + (pg.all ? ' · ' + pg.pct + '%' : '') + '</div>';
    if (p.status !== 'active') h += '<div class="sethint">This project is ' + LABEL[p.status].toLowerCase() + ', so its tasks are out of Overdue and your counts.</div>';
    h += '<form class="ppadd" id="ppTaskForm" autocomplete="off"><input class="setinput" id="ppTask" type="text" maxlength="500" placeholder="Add a task to ' + esc(p.name) + '…" autocorrect="off" autocapitalize="sentences">' +
      '<button class="btn primary" type="submit">Add</button></form>';
    h += '<h2>Open<span class="count">' + t.open.length + '</span></h2>';
    h += t.open.length ? App.listHTML(t.open) : '<p class="empty">No open tasks. Add one above, or pick this project in a Personal task’s editor.</p>';
    if (t.done.length) {
      h += '<button class="donebtn" data-pp="done">' + (showDone ? '▾' : '▸') + ' Done this week (' + t.done.length + ')</button>';
      if (showDone) h += App.listHTML(t.done);
    }
    if (p.done_old) h += '<div class="sethint">Plus ' + p.done_old + ' finished earlier.</div>';
    return h;
  }
  function paint() {
    if (!onView) return;
    var p = sel ? byId(sel) : null;
    if (sel && known && !p) { sel = ''; setStore('ppSel', ''); }
    App.setHTML($('viewTitle'), p ? 'My projects<small>' + esc(p.name) + '</small>' : 'My projects');
    var keepNew = $('ppNew') ? $('ppNew').value : '', keepTask = $('ppTask') ? $('ppTask').value : '', keepEdit = $('ppEdit') ? $('ppEdit').value : null;
    var ae = document.activeElement, focusId = ae && ae.id ? ae.id : '';
    App.setHTML($('ppPane'), p ? detailPage(p) : listPage());
    if ($('ppNew')) $('ppNew').value = keepNew;
    if ($('ppTask')) $('ppTask').value = keepTask;
    if ($('ppEdit') && keepEdit !== null) $('ppEdit').value = keepEdit;
    if (focusId && $(focusId) && (focusId === 'ppNew' || focusId === 'ppTask' || focusId === 'ppEdit')) $(focusId).focus();
  }

  /* ---------- actions ---------- */
  function errText(s, d) { return s === 409 && d && d.error ? d.error.charAt(0).toUpperCase() + d.error.slice(1) : 'Could not save, try again'; }
  function create(name) {
    name = (name || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!name) { App.toast('Give the project a name'); return; }
    if (busy) return; busy = true; paint();
    App.api('POST', '', { name: name }, function (s, d) {
      busy = false;
      if ((s === 201 || s === 200) && d && d.project) {
        d.project.open = 0; d.project.done = 0; d.project.done_old = 0;
        list.push(d.project); App.setPProjects(list);
        if ($('ppNew')) $('ppNew').value = '';
      } else App.toast(errText(s, d));
      paint();
    }, '/api/pprojects');
  }
  function patch(id, body, undo) {
    App.api('PATCH', '?id=' + encodeURIComponent(id), body, function (s, d) {
      var p = byId(id);
      if (s === 200 && d && d.project) { if (p) { p.name = d.project.name; p.status = d.project.status; } }
      else { if (p && undo) undo(p); App.toast(errText(s, d)); }
      App.setPProjects(list); paint();
    }, '/api/pprojects');
  }
  function setStatus(id, v) {
    var p = byId(id); if (!p || p.status === v || STAT.indexOf(v) < 0) return;
    var was = p.status; p.status = v; App.setPProjects(list); paint();
    patch(id, { status: v }, function (q) { q.status = was; });
  }
  function rename(id) {
    var p = byId(id), el = $('ppEdit'); if (!p || !el) return;
    var v = el.value.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!v) { App.toast('Give the project a name'); return; }
    editId = '';
    if (v === p.name) { paint(); return; }
    var was = p.name; p.name = v; App.setPProjects(list); paint();
    patch(id, { name: v }, function (q) { q.name = was; });
  }
  function addTask(title) {
    var p = byId(sel); title = (title || '').replace(/^\s+|\s+$/g, '');
    if (!p || !title) return;
    if ($('ppTask')) $('ppTask').value = '';
    App.api('POST', '', { title: title, list: 'personal', pproject_id: p.id }, function (s, d) {
      if ((s === 201 || s === 200) && d && d.todo) {
        App.todos().push(d.todo); App.mutated(); App.render();
        if (d.todo.pproject_id !== p.id) App.toast('Added, but not linked to the project. Try again from the task editor.');
      } else { App.toast('Could not add, try again'); if ($('ppTask') && !$('ppTask').value) $('ppTask').value = title; }
    }, '/api/todos');
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-pp'))) el = el.parentNode;
    if (!el || el === document) return;
    var a = el.getAttribute('data-pp'), id = el.getAttribute('data-id');
    e.preventDefault();
    if (a === 'open') { sel = id; editId = ''; showDone = false; setStore('ppSel', id); paint(); window.scrollTo(0, 0); }
    else if (a === 'back') { sel = ''; editId = ''; setStore('ppSel', ''); paint(); window.scrollTo(0, 0); }
    else if (a === 'stat') setStatus(id, el.getAttribute('data-val'));
    else if (a === 'edit') { editId = id; paint(); if ($('ppEdit')) $('ppEdit').focus(); }
    else if (a === 'cancel') { editId = ''; paint(); }
    else if (a === 'save') rename(id);
    else if (a === 'closed') { showClosed = !showClosed; paint(); }
    else if (a === 'done') { showDone = !showDone; paint(); }
  }, false);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f) return;
    if (f.id === 'ppNewForm') { e.preventDefault(); create($('ppNew').value); }
    else if (f.id === 'ppTaskForm') { e.preventDefault(); addTask($('ppTask').value); }
  }, false);
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.id === 'ppEdit' && (e.keyCode === 13 || e.keyCode === 27)) { e.preventDefault(); if (e.keyCode === 13) rename(editId); else { editId = ''; paint(); } }
  }, false);

  App.register('pprojects', {
    title: 'My projects',
    render: function () { onView = true; paint(); },
    show: function () { onView = true; paint(); load(paint); }
  });
  // core only calls render() for the visible view; note when we leave it so background loads don't repaint
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
    if (el && el !== document && el.getAttribute('data-act') === 'nav' && el.getAttribute('data-view') !== 'pprojects') onView = false;
  }, true);
})();
