(function () {
  'use strict';
  /* Projects board: every active Work project as a column, its open tasks in your own order, plus a Work insights tab. */
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var projects = [], known = false, tries = 0, fold = {}, msg = '', pick = null, drag = null;
  var tab = store.get('bdTab') === 'ins' ? 'ins' : 'board';
  var rows = null, hErr = '', hLoading = false, hAt = 0;
  try { fold = JSON.parse(store.get('bdFold') || '{}') || {}; } catch (e) { fold = {}; }
  try { var st = document.createElement('style'); st.appendChild(document.createTextNode('.pau{display:inline-block;margin:2px 4px 0 0;padding:1px 7px;border-radius:9px;background:#e8eaf0;color:#4a5068;font-size:12px}.bdrow.st-pz{opacity:.62;background:#f1f2f5;box-shadow:inset 4px 0 0 #9aa0b4;margin:0 -8px;padding:0 8px 0 12px;border-radius:8px;border-top-color:transparent}.bdlegend .lg.pz:before{background:#9aa0b4}.bdh.pzc{background:#e8eaf0;color:#4a5068}')); document.head.appendChild(st); } catch (e) {}

  function syncCore() { if (App.setProjects) App.setProjects(projects); }
  function use(list) { projects = list; known = true; syncCore(); }
  function load(cb) {
    if (!App.token()) { if (tries++ < 8) setTimeout(function () { load(cb); }, 1500); return; }
    App.api('GET', '', null, function (s, d) {
      if (s === 200 && d && d.projects) { use(d.projects); if (cb) cb(); }
    }, '/api/projects');
  }

  /* ---------- data ---------- */
  function openWork() {
    var all = App.todos(), out = [], i, t;
    for (i = 0; i < all.length; i++) {
      t = all[i];
      if ((t.list || 'personal') === 'work' && !t.done && !t.low && !t.is_session) out.push(t);
    }
    return out;
  }
  function byId(id) { for (var i = 0; i < projects.length; i++) if (projects[i].id === id) return projects[i]; return null; }
  function taskById(id) { var all = App.todos(), i; for (i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  // The same automatic order as the Work list (timed, must-do, priority, quick wins, deadline); blocked tasks last.
  function holdRank(t) { return t.paused ? 2 : t.blocked ? 1 : 0; } // paused tasks sink below blocked ones
  function dflt(a, b) {
    var x = holdRank(a), y = holdRank(b);
    if (x !== y) return x - y;
    return App.cmpWork(a, b);
  }
  function ordered(tasks, order) {
    var idx = {}, i;
    order = order || [];
    for (i = 0; i < order.length; i++) idx[order[i]] = i + 1;
    var out = tasks.slice().sort(function (a, b) {
      var x = idx[a.id] || 0, y = idx[b.id] || 0;
      if (x && y) return x - y;
      if (x) return -1;
      if (y) return 1;
      return dflt(a, b);
    }), live = [], waiting = [];
    for (i = 0; i < out.length; i++) (out[i].paused ? waiting : live).push(out[i]); // paused tasks always sit at the bottom
    return live.concat(waiting);
  }
  // Left to right: active projects High to Low priority, then on-hold ones. Completed projects are archived, not shown.
  function shown() {
    var out = [], i;
    for (i = 0; i < projects.length; i++) if (projects[i].status !== 'done') out.push({ p: projects[i], i: i });
    out.sort(function (a, b) {
      var x = a.p.status === 'hold' ? 1 : 0, y = b.p.status === 'hold' ? 1 : 0;
      if (x !== y) return x - y;
      if ((a.p.prio || 0) !== (b.p.prio || 0)) return (b.p.prio || 0) - (a.p.prio || 0);
      return a.i - b.i;
    });
    return out.map(function (o) { return o.p; });
  }
  function groups() {
    var work = openWork(), byName = {}, archived = {}, vis = shown(), out = [], rest = [], i, t;
    for (i = 0; i < projects.length; i++) { if (projects[i].status === 'done') archived[projects[i].name] = 1; else byName[projects[i].name] = []; }
    for (i = 0; i < work.length; i++) {
      t = work[i];
      if (t.category && byName[t.category]) byName[t.category].push(t);
      else if (!(t.category && archived[t.category])) rest.push(t); // tasks of a completed project stay out of the board
    }
    for (i = 0; i < vis.length; i++) out.push({ p: vis[i], tasks: ordered(byName[vis[i].name], vis[i].order) });
    return { cols: out, rest: rest.sort(dflt), archived: projects.length - vis.length };
  }
  var PL = ['', 'Low', 'Medium', 'High'];
  function isFolded(p) { return p.status === 'hold' ? fold[p.id] !== 2 : !!fold[p.id]; } // on-hold projects start collapsed
  function toggleFold(p) {
    if (p.status === 'hold') { if (fold[p.id] === 2) delete fold[p.id]; else fold[p.id] = 2; }
    else if (fold[p.id]) delete fold[p.id]; else fold[p.id] = 1;
  }

  /* ---------- saving the order ---------- */
  var pend = {}, flushing = false;
  function persist(p) { pend[p.id] = 1; flush(); }
  function flush() {
    var id = null, k, p;
    if (flushing) return;
    for (k in pend) if (pend.hasOwnProperty(k)) { id = k; break; }
    if (!id) return;
    delete pend[id];
    p = byId(id);
    if (!p) { flush(); return; }
    flushing = true;
    App.api('PATCH', '?id=' + encodeURIComponent(id), { order: p.order || [] }, function (s) {
      flushing = false;
      if (s !== 200) { App.toast('Could not save the order, check your connection'); msg = 'Order not saved'; }
      flush();
    }, '/api/projects');
  }
  function segOf(t) { return App.isFocus(t) ? 0 : (t.due_date && t.due_date < App.today()) ? 1 : 2; }
  // Projects -> Work list: if some of this project's tasks already have a hand-set order for today, move them to match.
  function syncPlan(p) {
    if (!App.dayIds || !App.savePlan) return;
    var today = App.today(), cur = App.dayIds('work'), i, t, planned = false, bySeg = {}, k, n = 0, seg;
    for (i = 0; i < cur.length; i++) {
      t = taskById(cur[i]);
      if (!t || t.category !== p.name) continue;
      n++;
      if (t.plan_order && t.plan_date === today) planned = true;
      seg = segOf(t);
      (bySeg[seg] = bySeg[seg] || []).push(i);
    }
    if (!planned || n < 2) return;
    for (k in bySeg) if (bySeg.hasOwnProperty(k)) {
      var idx = bySeg[k], tasks = [], j, sorted;
      for (j = 0; j < idx.length; j++) tasks.push(taskById(cur[idx[j]]));
      sorted = ordered(tasks, p.order);
      for (j = 0; j < idx.length; j++) cur[idx[j]] = sorted[j].id;
    }
    App.savePlan(cur, 'work');
  }
  // Work list -> Projects: a hand-set order in "Today's order" / "Sort my day" becomes the order inside each project.
  App.afterPlan = function (ids, list) {
    if (list !== 'work' || !known) return;
    var open = openWork(), pos = {}, i, j, k, p, changed = false;
    for (i = 0; i < ids.length; i++) pos[ids[i]] = i + 1;
    for (i = 0; i < projects.length; i++) {
      p = projects[i];
      if (p.status === 'done') continue;
      var mine = [], planned, all, slots = [], next, a, diff = false;
      for (j = 0; j < open.length; j++) if (open[j].category === p.name) mine.push(open[j]);
      planned = mine.filter(function (t) { return pos[t.id]; }).sort(function (x, y) { return pos[x.id] - pos[y.id]; });
      if (planned.length < 2) continue;
      all = ordered(mine, p.order);
      for (k = 0; k < all.length; k++) if (pos[all[k].id]) slots.push(k);
      next = all.slice();
      for (k = 0; k < slots.length; k++) next[slots[k]] = planned[k];
      for (k = 0; k < all.length; k++) if (all[k].id !== next[k].id) diff = true;
      if (!diff) continue;
      a = []; for (k = 0; k < next.length; k++) a.push(next[k].id);
      p.order = a; persist(p); changed = true;
    }
    if (changed) { syncCore(); paint(); }
  };
  function setOrder(p, ids, auto) {
    if (auto) delete p.order; else p.order = ids;
    pick = null;
    persist(p);
    syncCore();
    syncPlan(p);
    paint();
  }
  function colIds(pid) {
    var g = groups(), i, j, ids = [];
    for (i = 0; i < g.cols.length; i++) if (g.cols[i].p.id === pid) for (j = 0; j < g.cols[i].tasks.length; j++) ids.push(g.cols[i].tasks[j].id);
    return ids;
  }
  function moveTo(pid, id, to) {
    var p = byId(pid), ids = colIds(pid), at = ids.indexOf(id);
    if (!p || at < 0 || to < 0 || to >= ids.length || to === at) { pick = null; paint(); return; }
    ids.splice(to, 0, ids.splice(at, 1)[0]);
    setOrder(p, ids, false);
  }

  /* ---------- drawing ---------- */
  function dueChip(t) {
    var today = App.today(), d;
    if (!t.due_date) return '';
    d = App.diffDays(t.due_date, today);
    if (t.blocked || t.paused) return '<span class="due">' + App.fmtDate(t.due_date) + '</span>';
    if (d < 0) return '<span class="due overdue">Overdue · ' + App.fmtDate(t.due_date) + '</span>';
    if (d === 0) return '<span class="due today">Due today</span>';
    if (d === 1) return '<span class="due">Tomorrow</span>';
    return '<span class="due">' + App.fmtDate(t.due_date) + '</span>';
  }
  function tags(t) {
    var h = '';
    if (t.prio > 0) h += '<span class="pr p' + t.prio + '">' + new Array(t.prio + 1).join('!') + '</span>';
    if (t.quick) h += '<span class="qk">⚡ Quick</span>';
    if (t.must && t.due_date && t.due_date <= App.today() && !t.blocked && !t.paused) h += '<span class="mst">Must today</span>';
    if (t.blocked) h += '<span class="blk">Blocked</span>';
    if (t.paused) h += '<span class="pau">⏸ Waiting' + (t.paused_on ? ': ' + esc(t.paused_on) : '') + '</span>';
    return h;
  }
  function stateCls(t) {
    var today = App.today();
    if (t.paused) return ' st-pz';
    if (t.blocked) return ' st-blk';
    if (t.due_date && t.due_date < today) return ' st-od';
    if (t.due_date === today) return ' st-td';
    if (t.prio === 3) return ' st-hi';
    return '';
  }
  function row(t, n, pid, count, isNext) {
    var id = esc(t.id), meta = dueChip(t) + tags(t), h;
    h = '<li class="item bdrow' + stateCls(t) + (isNext ? ' bdnext' : '') + '" id="i-' + id + '">' +
      '<button class="tick" data-act="tick" data-id="' + id + '" aria-label="Mark done"></button>' +
      '<div class="body" data-act="edit" data-id="' + id + '">' +
      (isNext ? '<div class="bdnl">Next up</div>' : '') +
      '<div class="title">' + esc(t.title) + '</div>' +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      (t.blocked && t.unblock_action ? '<div class="unb"><b>Unblock:</b> ' + esc(t.unblock_action) + '</div>' : '') +
      (t.paused ? '<div class="unb"><button class="chip" data-act="resume" data-id="' + id + '">Resume</button></div>' : '') +
      '</div>';
    if (pid && count > 1) {
      h += '<div class="bdhand"><button class="bdnum' + (pick && pick.id === t.id ? ' on' : '') + '" data-bd="num" data-pid="' + esc(pid) + '" data-id="' + id + '" aria-label="Move to a position">' + (n + 1) + '</button>' +
        '<div class="bdgrip" data-pid="' + esc(pid) + '" data-id="' + id + '" aria-label="Drag to reorder">☰</div></div>';
    }
    h += '</li>';
    if (pid && pick && pick.id === t.id) {
      h += '<li class="bdpick"><span class="qlabel">Move to position</span>';
      for (var k = 0; k < count; k++) if (k !== n) h += '<button class="chip" data-bd="to" data-pid="' + esc(pid) + '" data-id="' + id + '" data-to="' + k + '">' + (k + 1) + '</button>';
      h += '</li>';
    }
    return h;
  }
  function health(tasks) {
    var today = App.today(), od = 0, td = 0, bl = 0, pz = 0, i, t, h = '';
    for (i = 0; i < tasks.length; i++) {
      t = tasks[i];
      if (t.paused) pz++;
      else if (t.blocked) bl++;
      else if (t.due_date && t.due_date < today) od++;
      else if (t.due_date === today) td++;
    }
    if (od) h += '<span class="bdh bad">' + od + ' overdue</span>';
    if (td) h += '<span class="bdh warn">' + td + ' due today</span>';
    if (bl) h += '<span class="bdh blk">' + bl + ' blocked</span>';
    if (pz) h += '<span class="bdh pzc">⏸ ' + pz + ' paused</span>';
    if (!od && !td && !bl && tasks.length > pz) h += '<span class="bdh ok">On track</span>';
    return h;
  }
  function column(c) {
    var p = c.p, tasks = c.tasks, folded = isFolded(p), hold = p.status === 'hold', h, i, firstFree = -1;
    var pzn = 0;
    for (i = 0; i < tasks.length; i++) if (tasks[i].paused) pzn++;
    for (i = 0; i < tasks.length; i++) if (!tasks[i].blocked && !tasks[i].paused) { firstFree = i; break; }
    h = '<section class="bdcol' + (folded ? ' folded' : '') + (hold ? ' hold' : '') + '">' +
      '<button class="bdhead" data-bd="fold" data-pid="' + esc(p.id) + '" aria-expanded="' + (folded ? 'false' : 'true') + '">' +
      '<span class="bdname">' + esc(p.name) + '</span>' +
      (hold ? '<span class="bdp hold">On hold</span>' : p.prio ? '<span class="bdp bdp' + p.prio + '">' + PL[p.prio] + '</span>' : '') +
      '<span class="bdn">' + (tasks.length - pzn) + ' open</span><span class="bdcaret">' + (folded ? '▸' : '▾') + '</span></button>' +
      '<div class="bdhealth">' + health(tasks) +
      (p.order && p.order.length && tasks.length > 1 ? '<button class="bdh auto" data-bd="auto" data-pid="' + esc(p.id) + '">↺ Auto-order</button>' : '') + '</div>';
    if (!folded) {
      h += '<ul class="list bdlist">';
      if (!tasks.length) h += '<li class="bdempty">Nothing open. Add the first task below.</li>';
      for (i = 0; i < tasks.length; i++) h += row(tasks[i], i, p.id, tasks.length, i === firstFree && tasks.length > 1);
      h += '</ul>';
      h += '<form class="bdadd" data-pid="' + esc(p.id) + '" autocomplete="off"><input class="bdin" type="text" placeholder="Add a task…" maxlength="200" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false"><button type="submit">Add</button></form>';
    }
    return h + '</section>';
  }
  function looseColumn(rest) {
    var h = '<section class="bdcol loose"><div class="bdhead static"><span class="bdname">No project</span><span class="bdn">' + rest.length + ' open</span></div>' +
      '<div class="bdhealth"><span class="bdh mute">Open a task and pick a project to file it</span></div><ul class="list bdlist">', i;
    for (i = 0; i < rest.length; i++) h += row(rest[i], i, '', rest.length, false);
    return h + '</ul></section>';
  }
  function tabBar() {
    return '<div class="bdbar"><div class="bdtools"><span class="sg sm"><button class="' + (tab === 'board' ? 'on' : '') + '" data-bd="tab" data-tab="board">Board</button>' +
      '<button class="' + (tab === 'ins' ? 'on' : '') + '" data-bd="tab" data-tab="ins">Insights</button></span>' +
      '<button class="chip" data-pj="open">Manage projects…</button></div></div>';
  }
  var LEGEND = '<div class="bdlegend"><span class="lg blk">Blocked</span><span class="lg od">Overdue</span><span class="lg td">Due today</span><span class="lg hi">High priority</span><span class="lg pz">Paused</span>' +
    '<span class="lgx">Order follows the Work list: priority, quick wins, deadline. Drag ☰ or tap a number to change it.</span></div>';

  function boardHTML() {
    var g = groups(), open = 0, od = 0, bl = 0, pzs = 0, held = 0, i, j, t, today = App.today(), h = '', sums = [];
    for (i = 0; i < g.cols.length; i++) if (g.cols[i].p.status === 'hold') held++; else for (j = 0; j < g.cols[i].tasks.length; j++) {
      t = g.cols[i].tasks[j];
      if (t.paused) { pzs++; continue; }
      open++;
      if (t.blocked) bl++; else if (t.due_date && t.due_date < today) od++;
    }
    if (!known) return '<p class="empty">Loading…</p>';
    if (!g.cols.length) {
      return '<p class="empty">' + (g.archived ? 'All your projects are completed. Tap “Manage projects…” to reopen one or add a new one.' : 'No active projects yet. Tap “Manage projects…” to add your first one, then give Work tasks that project.') + '</p>' + (g.rest.length ? '<div class="bdcols">' + looseColumn(g.rest) + '</div>' : '');
    }
    sums.push((g.cols.length - held) + ((g.cols.length - held) === 1 ? ' active project' : ' active projects'));
    if (held) sums.push(held + ' on hold');
    sums.push(open + ' open');
    if (od) sums.push(od + ' overdue');
    if (bl) sums.push(bl + ' blocked');
    if (pzs) sums.push(pzs + ' paused');
    if (g.archived) sums.push(g.archived + ' completed');
    h += '<div class="bdsum">' + sums.join(' · ') + '</div>' + LEGEND +
      (msg ? '<div class="sethint" style="color:var(--alert)">' + esc(msg) + '</div>' : '') + '<div class="bdcols">';
    for (i = 0; i < g.cols.length; i++) h += column(g.cols[i]);
    if (g.rest.length) h += looseColumn(g.rest);
    return h + '</div>';
  }

  function paint() {
    var pane = $('boardPane'); if (!pane || drag) return;
    var act = document.activeElement;
    if (act && act.className === 'bdin' && pane.contains(act)) return; // don't wipe what is being typed
    var cols = pane.querySelector('.bdcols'), left = cols ? cols.scrollLeft : 0, tops = [], bodies, i, h = tabBar();
    if (cols) { bodies = cols.querySelectorAll('.bdlist'); for (i = 0; i < bodies.length; i++) tops.push(bodies[i].scrollTop); }
    h += tab === 'ins' ? insHTML() : boardHTML();
    App.setHTML(pane, h);
    cols = pane.querySelector('.bdcols');
    if (cols && tab === 'board') {
      cols.scrollLeft = left;
      bodies = cols.querySelectorAll('.bdlist');
      for (i = 0; i < bodies.length && i < tops.length; i++) bodies[i].scrollTop = tops[i];
    }
  }

  /* ---------- drag to reorder (touch and mouse) ---------- */
  function rowsOf(list) { return list.querySelectorAll('li.bdrow'); }
  function startDrag(grip, y) {
    var li = grip.parentNode.parentNode, list = li.parentNode, rs = rowsOf(list), from = -1, i;
    for (i = 0; i < rs.length; i++) if (rs[i] === li) from = i;
    if (from < 0) return false;
    drag = { pid: grip.getAttribute('data-pid'), id: grip.getAttribute('data-id'), row: li, list: list, from: from, to: from, y0: y, s0: list.scrollTop };
    li.className += ' dragging'; li.style.position = 'relative'; li.style.zIndex = 5;
    return true;
  }
  function moveDrag(y) {
    var d = drag, rs = rowsOf(d.list), r = d.list.getBoundingClientRect(), s = 0, i, b, tr;
    if (y < r.top + 50) d.list.scrollTop -= 12; else if (y > r.bottom - 50) d.list.scrollTop += 12;
    tr = 'translateY(' + (y - d.y0 + (d.list.scrollTop - d.s0)) + 'px)';
    d.row.style.webkitTransform = tr; d.row.style.transform = tr;
    for (i = 0; i < rs.length; i++) {
      if (i === d.from) continue;
      b = rs[i].getBoundingClientRect();
      if (b.top + (b.bottom - b.top) / 2 < y) s++;
      rs[i].className = rs[i].className.replace(/ drop[ab]/g, '');
    }
    d.to = s;
    if (s !== d.from && rs[s]) rs[s].className += s < d.from ? ' dropb' : ' dropa';
  }
  function endDrag() {
    var d = drag; if (!d) return;
    d.row.style.webkitTransform = ''; d.row.style.transform = ''; d.row.style.position = ''; d.row.style.zIndex = '';
    drag = null;
    if (d.to !== d.from) moveTo(d.pid, d.id, d.to); else paint();
  }
  function gripOf(el, root) {
    while (el && el !== root) { if (el.className && /(^| )bdgrip( |$)/.test(el.className)) return el; el = el.parentNode; }
    return null;
  }
  (function wireDrag() {
    var pane = $('boardPane'); if (!pane) return;
    pane.addEventListener('touchstart', function (e) {
      var g = gripOf(e.target, pane);
      if (!g || !e.touches || e.touches.length !== 1 || !startDrag(g, e.touches[0].clientY)) return;
      e.preventDefault();
      var mv = function (ev) { ev.preventDefault(); moveDrag(ev.touches[0].clientY); };
      var up = function () { g.removeEventListener('touchmove', mv, false); g.removeEventListener('touchend', up, false); g.removeEventListener('touchcancel', up, false); endDrag(); };
      g.addEventListener('touchmove', mv, false); g.addEventListener('touchend', up, false); g.addEventListener('touchcancel', up, false);
    }, false);
    pane.addEventListener('mousedown', function (e) {
      var g = gripOf(e.target, pane);
      if (!g || !startDrag(g, e.clientY)) return;
      e.preventDefault();
      var mv = function (ev) { moveDrag(ev.clientY); };
      var up = function () { document.removeEventListener('mousemove', mv, false); document.removeEventListener('mouseup', up, false); endDrag(); };
      document.addEventListener('mousemove', mv, false); document.addEventListener('mouseup', up, false);
    }, false);
  })();

  /* ---------- Work insights ---------- */
  function fetchRows() {
    if (hLoading) return;
    hLoading = true; hErr = '';
    App.api('GET', '?days=120', null, function (s, d) {
      hLoading = false;
      if (s === 200 && d) { rows = d.rows || []; hAt = Date.now(); }
      else hErr = 'Could not load your history, try again.';
      paint();
    }, '/api/history');
  }
  function median(a) {
    if (!a.length) return null;
    a = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function waitText(ms) {
    var h = ms / 3600000;
    if (h < 1) return Math.max(1, Math.round(ms / 60000)) + ' min';
    if (h < 36) return Math.round(h) + (Math.round(h) === 1 ? ' hour' : ' hours');
    return Math.round(h / 24) + ' days';
  }
  function mondayOf(iso) { return App.addDays(iso, -((App.dowOf(iso) + 6) % 7)); }
  function barsSVG(vals, labels, hl) {
    var W = 320, H = 120, pad = 22, n = vals.length, max = 1, i;
    for (i = 0; i < n; i++) if (vals[i] > max) max = vals[i];
    var bw = (W - 8) / n, s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 18) + '" role="img">';
    s += '<line class="grid" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '"/>';
    for (i = 0; i < n; i++) {
      var h = Math.round((vals[i] / max) * (H - pad)), x = 4 + i * bw;
      s += '<rect x="' + (x + 3) + '" y="' + (H - h) + '" width="' + Math.max(4, bw - 6) + '" height="' + h + '" rx="3" fill="' + (i === hl ? 'var(--accent)' : 'var(--chip)') + '" stroke="var(--accent)" stroke-width="1"/>';
      if (vals[i]) s += '<text x="' + (x + bw / 2) + '" y="' + (H - h - 4) + '" text-anchor="middle">' + vals[i] + '</text>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H + 13) + '" text-anchor="middle">' + esc(labels[i]) + '</text>';
    }
    return s + '</svg>';
  }
  function hbars(pairs) {
    var h = '', i, max = 1;
    for (i = 0; i < pairs.length; i++) if (pairs[i][1] > max) max = pairs[i][1];
    for (i = 0; i < pairs.length; i++) h += '<div class="hbar"><span class="hl">' + esc(pairs[i][0]) + '</span><span class="hb"><i style="width:' + Math.round(pairs[i][1] * 100 / max) + '%"></i></span><span class="hv">' + pairs[i][1] + '</span></div>';
    return h;
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  function insHTML() {
    var h = '', i, j, t, k;
    if (hErr) h += '<div class="rvsub" style="color:var(--alert)">' + esc(hErr) + '</div>';
    if (!known || !rows) return h + (hErr ? '' : '<p class="empty">Loading…</p>');
    var t0 = App.today(), mon = mondayOf(t0), lastMon = App.addDays(mon, -7), d30 = App.addDays(t0, -29), nowm = App.nowMs();
    var work = openWork(), done = [], r, dd;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.d || r.s || (r.l || 'personal') !== 'work') continue;
      dd = App.localISO(new Date(App.parseTS(r.d)));
      done.push({ c: App.parseTS(r.c), d: App.parseTS(r.d), dd: dd, due: r.due, cat: r.cat || '' });
    }
    var thisWeek = 0, lastWeek = 0, weeks = [], w, onTime = 0, withDue = 0, waits = [];
    for (w = 7; w >= 0; w--) weeks.push({ start: App.addDays(mon, -7 * w), n: 0 });
    for (i = 0; i < done.length; i++) {
      r = done[i];
      if (r.dd >= mon) thisWeek++; else if (r.dd >= lastMon) lastWeek++;
      for (w = weeks.length - 1; w >= 0; w--) if (r.dd >= weeks[w].start) { if (r.dd < App.addDays(weeks[w].start, 7)) weeks[w].n++; break; }
      if (r.due) { withDue++; if (r.dd <= r.due) onTime++; }
      if (r.d > r.c) waits.push(r.d - r.c);
    }
    // open work, bucketed by project
    var buckets = {}, order = [], archivedNames = {}, loose = { p: null, name: 'No project', open: 0, od: 0, td: 0, bl: 0, oldest: 0, next: '', done30: 0, waits: [] };
    for (i = 0; i < projects.length; i++) if (projects[i].status === 'done') archivedNames[projects[i].name] = projects[i];
    var vis = shown();
    for (i = 0; i < vis.length; i++) { buckets[vis[i].name] = { p: vis[i], name: vis[i].name, open: 0, od: 0, td: 0, bl: 0, oldest: 0, next: '', done30: 0, waits: [] }; order.push(vis[i].name); }
    var totalOpen = 0, od = 0, td = 0, bl = 0, oldestBlk = 0, prio = [0, 0, 0, 0], blocked = [], load14 = [], inProj = 0, pzTot = 0;
    for (i = 0; i < 15; i++) load14.push(0);
    for (i = 0; i < work.length; i++) {
      t = work[i];
      var b = (t.category && buckets[t.category]) ? buckets[t.category] : null;
      if (!b && t.category && archivedNames[t.category]) continue;
      if (!b) b = loose; else inProj++;
      if (t.paused) { b.pz = (b.pz || 0) + 1; pzTot++; continue; } // waiting on others: not open, overdue or blocked
      totalOpen++; b.open++; prio[t.prio || 0]++;
      var age = Math.floor((nowm - App.parseTS(t.created_at)) / 86400000);
      if (age > b.oldest) b.oldest = age;
      if (t.blocked) {
        b.bl++; bl++; blocked.push(t);
        var ba = t.blocked_at ? Math.floor((nowm - App.parseTS(t.blocked_at)) / 86400000) : 0;
        if (ba > oldestBlk) oldestBlk = ba;
        continue;
      }
      if (t.due_date) {
        if (t.due_date < t0) { b.od++; od++; load14[0]++; }
        else {
          if (t.due_date === t0) { b.td++; td++; }
          var off = App.diffDays(t.due_date, t0);
          if (off <= 13) load14[off + 1]++;
          if (!b.next || t.due_date < b.next) b.next = t.due_date;
        }
      }
    }
    for (i = 0; i < done.length; i++) {
      r = done[i];
      var bk = (r.cat && buckets[r.cat]) ? buckets[r.cat] : (!r.cat || !archivedNames[r.cat]) ? loose : null;
      if (!bk) continue;
      if (r.dd >= d30) bk.done30++;
      if (r.d > r.c) bk.waits.push(r.d - r.c);
    }
    var held = 0, act = 0;
    for (i = 0; i < projects.length; i++) { if (projects[i].status === 'done') continue; if (projects[i].status === 'hold') held++; else act++; }
    var diff = thisWeek - lastWeek, wm = median(waits);
    h += '<div class="tiles">';
    h += '<div class="tile"><h3>Open work</h3><div class="kpi">' + totalOpen + '</div><div class="ksub">' + inProj + ' in projects · ' + (totalOpen - inProj) + ' with no project' + (pzTot ? ' · ' + pzTot + ' paused' : '') + '</div></div>';
    h += '<div class="tile"><h3>Needs attention</h3><div class="kpi' + (od ? ' bad' : ' ok') + '">' + od + '</div><div class="ksub">' + (od ? 'overdue' : 'nothing overdue') + ' · ' + td + ' due today · ' + bl + ' blocked' + (oldestBlk >= 3 ? ' (oldest ' + oldestBlk + 'd)' : '') + '</div></div>';
    h += '<div class="tile"><h3>Done this week</h3><div class="kpi">' + thisWeek + '</div><div class="ksub">Last week ' + lastWeek + (lastWeek || thisWeek ? ' · ' + (diff > 0 ? diff + ' up' : diff < 0 ? (-diff) + ' down' : 'level') : '') + '</div></div>';
    h += '<div class="tile"><h3>Done on time</h3><div class="kpi' + (withDue < 3 ? '' : onTime * 100 / withDue >= 70 ? ' ok' : onTime * 100 / withDue < 40 ? ' bad' : '') + '">' + (withDue >= 3 ? Math.round(onTime * 100 / withDue) + '%' : '–') + '</div><div class="ksub">' + (withDue >= 3 ? 'of ' + withDue + ' dated work tasks finished by their date' : 'Needs a few dated tasks') + '</div></div>';
    h += '<div class="tile"><h3>Typical wait</h3><div class="kpi">' + (wm === null ? '–' : waitText(wm)) + '</div><div class="ksub">Median time from adding a work task to finishing it</div></div>';
    h += '<div class="tile"><h3>Projects</h3><div class="kpi">' + act + '</div><div class="ksub">active · ' + held + ' on hold · ' + (projects.length - act - held) + ' completed</div></div>';
    var lab = [];
    for (i = 0; i < weeks.length; i++) { var pp = weeks[i].start.split('-'); lab.push(+pp[2] + ' ' + App.MONS[+pp[1] - 1]); }
    var wv = [];
    for (i = 0; i < weeks.length; i++) wv.push(weeks[i].n);
    h += '<div class="tile full"><h3>Work finished, last 8 weeks (weeks starting Monday)</h3>' + barsSVG(wv, lab, weeks.length - 1) + '</div>';
    var l14 = ['Late'];
    for (i = 0; i < 14; i++) l14.push('' + (+App.addDays(t0, i).split('-')[2]));
    h += '<div class="tile full"><h3>What is due in the next two weeks</h3>' + barsSVG(load14, l14, 1) + '<div class="ksub">Blocked tasks are left out. “Late” is everything already overdue.</div></div>';
    // per project
    h += '<div class="tile full"><h3>Project by project</h3>';
    var list = [];
    for (i = 0; i < order.length; i++) list.push(buckets[order[i]]);
    if (loose.open || loose.done30) list.push(loose);
    if (!list.length) h += '<p class="empty">No projects yet.</p>';
    for (i = 0; i < list.length; i++) {
      var q = list[i], pct = (q.open + q.done30) ? Math.round(q.done30 * 100 / (q.open + q.done30)) : 0, wmed = median(q.waits);
      h += '<div class="insp"><div class="ipn"><b>' + esc(q.name) + '</b>' + (q.p && q.p.status === 'hold' ? '<span class="bdp hold">On hold</span>' : q.p && q.p.prio ? '<span class="bdp bdp' + q.p.prio + '">' + PL[q.p.prio] + '</span>' : '') + '</div>' +
        '<div class="ipm">' + q.open + ' open' + (q.pz ? ' · ' + q.pz + ' paused' : '') + (q.od ? ' · <span class="neg">' + q.od + ' overdue</span>' : '') + (q.td ? ' · <span class="warnt">' + q.td + ' due today</span>' : '') + (q.bl ? ' · <span class="neg">' + q.bl + ' blocked</span>' : '') + '</div>' +
        '<div class="hbar"><span class="hb"><i style="width:' + pct + '%"></i></span><span class="hv" style="width:44px">' + pct + '%</span></div>' +
        '<div class="ipx">' + q.done30 + ' finished in 30 days' + (wmed !== null ? ' · typically ' + waitText(wmed) : '') + (q.oldest >= 7 ? ' · oldest open ' + q.oldest + 'd' : '') + (q.next ? ' · next due ' + App.fmtDate(q.next) : '') + '</div></div>';
    }
    h += '<div class="ksub">The bar is finished in the last 30 days against what is still open.</div></div>';
    h += '<div class="tile"><h3>Open by priority</h3>' + hbars([['!!! High', prio[3]], ['!! Medium', prio[2]], ['! Low', prio[1]], ['No priority', prio[0]]]) + '</div>';
    h += '<div class="tile"><h3>Open by project</h3>' + (list.length ? hbars(list.map(function (x) { return [x.name, x.open]; })) : '<div class="ksub">Nothing yet</div>') + '</div>';
    if (blocked.length) {
      blocked.sort(function (a, b2) { return App.parseTS(a.blocked_at) - App.parseTS(b2.blocked_at); });
      h += '<div class="tile full"><h3>Blocked (' + blocked.length + ')</h3>';
      for (i = 0; i < blocked.length && i < 10; i++) {
        t = blocked[i];
        var da = t.blocked_at ? Math.floor((nowm - App.parseTS(t.blocked_at)) / 86400000) : 0;
        h += '<div class="insp"><div class="ipn"><span data-act="edit" data-id="' + esc(t.id) + '" style="cursor:pointer">' + esc(t.title) + '</span></div><div class="ipx">' + (t.category ? esc(t.category) + ' · ' : '') + (da < 1 ? 'blocked today' : 'blocked ' + plural(da, 'day')) + (t.unblock_action ? ' · <b>Unblock:</b> ' + esc(t.unblock_action) : '') + '</div></div>';
      }
      h += '</div>';
    }
    var arch = [];
    for (k in archivedNames) if (archivedNames.hasOwnProperty(k)) arch.push(archivedNames[k]);
    if (arch.length) {
      arch.sort(function (a, b2) { return (b2.done_at || '') < (a.done_at || '') ? -1 : 1; });
      h += '<div class="tile full"><h3>Completed projects (' + arch.length + ')</h3>';
      for (i = 0; i < arch.length; i++) {
        var n120 = 0;
        for (j = 0; j < done.length; j++) if (done[j].cat === arch[i].name) n120++;
        h += '<div class="insp"><div class="ipn"><b>' + esc(arch[i].name) + '</b></div><div class="ipx">Completed ' + (arch[i].done_at ? App.fmtDate(arch[i].done_at.slice(0, 10)) : '') + ' · ' + plural(n120, 'task') + ' finished in the last 120 days</div></div>';
      }
      h += '</div>';
    }
    h += '</div><div class="sethint">Work tasks only. Finished-task figures use the last 120 days.</div>';
    return h;
  }

  /* ---------- actions ---------- */
  function addTask(form) {
    var inp = form.querySelector('.bdin'), title = (inp.value || '').replace(/^\s+|\s+$/g, ''), pid = form.getAttribute('data-pid'), name = '', i;
    for (i = 0; i < projects.length; i++) if (projects[i].id === pid) name = projects[i].name;
    if (!title || !name) return;
    inp.value = '';
    App.api('POST', '', { title: title, category: name, list: 'work' }, function (s, d) {
      if (s === 201 && d && d.todo) {
        App.todos().push(d.todo); App.mutated(); App.toast('Added to ' + name);
      } else { inp.value = title; App.toast('Could not add, try again'); }
      App.render();
    });
  }
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.className || String(f.className).indexOf('bdadd') < 0) return;
    e.preventDefault(); addTask(f);
  }, false);
  document.addEventListener('click', function (e) {
    var el = e.target, a;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-bd'))) el = el.parentNode;
    if (!el || el === document || el.disabled) return;
    a = el.getAttribute('data-bd');
    if (a === 'fold') {
      var pid = el.getAttribute('data-pid'), pj = byId(pid);
      if (pj) toggleFold(pj);
      store.set('bdFold', JSON.stringify(fold)); paint();
    } else if (a === 'num') {
      var nid = el.getAttribute('data-id');
      pick = (pick && pick.id === nid) ? null : { pid: el.getAttribute('data-pid'), id: nid };
      paint();
    } else if (a === 'to') {
      moveTo(el.getAttribute('data-pid'), el.getAttribute('data-id'), +el.getAttribute('data-to'));
    } else if (a === 'auto') {
      var ap = byId(el.getAttribute('data-pid'));
      if (ap) { setOrder(ap, [], true); App.toast('Back to the automatic order'); }
    } else if (a === 'tab') {
      tab = el.getAttribute('data-tab') === 'ins' ? 'ins' : 'board';
      store.set('bdTab', tab); pick = null;
      if (tab === 'ins' && (!rows || Date.now() - hAt > 60000)) fetchRows();
      paint();
    }
  }, false);
  document.addEventListener('visibilitychange', function () { if (!App.hidden()) load(function () { paint(); }); }, false);

  App.boardSet = function (l) { use(l); paint(); };
  App.register('board', {
    title: 'Projects',
    render: function () { paint(); },
    show: function () {
      msg = ''; pick = null; paint();
      load(function () { paint(); });
      if (tab === 'ins' && (!rows || Date.now() - hAt > 60000)) fetchRows();
    }
  });
  setTimeout(function () { load(); }, 1100);
})();
