(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc;
  var list = [], known = false, editId = '', msg = '', busy = false, tries = 0, sheet = null, shownCur = '', lastPick = '', showArch = false;
  var PRIO = ['None', 'Low', 'Medium', 'High'];

  function load(cb) {
    if (!App.token()) { if (tries++ < 8) setTimeout(function () { load(cb); }, 1500); return; }
    App.api('GET', '', null, function (s, d) { if (s === 200 && d && d.projects) { list = d.projects; known = true; refreshPicker(); sync(); if (cb) cb(); } }, '/api/projects');
  }
  setTimeout(function () { load(function () { if (sheetOpen()) paint(); }); }, 900);
  document.addEventListener('visibilitychange', function () { if (!App.hidden()) load(function () { if (sheetOpen()) paint(); }); }, false);

  /* ---------- helpers ---------- */
  function workTasks() {
    var all = App.todos(), out = [], i;
    for (i = 0; i < all.length; i++) if ((all[i].list || 'personal') === 'work') out.push(all[i]);
    return out;
  }
  function openCount(name) {
    var w = workTasks(), n = 0, i;
    for (i = 0; i < w.length; i++) if (!w[i].done && w[i].category === name) n++;
    return n;
  }
  function isDone(p) { return p.status === 'done'; }
  function byId(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  // Board order: active before on hold, then High to Low priority, then the order they were added.
  function ranked() {
    var out = [], i;
    for (i = 0; i < list.length; i++) if (!isDone(list[i])) out.push({ p: list[i], i: i });
    out.sort(function (a, b) {
      var x = a.p.status === 'hold' ? 1 : 0, y = b.p.status === 'hold' ? 1 : 0;
      if (x !== y) return x - y;
      if ((a.p.prio || 0) !== (b.p.prio || 0)) return (b.p.prio || 0) - (a.p.prio || 0);
      return a.i - b.i;
    });
    return out.map(function (o) { return o.p; });
  }
  function archived() {
    var out = [], i;
    for (i = 0; i < list.length; i++) if (isDone(list[i])) out.push(list[i]);
    out.sort(function (a, b) { return (b.done_at || '') < (a.done_at || '') ? -1 : 1; });
    return out;
  }
  function byName(name) { for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i]; return null; }
  function isProject(name) {
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return true;
    return false;
  }
  function legacy() {
    var w = workTasks(), seen = {}, out = [], i, c;
    for (i = 0; i < w.length; i++) {
      c = w[i].category;
      if (c && !w[i].done && !seen[c] && !isProject(c)) { seen[c] = 1; out.push(c); }
    }
    return out;
  }
  function sync() { if (known && App.boardSet) App.boardSet(list); } // keep the Projects board and Work list in step
  function sheetOpen() { return sheet && sheet.style.display === 'flex'; }

  /* ---------- the Active projects panel ---------- */
  function ensureSheet() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.className = 'sheet'; sheet.id = 'projSheet';
    sheet.innerHTML = '<div class="card" id="projCard"></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); }, false);
    sheet.addEventListener('submit', function (e) { e.preventDefault(); add($('pjNew').value); }, false);
  }
  function seg(kind, id, labels, cur) {
    var h = '<span class="sg sm">', i;
    for (i = 0; i < labels.length; i++) h += '<button class="' + (i === cur ? 'on' : '') + '" data-pj="' + kind + '" data-id="' + esc(id) + '" data-val="' + i + '">' + labels[i] + '</button>';
    return h + '</span>';
  }
  function paint() {
    var h = '<div class="big">Projects</div>' +
      '<div class="rvsub">Priority sets the order on the Projects board. Complete a project to archive it. Tap a name to see only its tasks.</div>', i, p, n, keep = '';
    if ($('pjNew')) keep = $('pjNew').value;
    if (!known) h += '<div class="sethint">Loading…</div>';
    else {
      var act = ranked(), arch = archived();
      if (!act.length) h += '<div class="empty">' + (arch.length ? 'No active projects. Add one below or reopen a completed one.' : 'No projects yet. Add your first one below.') + '</div>';
      else {
        h += '<ul class="plist">';
        for (i = 0; i < act.length; i++) {
          p = act[i];
          if (editId === p.id) {
            h += '<li class="prow editing"><input class="setinput" id="pjEdit" type="text" maxlength="40" autocomplete="off" autocorrect="off" value="' + esc(p.name) + '">' +
              '<button class="btn sm primary" data-pj="save" data-id="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + '>Save</button><button class="btn sm" data-pj="cancel">Cancel</button></li>';
          } else {
            n = openCount(p.name);
            h += '<li class="prow2' + (p.status === 'hold' ? ' hold' : '') + '"><div class="prow top"><button class="pname" data-pj="filter" data-name="' + esc(p.name) + '">' + esc(p.name) + '</button>' +
              '<span class="pcount">' + n + ' open</span>' +
              '<button class="pbtn" data-pj="edit" data-id="' + esc(p.id) + '" aria-label="Rename project">✎</button>' +
              '<button class="pbtn del" data-pj="del" data-id="' + esc(p.id) + '" aria-label="Remove project">×</button></div>' +
              '<div class="pctl"><div class="pl"><span class="inl">Priority</span>' + seg('prio', p.id, PRIO, p.prio || 0) + '</div>' +
              '<div class="pl"><span class="inl">Status</span>' + seg('stat', p.id, ['Active', 'On hold'], p.status === 'hold' ? 1 : 0) +
              '<button class="chip pdone" data-pj="done" data-id="' + esc(p.id) + '">✓ Complete</button></div></div></li>';
          }
        }
        h += '</ul>';
      }
      if (arch.length) {
        h += '<button class="donebtn" data-pj="arch">' + (showArch ? '▾' : '▸') + ' Completed (' + arch.length + ')</button>';
        if (showArch) {
          h += '<ul class="plist">';
          for (i = 0; i < arch.length; i++) {
            p = arch[i]; n = openCount(p.name);
            h += '<li class="prow2 arch"><div class="prow top"><span class="pname">' + esc(p.name) + '</span>' +
              '<button class="pbtn del" data-pj="del" data-id="' + esc(p.id) + '" aria-label="Delete project">×</button></div>' +
              '<div class="pctl"><span class="pcount">Completed ' + (p.done_at ? App.fmtDate(p.done_at.slice(0, 10)) : '') + (n ? ' · ' + n + ' still open' : '') + '</span>' +
              '<button class="chip pdone" data-pj="reopen" data-id="' + esc(p.id) + '">Reopen</button></div></li>';
          }
          h += '</ul><div class="sethint">Finished projects stay here for reference. Their tasks keep the project name, so Insights and your history still show them.</div>';
        }
      }
    }
    h += '<form class="addform" id="pjForm" autocomplete="off"><input id="pjNew" type="text" placeholder="New project…" maxlength="40" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false"><button type="submit"' + (busy ? ' disabled' : '') + '>Add</button></form>';
    if (msg) h += '<div class="sethint" style="color:var(--alert)">' + esc(msg) + '</div>';
    var lg = known ? legacy() : [];
    if (lg.length) {
      h += '<div class="lbl">Old categories on your Work tasks</div><div class="sethint" style="margin:-4px 0 8px">Tap one to turn it into a project.</div>';
      for (i = 0; i < lg.length; i++) h += '<button class="chip" data-pj="promote" data-name="' + esc(lg[i]) + '">+ ' + esc(lg[i]) + '</button>';
    }
    h += '<div class="row"><span class="sp"></span><button class="btn primary" data-pj="close">Done</button></div>';
    $('projCard').innerHTML = h;
    if ($('pjNew') && keep) $('pjNew').value = keep;
    if (editId && $('pjEdit')) { try { $('pjEdit').focus(); } catch (e) {} }
  }
  function open() {
    ensureSheet(); editId = ''; msg = ''; showArch = false;
    paint(); sheet.style.display = 'flex';
    load(function () { paint(); });
  }
  function close() { if (sheet) sheet.style.display = 'none'; editId = ''; msg = ''; }

  function fail(s, d, dflt) { msg = (d && d.error) || dflt; busy = false; paint(); }
  function add(name) {
    name = (name || '').replace(/^\s+|\s+$/g, '');
    if (!name || busy) { if (!name) { msg = 'Give the project a name'; paint(); } return; }
    busy = true; msg = ''; paint();
    App.api('POST', '', { name: name }, function (s, d) {
      if (s === 201 && d) { list = d.projects; busy = false; if ($('pjNew')) $('pjNew').value = ''; sync(); paint(); }
      else fail(s, d, 'Could not add, try again');
    }, '/api/projects');
  }
  function rename(id, name) {
    name = (name || '').replace(/^\s+|\s+$/g, '');
    if (!name) { msg = 'Give the project a name'; paint(); return; }
    busy = true; msg = ''; paint();
    App.api('PATCH', '?id=' + encodeURIComponent(id), { name: name }, function (s, d) {
      if (s === 200 && d) { list = d.projects; editId = ''; busy = false; sync(); App.reload(); paint(); App.toast('Renamed'); }
      else fail(s, d, 'Could not rename, try again');
    }, '/api/projects');
  }
  function remove(id) {
    var p = null, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) p = list[i];
    if (!p) return;
    var n = openCount(p.name);
    App.ask({
      title: 'Remove ' + p.name + '?',
      text: n ? n + (n === 1 ? ' open task keeps' : ' open tasks keep') + ' going but loses this project. Nothing is deleted.' : 'No open tasks use it. Nothing is deleted.',
      buttons: [{ label: 'Remove', alert: true }, { label: 'Cancel', primary: true }]
    }, function (b) {
      if (b !== 0) return;
      App.api('DELETE', '?id=' + encodeURIComponent(id), null, function (s, d) {
        if (s === 200 && d) { list = d.projects; sync(); paint(); App.reload(); App.toast('Project removed'); }
        else { msg = (d && d.error) || 'Could not remove, try again'; paint(); }
      }, '/api/projects');
    });
  }
  function patch(id, body, apply, okMsg) { // update locally first, roll back if the save fails
    var p = byId(id), before, k;
    if (!p) return;
    before = JSON.stringify(p);
    apply(p); msg = ''; sync(); paint(); App.render();
    App.api('PATCH', '?id=' + encodeURIComponent(id), body, function (s, d) {
      if (s === 200 && d && d.projects) { list = d.projects; msg = ''; if (okMsg) App.toast(okMsg); }
      else {
        var q = byId(id);
        if (q) { var old = JSON.parse(before); for (k in q) if (q.hasOwnProperty(k)) delete q[k]; for (k in old) if (old.hasOwnProperty(k)) q[k] = old[k]; }
        msg = (d && d.error) || 'Could not save, try again';
      }
      sync(); paint(); App.render();
    }, '/api/projects');
  }
  function setPrio(id, v) {
    patch(id, { prio: v }, function (p) { if (v) p.prio = v; else delete p.prio; });
  }
  function setHold(id, hold) {
    patch(id, { status: hold ? 'hold' : 'active' }, function (p) { if (hold) p.status = 'hold'; else delete p.status; }, hold ? 'On hold' : 'Active');
  }
  function complete(id) {
    var p = byId(id); if (!p) return;
    var n = openCount(p.name);
    var go = function () {
      patch(id, { status: 'done', left_open: n }, function (q) { q.status = 'done'; q.done_at = new Date().toISOString(); q.left_open = n; }, p.name + ' completed');
    };
    if (!n) { go(); return; }
    App.ask({
      title: 'Complete ' + p.name + '?',
      text: n + (n === 1 ? ' task is' : ' tasks are') + ' still open. ' + (n === 1 ? 'It stays' : 'They stay') + ' on your Work list but leave the board. You can reopen the project any time.',
      buttons: [{ label: 'Complete project', primary: true }, { label: 'Cancel' }]
    }, function (b) { if (b === 0) go(); });
  }
  function reopen(id) {
    var p = byId(id);
    patch(id, { status: 'active' }, function (q) { delete q.status; delete q.done_at; delete q.left_open; }, p ? p.name + ' reopened' : 'Reopened');
  }
  function filterTo(name) {
    close();
    var chips = document.querySelectorAll('#filters [data-act="filter"]'), i;
    for (i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute('data-val') === name) { if (!/\bon\b/.test(chips[i].className)) chips[i].click(); return; }
    }
    App.toast('No open tasks in ' + name);
  }

  /* ---------- the picker in the task editor: Work tasks pick a project, not a category ---------- */
  // Personal tasks must not be offered Work projects (or old Work-only categories) as categories.
  // A category stays if a Personal task uses it, it is one of the built-in ones, or it is ticked on this task.
  var BUILT_IN = ['Home', 'Admin', 'Money', 'Errands', 'Health', 'Social', 'Projects'];
  function hideWorkOnly(box) {
    var all = App.todos(), personal = {}, work = {}, i, c, chips, v;
    for (i = 0; i < BUILT_IN.length; i++) personal[BUILT_IN[i]] = 1;
    for (i = 0; i < all.length; i++) {
      c = all[i].category; if (!c) continue;
      if ((all[i].list || 'personal') === 'work') work[c] = 1; else personal[c] = 1;
    }
    chips = box.querySelectorAll('[data-act="scat"]');
    for (i = chips.length - 1; i >= 0; i--) {
      v = chips[i].getAttribute('data-val');
      if (!v || personal[v] || /\bon\b/.test(chips[i].className)) continue;
      if (work[v] || isProject(v)) chips[i].parentNode.removeChild(chips[i]);
    }
  }
  function patchPicker() {
    var box = $('eCats'); if (!box) return;
    var lbl = box.previousElementSibling, on = $('eList') && $('eList').querySelector('.on');
    var work = !!on && on.getAttribute('data-val') === 'work';
    if (!work) { if (lbl && lbl.textContent === 'Project') lbl.textContent = 'Category'; hideWorkOnly(box); return; }
    if (box.querySelector('[data-pjchip]')) return; // already ours
    if (lbl) lbl.textContent = 'Project';
    // The editor only highlights categories it already knows; a project picked just now is tracked here.
    var cur = box.querySelector('.chip.on');
    fillPicker(box, cur ? (cur.getAttribute('data-val') || '') : lastPick);
  }
  function fillPicker(box, curName) {
    var h = '', i;
    shownCur = curName;
    if (curName && !byName(curName)) h += '<button class="chip on" data-pjchip="1" data-act="scat" data-val="' + esc(curName) + '">' + esc(curName) + '</button>';
    for (i = 0; i < list.length; i++) {
      if (isDone(list[i]) && list[i].name !== curName) continue;
      h += '<button class="chip' + (list[i].name === curName ? ' on' : '') + '" data-pjchip="1" data-act="scat" data-val="' + esc(list[i].name) + '">' + esc(list[i].name) + '</button>';
    }
    h += '<button class="chip' + (!curName ? ' on' : '') + '" data-pjchip="1" data-act="scat" data-val="">None</button>';
    h += '<button class="chip" data-pjchip="1" data-pj="open">Manage projects…</button>';
    if (!known) h += '<div class="sethint">Loading projects…</div>';
    else if (!ranked().length) h += '<div class="sethint">No projects yet. Tap Manage projects to add some.</div>';
    box.innerHTML = h;
  }
  function refreshPicker() {
    var box = $('eCats'); if (!box || !box.querySelector('[data-pjchip]')) return;
    var cur = box.querySelector('.chip.on[data-act="scat"]');
    fillPicker(box, cur ? (cur.getAttribute('data-val') || '') : '');
  }
  if (window.MutationObserver && $('eCats')) new MutationObserver(patchPicker).observe($('eCats'), { childList: true });

  /* ---------- events ---------- */
  // Runs before the editor's own handler (capture), while the tapped chip is still in the page.
  document.addEventListener('click', function (e) {
    var pc = e.target;
    while (pc && pc !== document && !(pc.getAttribute && pc.getAttribute('data-pjchip') && pc.getAttribute('data-act') === 'scat')) pc = pc.parentNode;
    if (pc && pc !== document) { var pv = pc.getAttribute('data-val'); lastPick = (!pv || shownCur === pv) ? '' : pv; }
  }, true);
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-pj'))) el = el.parentNode;
    if (!el || el === document) return;
    var a = el.getAttribute('data-pj'), id = el.getAttribute('data-id'), name = el.getAttribute('data-name');
    if (a === 'open') open();
    else if (a === 'close') close();
    else if (a === 'edit') { editId = id; msg = ''; paint(); }
    else if (a === 'cancel') { editId = ''; msg = ''; paint(); }
    else if (a === 'save') rename(id, $('pjEdit') ? $('pjEdit').value : '');
    else if (a === 'del') remove(id);
    else if (a === 'filter') filterTo(name);
    else if (a === 'promote') add(name);
    else if (a === 'prio') setPrio(id, +el.getAttribute('data-val'));
    else if (a === 'stat') setHold(id, el.getAttribute('data-val') === '1');
    else if (a === 'done') complete(id);
    else if (a === 'reopen') reopen(id);
    else if (a === 'arch') { showArch = !showArch; paint(); }
  }, false);
  App.projects = { open: open, list: function () { return list; }, active: ranked };
})();
