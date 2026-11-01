(function () {
  'use strict';
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DEFAULT_CATS = ['Home', 'Admin', 'Money', 'Errands', 'Health', 'Social', 'Projects'];

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  };

  var token = null, todos = [], today = null, serverOffset = 0;
  var loaded = false, inflight = false, online = true, lastMutation = 0;
  var settings = { city: '', place: '', units: 'c', calendar_set: false, caldav: false, stale_days: 14, night_start: 22, night_end: 6 };
  try { var sc = JSON.parse(store.get('settingsCache') || 'null'); if (sc) for (var sk in sc) if (sc.hasOwnProperty(sk)) settings[sk] = sc[sk]; } catch (e) {}
  var pv = null, autoPrev = false, sess = null, setDraft = null, pendingOpen = null, itemsSaving = false, itemsDirty = false;
  var filterCat = store.get('filterCat') || null, glance = null, rv = null, autoChecked = false;
  var editing = null, showDone = false, showLow = false, themeMode = store.get('themeMode') || 'auto';
  var mode = store.get('listMode') === 'work' ? 'work' : 'personal';
  var appliedNight = null, idle = false, idleTicks = 0, clockSkip = 0, askCb = null, lastCalSync = 0, calBusy = false;
  var view = 'tasks', railOpen = store.get('railOpen') === '1', ptPick = null, tmEvents = null, settingsTab = 'general';
  var App = window.App = { views: {}, hooks: {}, tabs: {}, tabList: [] };

  function $(id) { return document.getElementById(id); }
  function setHTML(el, h) { if (el._h === h) return false; el._h = h; el.innerHTML = h; return true; } // only touch the DOM when something changed (stops flicker)
  function inBacklog(t) { return (t.list || 'personal') === 'personal' && !!t.pproject_id && !!t.pp_backlog; } // project Backlog: only on its project page
  function inMode(t) { return (t.list || 'personal') === mode && !inBacklog(t); }
  function setMode(m) {
    if (m === mode) return;
    mode = m; store.set('listMode', m);
    filterCat = null; store.del('filterCat');
    applyTheme(); render();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- dates ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function localISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isoToUTC(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diffDays(a, b) { return Math.round((isoToUTC(a) - isoToUTC(b)) / 86400000); }
  function addDays(iso, n) {
    var d = new Date(isoToUTC(iso) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function dowOf(iso) { return new Date(isoToUTC(iso)).getUTCDay(); }
  function nextMonday(iso) { return addDays(iso, ((8 - dowOf(iso)) % 7) || 7); }
  function fmtDate(iso) { var p = iso.split('-'); return DOWS[dowOf(iso)] + ' ' + (+p[2]) + ' ' + MONS[+p[1] - 1]; }
  function curToday() { return today || localISO(new Date()); }
  function parseTS(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
  }
  function nowMs() { return Date.now() + serverOffset; }

  /* ---------- network ---------- */
  function api(method, qs, body, cb, path) {
    var x = new XMLHttpRequest();
    var url = (path || '/api/todos') + (qs || '');
    if (method === 'GET') url += (qs ? '&' : '?') + '_=' + Date.now();
    x.open(method, url, true);
    x.setRequestHeader('x-todo-token', token);
    if (body) x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var d = null;
      try { d = JSON.parse(x.responseText); } catch (e) {}
      cb(x.status, d);
    };
    x.send(body ? JSON.stringify(body) : null);
  }

  function load() {
    if (!token || inflight || editing || rv || sess || setDraft || pv || drag || askCb) return;
    inflight = true;
    api('GET', '', null, function (status, data) {
      inflight = false;
      if (status === 200 && data) {
        if (Date.now() - lastMutation > 2500) todos = data.todos || [];
        today = data.today || today;
        if (data.now) { var t = Date.parse(data.now); if (!isNaN(t)) serverOffset = t - Date.now(); }
        loaded = true; online = true;
        render();
        maybeAutoReview();
        maybeAutoPreview();
        maybeOpenPending();
        maybeCalSync();
      } else if (status === 401) {
        showGate('That token was not accepted.');
      } else {
        online = false; render();
      }
    });
  }

  /* ---------- data helpers ---------- */
  function find(id) {
    for (var i = 0; i < todos.length; i++) if (todos[i].id === id) return todos[i];
    return null;
  }
  function merge(rec) {
    for (var i = 0; i < todos.length; i++) if (todos[i].id === rec.id) { todos[i] = rec; return; }
    todos.push(rec);
  }
  function remove(id) {
    for (var i = 0; i < todos.length; i++) if (todos[i].id === id) { todos.splice(i, 1); return; }
  }
  function byCreated(a, b) { return parseTS(a.created_at) - parseTS(b.created_at); }
  function byDue(a, b) { return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : byCreated(a, b); }

  function recurText(t) { return (RLABEL[t.recur] || t.recur) + (t.recur_until ? ' until ' + fmtDate(t.recur_until) : ''); }
  var RLABEL = { daily: 'daily', weekdays: 'weekdays', weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly', yearly: 'yearly' };
  function staleText() { var d = settings.stale_days || 14; return d % 7 === 0 && d >= 14 ? (d / 7) + ' weeks' : d + ' days'; }
  function sessCounts(t) {
    var it = t.items || [], n = 0;
    for (var i = 0; i < it.length; i++) if (it[i].d) n++;
    return { done: n, total: it.length };
  }
  function subChip(t, clickable) { // "2/5" for a normal task that has sub-tasks
    if (t.is_session || !t.items || !t.items.length) return '';
    var c = sessCounts(t);
    return '<span class="cat"' + (clickable ? ' data-act="sess" data-id="' + esc(t.id) + '"' : '') + ' title="Sub-tasks">☑ ' + c.done + '/' + c.total + '</span>';
  }
  function fmtTime(s) {
    if (!s) return '';
    var p = s.split(':'), h = +p[0], m = p[1], ap = h < 12 ? 'am' : 'pm';
    h = h % 12 || 12;
    return h + (m === '00' ? '' : ':' + m) + ap;
  }
  function timeOf(t) { return t.remind_time ? t.remind_time.slice(0, 5) : ''; }
  function tonight(t) { return !t.done && !t.paused && !isShelved(t) && !isFocus(t) && !!t.due_date && t.due_date < curToday(); } // carried over from an earlier day
  function planNo(t) { // position in today's order among the tasks still to do, so finishing one moves the rest up. "Finish tonight" tasks and today's tasks are numbered separately.
    if (t.done || t.plan_date !== curToday() || !t.plan_order) return 0;
    var n = 1, i, o, l = t.list || 'personal', tn = tonight(t);
    for (i = 0; i < todos.length; i++) {
      o = todos[i];
      if (o !== t && !o.done && o.plan_date === curToday() && o.plan_order && (o.list || 'personal') === l && tonight(o) === tn && o.plan_order < t.plan_order) n++;
    }
    return n;
  }
  function planCmp(a, b, fb) {
    var pa = planNo(a), pb = planNo(b);
    if (pa && pb) return pa - pb;
    if (pa) return -1;
    if (pb) return 1;
    return fb(a, b);
  }
  function byTimeThenCreated(a, b) {
    var ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (tb && !ta) return 1;
    return byCreated(a, b);
  }
  function isFocus(t) { return !t.done && t.focus_date === curToday(); }
  function isPaused(t) { return !!t.paused && !t.done && t.list === 'work'; } // waiting on someone else: out of Overdue and the counts
  /* Personal Projects (pprojects.js loads them). A Personal task in a project that is Paused, Not Pursued or Shut Down is "shelved":
     like a paused Work task it stays out of Overdue, the badges, the counts, Today's order and the review nudges. */
  var pprojs = [], ppStat = {}, ppName = {}, ppSig = '', showShelved = false;
  function isShelved(t) { return !t.done && (t.list || 'personal') === 'personal' && !!t.pproject_id && !!ppStat[t.pproject_id] && ppStat[t.pproject_id] !== 'active'; }
  function isOut(t) { return isPaused(t) || isShelved(t) || inBacklog(t); }
  function pausedAge(t) { var d = Math.floor((nowMs() - parseTS(t.paused_at)) / 86400000); return d < 1 ? 'today' : d + 'd'; }
  /* Work list auto-order: timed first, then "must do today", then priority (!!! first, unmarked, ! last), then quick wins, then oldest. */
  function isMust(t) { return !!t.must && !t.done && !t.paused && !!t.due_date && t.due_date <= curToday(); }
  function prioRank(t) { return t.prio === 3 ? 0 : t.prio === 2 ? 1 : t.prio === 1 ? 3 : 2; }
  /* Project priority and order (set on the Projects board). A High project's tasks come before a Medium project's at the same task
     priority; tasks of a paused project sink; and within one project the board's hand-set order is kept. */
  var projPrio = {}, projOrder = {}, projSig = '';
  function projPrioOf(t) { return t.list === 'work' && t.category ? (projPrio[t.category] || 0) : 0; }
  function projSlots(arr, segFn) { // each project's tasks keep their places in the list but swap into the project's own order
    var groups = {}, k, i, t, key;
    for (i = 0; i < arr.length; i++) {
      t = arr[i];
      if (t.list !== 'work' || !t.category || !projOrder[t.category] || planNo(t)) continue;
      key = (segFn ? segFn(t) : '') + '|' + t.category;
      (groups[key] = groups[key] || []).push(i);
    }
    for (k in groups) if (groups.hasOwnProperty(k) && groups[k].length > 1) {
      var idx = groups[k], ord = projOrder[arr[idx[0]].category], pos = {}, items = [], j;
      for (j = 0; j < ord.length; j++) pos[ord[j]] = j + 1;
      for (j = 0; j < idx.length; j++) items.push({ t: arr[idx[j]], n: j });
      items.sort(function (a, b) {
        var x = pos[a.t.id] || 0, y = pos[b.t.id] || 0;
        if (x && y) return x - y;
        if (x) return -1;
        if (y) return 1;
        return a.n - b.n;
      });
      for (j = 0; j < idx.length; j++) arr[idx[j]] = items[j].t;
    }
  }
  function segTonight(t) { return isFocus(t) ? 'f' : tonight(t) ? 't' : 'n'; }
  function autoCmp(a, b) {
    var ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (tb && !ta) return 1;
    var ma = isMust(a) ? 0 : 1, mb = isMust(b) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    var pa = prioRank(a), pb = prioRank(b);
    if (pa !== pb) return pa - pb;
    var ja = projPrioOf(a), jb = projPrioOf(b);
    if (ja !== jb) return jb - ja;
    var qa = a.quick ? 0 : 1, qb = b.quick ? 0 : 1;
    if (qa !== qb) return qa - qb;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return byCreated(a, b);
  }
  function dayCmp(a, b) { return (a.list === 'work' && b.list === 'work') ? autoCmp(a, b) : byTimeThenCreated(a, b); }
  function overdueCmp(a, b) { return (a.list === 'work' && b.list === 'work') ? autoCmp(a, b) : byDue(a, b); }
  function blockedAge(t) { var d = Math.floor((nowMs() - parseTS(t.blocked_at)) / 86400000); return d < 1 ? 'today' : d + 'd'; }
  function tagChips(t) {
    if (t.done || t.list !== 'work') return '';
    var h = '';
    if (t.prio > 0) h += '<span class="pr p' + t.prio + '" title="Priority">' + new Array(t.prio + 1).join('!') + '</span>';
    if (t.quick) h += '<span class="qk" title="Quick win">⚡ Quick</span>';
    if (isMust(t)) h += '<span class="mst">Must today</span>';
    if (t.blocked) h += '<span class="blk">Blocked' + (t.blocked_at ? ' · ' + blockedAge(t) : '') + '</span>';
    if (isPaused(t)) h += '<span class="pau">⏸ Waiting' + (t.paused_on ? ': ' + esc(t.paused_on) : '') + (t.paused_at ? ' · ' + pausedAge(t) : '') + '</span>';
    return h;
  }
  function ageDays(t) {
    var ref = Math.max(parseTS(t.created_at), parseTS(t.reviewed_at));
    return Math.floor((nowMs() - ref) / 86400000);
  }
  function isStale(t) { return !t.done && !t.low && !t.due_date && !isFocus(t) && !t.is_session && ageDays(t) >= (settings.stale_days || 14); }
  function doneTodayCount() {
    var n = 0, t0 = curToday();
    for (var i = 0; i < todos.length; i++) if (inMode(todos[i]) && !todos[i].low && todos[i].done && todos[i].done_at && localISO(new Date(parseTS(todos[i].done_at))) === t0) n++;
    return n;
  }

  function groups() {
    var t0 = curToday(), g = { focus: [], overdue: [], today: [], soon: [], whenever: [], done: [], low: [], blocked: [], paused: [], shelved: [], open: 0, dueNow: 0, stale: [] };
    for (var i = 0; i < todos.length; i++) {
      var t = todos[i];
      if (!inMode(t)) continue;
      if (t.done) { if (!t.low) g.done.push(t); continue; }
      if (t.low && !t.due_date) { if (!filterCat || t.category === filterCat) g.low.push(t); continue; } // non-urgent: kept out of the counts
      if (isShelved(t)) { if (!filterCat || t.category === filterCat) g.shelved.push(t); continue; } // project on hold: out of Overdue and every count
      if (isPaused(t)) { if (!filterCat || t.category === filterCat) g.paused.push(t); continue; } // paused: out of Overdue and every count
      g.open++;
      if (t.blocked && t.list === 'work') { if (!filterCat || t.category === filterCat) g.blocked.push(t); continue; } // blocked: out of Overdue and the counts
      if (isFocus(t)) { g.focus.push(t); g.dueNow++; continue; }
      if (t.due_date && t.due_date <= t0) g.dueNow++;
      if (isStale(t)) g.stale.push(t);
      if (filterCat && t.category !== filterCat) continue;
      if (!t.due_date) g.whenever.push(t);
      else if (t.due_date < t0) g.overdue.push(t);
      else if (t.due_date === t0) g.today.push(t);
      else g.soon.push(t);
    }
    g.focus.sort(function (a, b) { return planCmp(a, b, byTimeThenCreated); });
    g.overdue.sort(function (a, b) { return planCmp(a, b, overdueCmp); });
    g.today.sort(function (a, b) { return planCmp(a, b, dayCmp); });
    projSlots(g.overdue); projSlots(g.today);
    g.soon.sort(function (a, b) { var c = byDue(a, b); return c === 0 ? byTimeThenCreated(a, b) : c; });
    g.whenever.sort(function (a, b) { return byCreated(b, a); });
    g.done.sort(function (a, b) { return parseTS(b.done_at) - parseTS(a.done_at); });
    g.stale.sort(byCreated);
    g.blocked.sort(function (a, b) { return parseTS(a.blocked_at) - parseTS(b.blocked_at); });
    g.paused.sort(function (a, b) { return parseTS(a.paused_at) - parseTS(b.paused_at); });
    g.low.sort(function (a, b) { return byCreated(b, a); });
    return g;
  }

  /* ---------- rendering ---------- */
  function itemHTML(t, big) {
    var meta = '', t0 = curToday(), id = esc(t.id), quick = '', overdue = false, onPP = view === 'pprojects';
    if (!t.done && t.due_date) {
      var d = diffDays(t.due_date, t0);
      if (isPaused(t)) meta += '<span class="due">' + fmtDate(t.due_date) + '</span>';
      else if (d < 0) { overdue = true; meta += '<span class="due overdue">Overdue · ' + fmtDate(t.due_date) + '</span>'; }
      else if (d === 1) meta += '<span class="due">Tomorrow</span>';
      else if (d > 1) meta += '<span class="due">' + fmtDate(t.due_date) + '</span>';
    }
    meta += tagChips(t);
    if (!t.done && t.remind_time) meta += '<span class="rem">⏰ ' + fmtTime(timeOf(t)) + '</span>';
    if (t.recur) meta += '<span class="recur">↻ ' + recurText(t) + '</span>';
    var stale = isStale(t);
    if (stale) {
      var ad = ageDays(t);
      meta += '<span class="stale">⏳ ' + (ad >= 14 ? Math.floor(ad / 7) + 'w' : ad + 'd') + '</span>';
    }
    if (t.category) meta += '<span class="cat">' + esc(t.category) + '</span>';
    if (!onPP && t.pproject_id && ppName[t.pproject_id] && (t.list || 'personal') === 'personal') meta += '<span class="cat pjc">▣ ' + esc(ppName[t.pproject_id]) + (isShelved(t) ? ' · on hold' : '') + '</span>';
    if (t.notes) meta += '<span class="cat" title="Has notes">📝 notes</span>';
    meta += subChip(t, !t.done);
    var unb = '';
    if (t.blocked && !t.done) unb = '<div class="unb"><b>Unblock:</b> ' + (t.unblock_action ? esc(t.unblock_action) : '<i>no action set</i>') + ' <button class="chip" data-act="unblock" data-id="' + id + '">Unblocked</button></div>';
    if (isPaused(t)) unb = '<div class="unb"><b>Waiting on:</b> ' + (t.paused_on ? esc(t.paused_on) : '<i>not noted</i>') + ' <button class="chip" data-act="resume" data-id="' + id + '">Resume</button></div>';
    if (onPP && !t.done && t.pproject_id) meta += t.pp_backlog ? '<button class="chip" data-act="ppbl" data-val="0" data-id="' + id + '">→ Add to my list</button>' : '<button class="chip" data-act="ppbl" data-val="1" data-id="' + id + '">→ Back to backlog</button>';
    if (!onPP && !t.done && !big && !t.due_date && !t.is_session) {
      meta += t.low ? '<button class="chip" data-act="low" data-val="0" data-id="' + id + '">Make urgent</button>' : '<button class="chip" data-act="low" data-val="1" data-id="' + id + '">Non-urgent</button>';
    }
    if (!onPP && !t.done && !big && ((!t.due_date && nowMs() - parseTS(t.created_at) < 30 * 60000) || overdue)) {
      var wo = overdue ? moveOpts() : whenOpts(), qb = '';
      for (var q = 0; q < wo.length; q++) {
        qb += '<button class="chip" data-act="quick" data-when="' + wo[q][0] + '" data-id="' + id + '">' + wo[q][1] + '</button>';
      }
      quick = '<div class="quick"><span class="qlabel">' + (overdue ? 'Move to' : 'When?') + '</span>' + qb + '</div>';
    }
    var focus = isFocus(t), sbadge = '', sprog = '';
    if (t.is_session) {
      var sc2 = sessCounts(t);
      sbadge = '<span class="sbadge">SESSION</span>';
      sprog = '<div class="meta">' + (sc2.total ? sc2.done + ' of ' + sc2.total + ' done' : 'Tap to add tasks') + '</div>' +
        (sc2.total ? '<div class="sprog"><i style="width:' + Math.round(sc2.done * 100 / sc2.total) + '%"></i></div>' : '');
    }
    return '<li class="' + (big ? 'fitem' : 'item' + (t.done ? ' done' : '') + (stale ? ' old' : '')) + (t.is_session ? ' session' : '') + '" id="i-' + id + '">' +
      '<button class="tick" data-act="tick" data-id="' + id + '" aria-label="Toggle done"></button>' +
      '<div class="body" data-act="' + (t.is_session && !t.done ? 'sess' : 'edit') + '" data-id="' + id + '">' +
      '<div class="title">' + (planNo(t) ? '<span class="pn">' + planNo(t) + '</span>' : '') + sbadge + esc(t.title) + '</div>' + sprog +
      (meta ? '<div class="meta">' + meta + '</div>' : '') + unb + quick + '</div>' +
      (t.done || inBacklog(t) ? '' : '<button class="star' + (focus ? ' on' : '') + '" data-act="star" data-id="' + id + '" aria-label="Today\'s focus">' + (focus ? '★' : '☆') + '</button>') +
      '</li>';
  }
  function listHTML(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) s += itemHTML(arr[i]);
    return '<ul class="list">' + s + '</ul>';
  }

  function glanceHTML() {
    if (!glance) return '';
    var h = '', w = glance.weather, ev = glance.events;
    if (w) {
      h += '<span class="gw">' + (w.icon ? w.icon + ' ' : '') + w.temp + '°' + (w.text ? ' ' + esc(w.text) : '') +
        ' · H' + w.hi + '° L' + w.lo + '°' + (w.rain !== null && w.rain >= 30 ? ' · rain ' + w.rain + '%' : '') + '</span>';
    }
    if (glance.calendar) {
      if (ev && ev.length) {
        var nm = new Date().getHours() * 60 + new Date().getMinutes();
        for (var i = 0; i < ev.length && i < 5; i++) {
          var e = ev[i], past = false;
          if (!e.allDay && e.e) { var p = e.e.split(':'); past = (+p[0]) * 60 + (+p[1]) < nm; }
          h += '<span class="ev' + (past ? ' past' : '') + '">' + (e.allDay ? '' : '<b>' + e.s + '</b>') + esc(e.title) + '</span>';
        }
        if (ev.length > 5) h += '<span class="ev none">+' + (ev.length - 5) + ' more</span>';
      } else if (glance.calendarError) h += '<span class="ev none">Calendar unavailable</span>';
      else h += '<span class="ev none">No events today</span>';
    }
    return h;
  }

  function filtersHTML(counts) {
    var cats = [], seen = {}, i, h = '';
    var order = allCats();
    for (i = 0; i < order.length; i++) if (counts[order[i]]) cats.push(order[i]);
    if (!cats.length) return '';
    if (filterCat && !counts[filterCat]) { filterCat = null; store.del('filterCat'); }
    h += '<button class="chip' + (!filterCat ? ' on' : '') + '" data-act="filter" data-val="">All</button>';
    for (i = 0; i < cats.length; i++) {
      h += '<button class="chip' + (filterCat === cats[i] ? ' on' : '') + '" data-act="filter" data-val="' + esc(cats[i]) + '">' + esc(cats[i]) + ' ' + counts[cats[i]] + '</button>';
    }
    return h;
  }

  function setCls(el, c) { if (el && el.className !== c) el.className = c; }
  function renderChrome() {
    var t0 = curToday(), p = t0.split('-'), dueBy = { personal: 0, work: 0 }, c, tc;
    var dtxt = DOWL[dowOf(t0)] + ' ' + (+p[2]) + ' ' + MONL[+p[1] - 1] + (view === 'tasks' && mode === 'work' ? ' · Work' : '');
    if ($('date').textContent !== dtxt) $('date').textContent = dtxt;
    for (c = 0; c < todos.length; c++) {
      tc = todos[c];
      if (tc.done || tc.blocked || isOut(tc)) continue;
      if (isFocus(tc) || (tc.due_date && tc.due_date <= t0)) dueBy[tc.list === 'work' ? 'work' : 'personal']++;
    }
    setHTML($('bPersonal'), loaded && dueBy.personal ? '' + dueBy.personal : '');
    setHTML($('bWork'), loaded && dueBy.work ? '' + dueBy.work : '');
    setCls($('nPersonal'), 'ritem' + (view === 'tasks' && mode === 'personal' ? ' on' : ''));
    setCls($('nWork'), 'ritem' + (view === 'tasks' && mode === 'work' ? ' on' : ''));
    setCls($('nPlan'), 'ritem' + (view === 'plan' ? ' on' : ''));
    setCls($('nBudget'), 'ritem' + (view === 'budget' ? ' on' : ''));
    setCls($('nInsights'), 'ritem' + (view === 'insights' ? ' on' : ''));
    setCls($('nBoard'), 'ritem' + (view === 'board' ? ' on' : ''));
    setCls($('nPprojects'), 'ritem' + (view === 'pprojects' ? ' on' : ''));
    if (document.body.getAttribute('data-view') !== view) document.body.setAttribute('data-view', view);
    var bc = railOpen ? 'rail-open' : '';
    if (document.body.className !== bc) document.body.className = bc;
    if (view !== 'tasks' && view !== 'plan') setHTML($('viewTitle'), esc((App.views[view] && App.views[view].title) || ''));
  }
  function render() {
    renderChrome();
    if (view === 'tasks') renderTasks();
    else if (view === 'plan') renderPlan();
    else if (App.views[view] && App.views[view].render) App.views[view].render();
  }
  function waiters(g) { // Work tasks for today that are not marked "Must do today" (timed ones stay where they are)
    var out = [], all = g.overdue.concat(g.today), i;
    for (i = 0; i < all.length; i++) if (!isMust(all[i]) && !timeOf(all[i]) && !all[i].is_session) out.push(all[i]);
    return out;
  }
  function workToolsHTML(g) {
    var n = g.overdue.length + g.today.length, nm = 0, i, all = g.overdue.concat(g.today), w = waiters(g), h = '';
    for (i = 0; i < all.length; i++) if (isMust(all[i])) nm++;
    if (n < 2 && !nm) return '';
    h += '<div class="worktools">';
    if (n > 1) h += '<button class="chip" data-act="sortday">⇅ Sort my day</button>';
    if (nm && w.length) h += '<button class="chip" data-act="pushrest">Push ' + w.length + ' can-wait to tomorrow</button>';
    h += '</div>';
    if (nm) h += '<span class="wtsum">' + nm + ' must-do today · ' + (n - nm) + ' can wait if needed</span>';
    return h;
  }
  function sortDay() { // put today's Work tasks in the automatic order and save it, replacing any earlier hand-ordering
    var t0 = curToday(), foc = [], rest = [], i, t, ids = [];
    for (i = 0; i < todos.length; i++) {
      t = todos[i];
      if (!inMode(t) || t.done || t.blocked || isOut(t)) continue;
      if (isFocus(t)) foc.push(t); else if (t.due_date && t.due_date <= t0) rest.push(t);
    }
    foc.sort(function (a, b) { return planCmp(a, b, byTimeThenCreated); });
    rest.sort(function (a, b) { var ga = tonight(a) ? 0 : 1, gb = tonight(b) ? 0 : 1; return ga !== gb ? ga - gb : autoCmp(a, b); });
    projSlots(rest, segTonight);
    var all = foc.concat(rest);
    for (i = 0; i < all.length; i++) { all[i].plan_order = i + 1; all[i].plan_date = t0; ids.push(all[i].id); }
    lastMutation = Date.now();
    render();
    api('POST', '', { plan: ids, list: mode }, function (st) {
      if (st !== 200) toast('Could not save the order, check your connection'); else lastMutation = Date.now();
    });
    if (App.afterPlan) App.afterPlan(ids, mode);
    toast('Sorted: must-do first, then priority and quick wins');
  }
  function pushRest() {
    var g = groups(), w = waiters(g);
    if (!w.length) return;
    ask({ title: 'Push ' + w.length + (w.length === 1 ? ' task' : ' tasks') + ' to tomorrow?', text: 'Everything today that isn’t marked Must today (timed tasks stay).',
      buttons: [{ label: 'Push to tomorrow', primary: true }, { label: 'Cancel' }] }, function (i) {
      if (i !== 0) return;
      for (var k = 0; k < w.length; k++) doQuick(w[k].id, 'tomorrow');
      toast('Moved to tomorrow');
    });
  }
  function renderTasks() {
    var g = groups(), t0 = curToday();
    var doneT = doneTodayCount(), total = doneT + g.dueNow;
    setHTML($('stats'), (loaded ? g.open + ' open' + (g.done.length ? ' · ' + g.done.length + ' done this week' : '') : 'Loading…') +
      (online ? '' : ' · <span class="off">offline, retrying</span>'));

    var counts = {};
    for (var c = 0; c < todos.length; c++) {
      var tc = todos[c];
      if (tc.done) continue;
      if (tc.category && !tc.low && !isShelved(tc) && inMode(tc)) counts[tc.category] = (counts[tc.category] || 0) + 1;
    }
    setHTML($('glance'), glanceHTML());
    setHTML($('filters'), loaded ? filtersHTML(counts) : '');

    var fh = '';
    if (g.focus.length) {
      fh = '<div class="fh">★ Today’s focus<span>' + g.focus.length + ' of 3</span></div><ul class="flist">';
      for (var f = 0; f < g.focus.length; f++) fh += itemHTML(g.focus[f], true);
      fh += '</ul>';
    }
    setHTML($('focus'), fh);

    var h = '', hB = '', hC = '';
    h += '<h2>Today<span class="count">' + (g.overdue.length + g.today.length) + '</span></h2>';
    if (loaded && total > 0) {
      h += '<div class="prog"><i style="width:' + Math.round(doneT * 100 / total) + '%"></i></div>' +
        '<div class="progtxt">' + (doneT >= total ? 'All done today ✓' : doneT + ' of ' + total + ' done today') + '</div>';
    }
    if (loaded && mode === 'work') h += workToolsHTML(g);
    if (!loaded) h += '<p class="empty">Loading…</p>';
    else {
      if (g.overdue.length) {
        h += '<div class="sub alert">Overdue</div>' + listHTML(g.overdue);
        if (g.today.length) h += '<div class="sub">Today</div>';
      }
      if (g.today.length) h += listHTML(g.today);
      else if (!g.overdue.length) h += '<p class="empty">' + (g.focus.length ? 'Just your focus items.' : 'Nothing due today.') + '</p>';
    }
    hB += '<h2>Coming up<span class="count">' + g.soon.length + '</span></h2>';
    hB += g.soon.length ? listHTML(g.soon) : (loaded ? '<p class="empty">Nothing scheduled.</p>' : '');
    if (loaded && mode === 'work' && g.blocked.length) hC += '<h2>Blocked<span class="count">' + g.blocked.length + '</span></h2><div class="wtsum">Out of Overdue and your counts until unblocked.</div>' + listHTML(g.blocked);
    if (loaded && mode === 'work' && g.paused.length) hC += '<h2>Paused<span class="count">' + g.paused.length + '</span></h2><div class="wtsum">Waiting on other people. Out of Overdue and your counts until you resume.</div>' + listHTML(g.paused);
    if (loaded && mode === 'personal' && g.shelved.length) {
      hC += '<button class="donebtn" data-act="toggleshelved">' + (showShelved ? '▾' : '▸') + ' On-hold projects (' + g.shelved.length + ')</button>';
      if (showShelved) hC += '<div class="wtsum">In projects that are paused, not pursued or shut down. Out of Overdue and your counts.</div>' + listHTML(g.shelved);
    }
    hC += '<h2>Whenever<span class="count">' + g.whenever.length + '</span></h2>';
    if (loaded && g.stale.length) {
      hC += '<div class="nudge">⏳ ' + g.stale.length + (g.stale.length === 1 ? ' item has' : ' items have') + ' been parked for ' + staleText() + '+. Still relevant?<br>' +
        '<button class="chip" data-act="review">Review ' + (g.stale.length === 1 ? 'it' : 'them') + '</button></div>';
    }
    hC += g.whenever.length ? listHTML(g.whenever) : (loaded ? '<p class="empty">Nothing parked here.</p>' : '');
    if (g.low.length) {
      hC += '<button class="donebtn" data-act="togglelow">' + (showLow ? '▾' : '▸') + ' Non-urgent (' + g.low.length + ')</button>';
      if (showLow) hC += listHTML(g.low);
    }
    if (g.done.length) {
      hC += '<button class="donebtn" data-act="toggledone">' + (showDone ? '▾' : '▸') + ' Done this week (' + g.done.length + ')</button>';
      if (showDone) hC += listHTML(g.done);
    }

    var colEls = [$('colA'), $('colB'), $('colC')], hs = [h, hB, hC], pageY = window.pageYOffset;
    for (var j = 0; j < 3; j++) {
      var keepTop = colEls[j].scrollTop;
      if (setHTML(colEls[j], hs[j])) colEls[j].scrollTop = keepTop;
    }
    if (window.pageYOffset !== pageY) window.scrollTo(0, pageY);
  }
  /* ---------- navigation ---------- */
  var VIEW_IDS = { tasks: 'vTasks', plan: 'vPlan', budget: 'vBudget', insights: 'vInsights', board: 'vBoard', pprojects: 'vPprojects' };
  function navTo(name) {
    var next = (name === 'personal' || name === 'work') ? 'tasks' : name;
    if (next !== 'tasks' && next !== 'plan' && !App.views[next]) { toast('Not available yet'); return; }
    if (next === 'tasks' && name !== mode) {
      mode = name; store.set('listMode', name);
      filterCat = null; store.del('filterCat');
      applyTheme();
    }
    view = next;
    for (var k in VIEW_IDS) if (VIEW_IDS.hasOwnProperty(k)) setCls($(VIEW_IDS[k]), 'view' + (k === view ? ' on' : ''));
    render();
    window.scrollTo(0, 0);
    if (view === 'plan') loadTomorrow();
    if (App.views[view] && App.views[view].show) App.views[view].show();
  }
  function toggleRail() {
    railOpen = !railOpen; store.set('railOpen', railOpen ? '1' : '0');
    renderChrome();
  }

  /* ---------- plan tomorrow ---------- */
  function tomorrow() { return addDays(curToday(), 1); }
  function ptList() {
    var t1 = tomorrow(), arr = [], i;
    for (i = 0; i < todos.length; i++) {
      var t = todos[i];
      if (inMode(t) && !t.done && t.due_date === t1) arr.push(t);
    }
    arr.sort(function (a, b) {
      var pa = (a.plan_date === t1 && a.plan_order) ? a.plan_order : 0, pb = (b.plan_date === t1 && b.plan_order) ? b.plan_order : 0;
      if (pa && pb) return pa - pb;
      if (pa) return -1;
      if (pb) return 1;
      return byTimeThenCreated(a, b);
    });
    return arr;
  }
  function pickHTML(kind, i, n) {
    var h = '<div class="pvpick"><span class="qlabel">Move to position</span>';
    for (var pp = 0; pp < n; pp++) if (pp !== i) h += '<button class="chip" data-act="' + kind + 'to" data-i="' + i + '" data-to="' + pp + '">' + (pp + 1) + '</button>';
    return h + '</div>';
  }
  function ptRowHTML(t, i, n) {
    var meta = tagChips(t);
    if (t.remind_time) meta += '<span class="rem">⏰ ' + fmtTime(timeOf(t)) + '</span>';
    if (t.recur) meta += '<span class="recur">↻ ' + recurText(t) + '</span>';
    if (t.category) meta += '<span class="cat">' + esc(t.category) + '</span>';
    if (t.is_session) { var sc = sessCounts(t); meta += '<span class="cat">session' + (sc.total ? ' ' + sc.done + '/' + sc.total : '') + '</span>'; }
    meta += subChip(t, false);
    var h = '<div class="pvrow"><div class="pvgrip" aria-label="Drag to reorder">☰</div>' +
      '<button class="pvnum" data-act="ptnum" data-i="' + i + '" aria-label="Move to a position">' + (i + 1) + '</button>' +
      '<div class="pvmain" data-act="' + (t.is_session ? 'sess' : 'edit') + '" data-id="' + esc(t.id) + '"><div class="pvt">' + esc(t.title) + '</div>' + (meta ? '<div class="meta">' + meta + '</div>' : '') + '</div>' +
      '<div class="pvbtns"><button data-act="ptpush" data-id="' + esc(t.id) + '" aria-label="Push to the day after" title="Push to the day after">→</button></div></div>';
    if (ptPick === i) h += pickHTML('pt', i, n);
    return h;
  }
  function renderPlan() {
    var list = ptList(), t1 = tomorrow(), p = t1.split('-'), i, h = '';
    setHTML($('viewTitle'), 'Plan tomorrow<small>' + DOWL[dowOf(t1)] + ' ' + (+p[2]) + ' ' + MONL[+p[1] - 1] + '</small>');
    h += '<div class="toolbar"><div class="seg"><button class="' + (mode === 'personal' ? 'on' : '') + '" data-act="mode" data-val="personal">Personal</button>' +
      '<button class="' + (mode === 'work' ? 'on' : '') + '" data-act="mode" data-val="work">Work</button></div></div>';
    if (tmEvents && tmEvents.length) {
      var ev = [];
      for (i = 0; i < tmEvents.length && i < 3; i++) ev.push((tmEvents[i].allDay ? '' : tmEvents[i].s + ' ') + esc(tmEvents[i].title));
      h += '<div class="planline"><b>On your calendar</b> · ' + ev.join(' · ') + (tmEvents.length > 3 ? ' · +' + (tmEvents.length - 3) + ' more' : '') + '</div>';
    }
    h += loaded ? '<div class="rvsub">' + (list.length ? list.length + (list.length === 1 ? ' task is' : ' tasks are') + ' due tomorrow. Put them in the order you’ll do them; it becomes tomorrow’s Today order automatically.'
      : 'Nothing is scheduled for tomorrow yet. Add something below, or give an existing task tomorrow’s date.') + '</div>' : '<div class="rvsub">Loading…</div>';
    setHTML($('ptHead'), h);
    var rows = '';
    for (i = 0; i < list.length; i++) rows += ptRowHTML(list[i], i, list.length);
    setHTML($('ptRows'), rows);
    setHTML($('ptHint'), list.length > 1 ? 'Drag ☰ to reorder, or tap a number to jump to a position · → pushes a task to the day after.' : '');
  }
  var ptSaving = false, ptDirty = null;
  function ptSave(ids) {
    var t1 = tomorrow(), i, t;
    for (i = 0; i < ids.length; i++) { t = find(ids[i]); if (t) { t.plan_order = i + 1; t.plan_date = t1; } }
    lastMutation = Date.now();
    if (App.afterPlan) App.afterPlan(ids, mode);
    if (ptSaving) { ptDirty = ids; return; }
    ptSaving = true;
    api('POST', '', { plan: ids, list: mode, date: t1 }, function (st) {
      ptSaving = false;
      if (st !== 200) toast('Could not save the order, check your connection');
      if (ptDirty) { var d = ptDirty; ptDirty = null; ptSave(d); } else lastMutation = Date.now();
    });
  }
  function ptMove(i, j) {
    var list = ptList(), ids = [], k;
    if (i === j || j < 0 || j >= list.length) return;
    for (k = 0; k < list.length; k++) ids.push(list[k].id);
    var x = ids.splice(i, 1)[0];
    ids.splice(j, 0, x);
    ptPick = null; ptSave(ids); renderPlan();
  }
  function ptPush(id) {
    var t = find(id); if (!t) return;
    var before = { due_date: t.due_date };
    t.due_date = addDays(tomorrow(), 1);
    patchTodo(id, { due_date: t.due_date }, before);
    renderPlan(); render();
    toast('Moved to the day after');
  }
  function loadTomorrow() {
    if (!token) return;
    var x = new XMLHttpRequest();
    x.open('GET', '/api/glance?day=tomorrow&_=' + Date.now(), true);
    x.setRequestHeader('x-todo-token', token);
    x.timeout = 20000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || x.status !== 200) return;
      var j = null;
      try { j = JSON.parse(x.responseText); } catch (e) { return; }
      tmEvents = (j && j.day === 'tomorrow' && j.events) ? j.events : null;
      if (view === 'plan') renderPlan();
    };
    x.send(null);
  }
  function initPlan() {
    $('planPane').innerHTML = '<div id="ptHead"></div><div id="ptRows"></div>' +
      '<form class="addform" id="ptForm" autocomplete="off" style="margin-top:16px"><input id="ptInput" type="text" placeholder="Add something for tomorrow…" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" maxlength="500"><button type="submit">Add</button></form>' +
      '<div class="sethint" id="ptHint"></div>';
    bindDrag($('ptRows'), 'pt');
    $('ptForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('ptInput'), text = inp.value.replace(/^\s+|\s+$/g, '');
      if (!text || !token) return;
      inp.value = '';
      api('POST', '', { text: text + ' @tomorrow', list: mode }, function (s, d) {
        if (s === 201 && d && d.todo) {
          merge(d.todo); lastMutation = Date.now(); render();
          toast(inMode(d.todo) ? 'Added for tomorrow' : 'Added to ' + (d.todo.list === 'work' ? 'Work' : 'Personal'));
        } else { inp.value = text; toast('Could not add, try again'); }
      });
    }, false);
  }

  /* ---------- actions ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2200);
  }

  function whenToDate(w) {
    if (w === 'today') return curToday();
    if (w === 'tomorrow') return addDays(curToday(), 1);
    if (w === 'thisweek') return addDays(curToday(), (7 - dowOf(curToday())) % 7);
    if (w === 'weekend') { var dw = dowOf(curToday()); return addDays(curToday(), dw === 0 ? 6 : 6 - dw); }
    if (w === 'week') return nextMonday(curToday());
    return null;
  }
  function whenOpts() {
    var t0 = curToday(), tm = addDays(t0, 1), tw = whenToDate('thisweek');
    var o = [['today', 'Today'], ['tomorrow', 'Tomorrow']];
    if (tw !== t0 && tw !== tm) o.push(['thisweek', 'This week']);
    if (whenToDate('week') !== tm) o.push(['week', 'Next week']);
    return o;
  }

  function moveOpts() {
    var t0 = curToday(), tm = addDays(t0, 1), o = [['today', 'Today'], ['tomorrow', 'Tomorrow']], we = whenToDate('weekend');
    if (we !== t0 && we !== tm) o.push(['weekend', 'Weekend']);
    o.push(['week', 'Next week']);
    return o;
  }

  function patchTodo(id, patch, before) {
    lastMutation = Date.now();
    api('PATCH', '?id=' + encodeURIComponent(id), patch, function (s, d) {
      if (s === 200 && d && d.todo) {
        merge(d.todo); lastMutation = Date.now(); render();
        if (d.cal === 'error') toast('Saved, but Apple Calendar did not update');
        if (d.todo.recur && patch.hasOwnProperty('done')) { lastMutation = 0; load(); } // pick up the next repeat
      }
      else {
        var t = find(id);
        if (t && before) { for (var k in before) if (before.hasOwnProperty(k)) t[k] = before[k]; }
        render(); toast(s === 409 ? 'Focus is full, unstar one first' : 'Could not save, try again');
      }
    });
  }

  function doTick(id) {
    var t = find(id); if (!t) return;
    var row = $('i-' + id), newDone = !t.done;
    if (row && newDone) row.className += ' completing';
    var before = { done: t.done, done_at: t.done_at };
    lastMutation = Date.now();
    setTimeout(function () {
      t.done = newDone; t.done_at = newDone ? new Date().toISOString() : null; render();
    }, newDone ? 450 : 0);
    patchTodo(id, { done: newDone }, before);
  }

  function doLow(id, on) {
    var t = find(id); if (!t) return;
    var before = { low: !!t.low };
    t.low = on; render();
    patchTodo(id, { low: on }, before);
    toast(on ? 'Marked non-urgent' : 'Back on your list');
  }

  function doQuick(id, when) {
    var t = find(id); if (!t) return;
    var before = { due_date: t.due_date };
    t.due_date = whenToDate(when); render();
    patchTodo(id, { due_date: t.due_date }, before);
  }

  function focusCount(exceptId) {
    var n = 0;
    for (var i = 0; i < todos.length; i++) if (inMode(todos[i]) && isFocus(todos[i]) && todos[i].id !== exceptId) n++;
    return n;
  }
  function toggleStar(id) {
    var t = find(id); if (!t) return;
    var before = { focus_date: t.focus_date || null };
    if (isFocus(t)) { t.focus_date = null; render(); patchTodo(id, { focus: false }, before); return; }
    if (focusCount(id) >= 3) { toast('Focus is full (3), unstar one first'); return; }
    t.focus_date = curToday(); render(); patchTodo(id, { focus: true }, before);
  }

  /* edit sheet */
  function allCats() {
    var seen = {}, out = [], i;
    for (i = 0; i < DEFAULT_CATS.length; i++) { seen[DEFAULT_CATS[i]] = 1; out.push(DEFAULT_CATS[i]); }
    for (i = 0; i < todos.length; i++) {
      var c = todos[i].category;
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    }
    return out;
  }
  function frow(label, ctl) { return '<div class="frow"><div class="flbl">' + label + '</div><div class="fctl">' + ctl + '</div></div>'; }
  function renderSheet() {
    var due = editing.due, w = '', isWork = editing.list === 'work', st = find(editing.id), i;
    var opts = whenOpts().concat([['none', 'No date']]);
    for (i = 0; i < opts.length; i++) {
      var val = whenToDate(opts[i][0]);
      var on = opts[i][0] === 'none' ? !due : (due === val);
      w += '<button class="chip' + (on ? ' on' : '') + '" data-act="swhen" data-val="' + opts[i][0] + '">' + opts[i][1] + '</button>';
    }
    $('eWhen').innerHTML = w;
    $('eDate').value = due || '';
    var cats = allCats(), c = '';
    for (i = 0; i < cats.length; i++) c += '<button class="chip' + (editing.cat === cats[i] ? ' on' : '') + '" data-act="scat" data-val="' + esc(cats[i]) + '">' + esc(cats[i]) + '</button>';
    $('eCats').innerHTML = c;
    var pc = '', showPP = editing.list === 'personal' && (pprojs.length || editing.pp);
    if (showPP) {
      pc = '<button class="chip' + (!editing.pp ? ' on' : '') + '" data-act="sproj" data-val="">None</button>';
      for (i = 0; i < pprojs.length; i++) if (pprojs[i].status === 'active' || pprojs[i].id === editing.pp) {
        pc += '<button class="chip' + (editing.pp === pprojs[i].id ? ' on' : '') + '" data-act="sproj" data-val="' + esc(pprojs[i].id) + '">' + esc(pprojs[i].name) + (pprojs[i].status !== 'active' ? ' (on hold)' : '') + '</button>';
      }
    }
    if (showPP && editing.pp) pc += '<div class="sg sm ppwhere"><button class="' + (!editing.bl ? 'on' : '') + '" data-act="sppbl" data-val="0">In my list</button><button class="' + (editing.bl ? 'on' : '') + '" data-act="sppbl" data-val="1">Backlog only</button></div>';
    $('eProj').innerHTML = pc;
    $('ePRow').style.display = showPP ? '' : 'none';
    var rc = '<button class="chip' + (!editing.recur ? ' on' : '') + '" data-act="srecur" data-val="">None</button>';
    for (var r in RLABEL) if (RLABEL.hasOwnProperty(r)) {
      rc += '<button class="chip' + (editing.recur === r ? ' on' : '') + '" data-act="srecur" data-val="' + r + '">' + RLABEL[r].charAt(0).toUpperCase() + RLABEL[r].slice(1) + '</button>';
    }
    $('eRecur').innerHTML = rc;
    $('eEnd').innerHTML = editing.recur ? '<span class="inl">Ends</span><button class="chip' + (!editing.untilOn ? ' on' : '') + '" data-act="suntil" data-val="never">Never</button>' +
      '<button class="chip' + (editing.untilOn ? ' on' : '') + '" data-act="suntil" data-val="date">' + (editing.untilOn && editing.until ? 'On ' + fmtDate(editing.until) : 'On a date') + '</button>' : '';
    $('eEndDate').style.display = editing.recur && editing.untilOn ? '' : 'none';
    $('eEndDate').value = editing.until || '';
    var tq = [['09:00', '9am'], ['12:00', '12pm'], ['15:00', '3pm'], ['18:00', '6pm']], tc = '';
    for (i = 0; i < tq.length; i++) tc += '<button class="chip' + (editing.time === tq[i][0] ? ' on' : '') + '" data-act="stime" data-val="' + tq[i][0] + '">' + tq[i][1] + '</button>';
    tc += '<button class="chip' + (!editing.time ? ' on' : '') + '" data-act="stime" data-val="">None</button>';
    $('eTime').innerHTML = tc;
    $('eTimeIn').value = editing.time || '';
    var ics = '';
    if (st && editing.time && st.remind_time && timeOf(st) === editing.time && settings.caldav) {
      ics = '<div class="sethint">📅 In your Apple Calendar with an alert at ' + fmtTime(editing.time) + (st.recur ? ', repeating ' + recurText(st) : '') + '. Changes sync automatically.</div>';
    } else if (editing.time && settings.caldav) {
      ics = '<div class="sethint">Save, and it will appear in your Apple Calendar with an alert.</div>';
    } else if (st && editing.time && st.remind_time && timeOf(st) === editing.time) {
      ics = '<a class="btn icsbtn" style="margin-left:0" href="' + icsUrl(editing.id) + '">📅 Add to Calendar (alert at ' + fmtTime(editing.time) + ')</a>' +
        '<div class="sethint">' + (st.recur ? 'Repeats ' + recurText(st) + ' in Calendar. ' : '') + 'Opens Safari for the Add to Calendar sheet; switch back to this app afterwards.</div>';
    } else if (editing.time) ics = '<div class="sethint">Save, then reopen this task to add it to your calendar.</div>';
    $('eIcs').innerHTML = ics;
    $('eList').innerHTML = '<button class="' + (editing.list === 'personal' ? 'on' : '') + '" data-act="slist" data-val="personal">Personal</button>' +
      '<button class="' + (editing.list === 'work' ? 'on' : '') + '" data-act="slist" data-val="work">Work</button>';
    $('eFocus').innerHTML = '<button class="starbtn' + (editing.focus ? ' on' : '') + '" data-act="sfocus" aria-label="Today’s focus" title="Today’s focus">' + (editing.focus ? '★' : '☆') + '</button>';
    $('eWorkSec').style.display = isWork ? '' : 'none';
    var pl = [[0, 'None'], [1, '!'], [2, '!!'], [3, '!!!']], pg = '';
    for (i = 0; i < pl.length; i++) pg += '<button class="' + (editing.prio === pl[i][0] ? 'on' : '') + '" data-act="sprio" data-val="' + pl[i][0] + '">' + pl[i][1] + '</button>';
    $('ePrio').innerHTML = pg;
    $('eFlags').innerHTML = '<button class="chip' + (editing.quick ? ' on' : '') + '" data-act="squick">⚡ Quick win</button>' +
      '<button class="chip' + (editing.must ? ' on' : '') + '" data-act="smust">Must do today</button>' +
      '<button class="chip' + (editing.blocked ? ' on' : '') + '" data-act="sblock">Blocked</button>' +
      '<button class="chip' + (editing.paused ? ' on' : '') + '" data-act="spause">⏸ Waiting on someone</button>';
    $('eBlockRow').style.display = isWork && (editing.blocked || editing.paused) ? '' : 'none';
    $('eBlockRow').firstChild.textContent = editing.paused ? 'Waiting on' : 'Unblock action';
    var ubi = $('eUnblock'); if (ubi._ph === undefined) ubi._ph = ubi.placeholder; ubi.placeholder = editing.paused ? 'Who or what are you waiting on?' : ubi._ph;
    var sh = '';
    if (st && !st.is_session && !editing.due) sh += frow('Non-urgent', '<button class="chip' + (editing.low ? ' on' : '') + '" data-act="slow">Park as a note</button><div class="sethint">Kept out of your counts, parked reminders and Insights.</div>');
    if (st && !st.is_session) {
      var sc4 = sessCounts(st);
      sh += frow('Sub-tasks', '<button class="chip' + (sc4.total ? ' on' : '') + '" data-act="esubs">' + (sc4.total ? '☑ ' + sc4.done + '/' + sc4.total + ' · open list' : '+ Add sub-tasks') + '</button>');
    }
    $('eSubs').innerHTML = sh;
    $('eMore').style.display = editing.more ? '' : 'none';
    $('eMoreBtn').textContent = editing.more ? 'Fewer options' : 'More options · repeat, sub-tasks';
  }
  function icsUrl(id) { return '/api/ics?id=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(token); }
  function openSheet(id) {
    var t = find(id); if (!t) return;
    editing = { id: id, list: t.list || 'personal', due: t.due_date || null, cat: t.category || null, pp: t.pproject_id || null, bl: !!(t.pproject_id && t.pp_backlog), recur: t.recur || null, low: !!t.low, until: t.recur_until || null, untilOn: !!t.recur_until, time: timeOf(t) || null, focus: isFocus(t), prio: t.prio || 0, quick: !!t.quick, must: isMust(t), blocked: !!t.blocked, unblock: t.unblock_action || '', paused: isPaused(t), pausedOn: t.paused_on || '', more: !!(t.recur || t.low || (t.items && t.items.length && !t.is_session)) };
    $('eTitle').value = t.title;
    $('eNotes').value = t.notes || '';
    $('eUnblock').value = editing.paused ? editing.pausedOn : editing.unblock;
    renderSheet();
    $('sheet').style.display = 'flex';
  }
  function closeSheet() {
    editing = null;
    $('sheet').style.display = 'none';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function saveSheet() {
    var t = find(editing.id); if (!t) return closeSheet();
    var title = $('eTitle').value.replace(/^\s+|\s+$/g, '');
    if (!title) { toast('Give it a title'); return; }
    var patch = {}, before = {}, n = 0;
    if (title !== t.title) { patch.title = title; before.title = t.title; n++; }
    if (editing.due !== (t.due_date || null)) { patch.due_date = editing.due; before.due_date = t.due_date || null; n++; }
    if (editing.cat !== (t.category || null)) { patch.category = editing.cat; before.category = t.category || null; n++; }
    if (editing.list !== (t.list || 'personal')) { patch.list = editing.list; before.list = t.list || 'personal'; n++; }
    if (editing.list === 'work') editing.pp = null; // Personal Projects are for Personal tasks only
    if (editing.pp !== (t.pproject_id || null)) { patch.pproject_id = editing.pp; before.pproject_id = t.pproject_id || null; n++; }
    if (!editing.pp) editing.bl = false;
    if (editing.bl !== !!(t.pproject_id && t.pp_backlog)) { patch.pp_backlog = editing.bl; before.pp_backlog = !!t.pp_backlog; n++; }
    if (editing.recur !== (t.recur || null)) { patch.recur = editing.recur; before.recur = t.recur || null; n++; }
    if (editing.time && (!editing.due || editing.due < curToday())) editing.due = curToday(); // a reminder needs today or later
    var wantUntil = editing.recur && editing.untilOn ? editing.until : null;
    if (editing.recur && editing.untilOn && !editing.until) { toast('Pick an end date, or choose Never'); return; }
    if (wantUntil && wantUntil < curToday()) { toast('That end date has already passed'); return; }
    if (wantUntil && editing.due && wantUntil < editing.due) { toast('The end date is before the first repeat'); return; }
    if (wantUntil !== (t.recur_until || null)) { patch.recur_until = wantUntil; before.recur_until = t.recur_until || null; n++; }
    if (editing.due !== (t.due_date || null) && !('due_date' in patch)) { patch.due_date = editing.due; before.due_date = t.due_date || null; n++; }
    if (editing.due) editing.low = false; // a dated task is no longer "someday"
    if (editing.low !== !!t.low) { patch.low = editing.low; before.low = !!t.low; n++; }
    if (editing.time !== (timeOf(t) || null)) { patch.remind_time = editing.time; before.remind_time = t.remind_time || null; n++; }
    if ((editing.blocked || editing.paused) && editing.list === 'work') editing.focus = false;
    if (editing.focus !== isFocus(t)) { patch.focus = editing.focus; before.focus_date = t.focus_date || null; n++; }
    if (editing.due && editing.due > curToday()) editing.must = false; // "must do today" only makes sense for today or overdue
    if (!editing.due) editing.must = false;
    if (editing.list !== 'work') { editing.blocked = false; editing.paused = false; }
    if (editing.paused) { editing.must = false; editing.focus = false; editing.pausedOn = $('eUnblock').value.replace(/^\s+|\s+$/g, '').slice(0, 300); }
    if (editing.blocked) { editing.must = false; editing.focus = false; editing.unblock = $('eUnblock').value.replace(/^\s+|\s+$/g, '').slice(0, 300); }
    if (editing.list === 'work') {
      if (editing.prio !== (t.prio || 0)) { patch.prio = editing.prio; before.prio = t.prio || 0; n++; }
      if (editing.quick !== !!t.quick) { patch.quick = editing.quick; before.quick = !!t.quick; n++; }
      if (editing.must !== isMust(t)) { patch.must = editing.must; before.must = !!t.must; n++; }
    }
    if (editing.blocked !== !!t.blocked) { patch.blocked = editing.blocked; before.blocked = !!t.blocked; n++; }
    if (editing.blocked && editing.unblock !== (t.unblock_action || '')) { patch.unblock_action = editing.unblock || null; before.unblock_action = t.unblock_action || null; n++; }
    var nt = $('eNotes').value.replace(/^\s+|\s+$/g, '').slice(0, 2000);
    if (nt !== (t.notes || '')) { patch.notes = nt || null; before.notes = t.notes || null; n++; }
    var id = editing.id, pzOn = editing.pausedOn, pzWant = editing.list === 'work' && !!editing.paused;
    var pzChange = pzWant !== isPaused(t) || (pzWant && pzOn !== (t.paused_on || ''));
    closeSheet();
    if (!n && !pzChange) return;
    for (var k in patch) if (patch.hasOwnProperty(k)) {
      if (k === 'focus') t.focus_date = patch.focus ? curToday() : null; else t[k] = patch[k];
    }
    if ('blocked' in patch) { t.blocked_at = patch.blocked ? new Date().toISOString() : null; if (!patch.blocked) t.unblock_action = null; if (patch.blocked) t.must = false; }
    render();
    if (pzChange) setPaused(id, pzWant, pzOn, n ? function () { patchTodo(id, patch, before); } : null);
    else patchTodo(id, patch, before);
  }
  function setPaused(id, want, on, done) {
    var t = find(id);
    if (!t) { if (done) done(); return; }
    var was = {}, keys = ['paused', 'paused_at', 'paused_on', 'paused_secs', 'due_date', 'blocked', 'blocked_at', 'unblock_action', 'focus_date', 'must', 'plan_order', 'plan_date'], k;
    for (k = 0; k < keys.length; k++) was[keys[k]] = t[keys[k]];
    if (want) {
      if (!t.paused) { t.paused = true; t.paused_at = new Date().toISOString(); t.blocked = false; t.blocked_at = null; t.unblock_action = null; t.focus_date = null; t.must = false; t.plan_order = null; t.plan_date = null; }
      t.paused_on = on || null;
    } else if (t.paused) {
      var days = Math.floor((nowMs() - parseTS(t.paused_at)) / 86400000);
      if (t.due_date && days > 0) t.due_date = addDays(t.due_date, days);
      t.paused = false; t.paused_at = null; t.paused_on = null;
    }
    lastMutation = Date.now(); render();
    api('POST', '?id=' + encodeURIComponent(id), { paused: want, on: on || '' }, function (s, d) {
      if (s === 200 && d && d.todo) { merge(d.todo); lastMutation = Date.now(); render(); }
      else {
        var u = find(id);
        if (u) for (var j = 0; j < keys.length; j++) u[keys[j]] = was[keys[j]];
        render(); toast('Could not ' + (want ? 'pause' : 'resume') + ', try again');
      }
      if (done) done();
    }, '/api/pause');
  }
  function stashUb() { if (!editing) return; var v = $('eUnblock').value; if (editing.paused) editing.pausedOn = v; else if (editing.blocked) editing.unblock = v; }
  function deleteFromSheet() {
    var id = editing.id, t = find(id);
    if (t && t.recur) {
      ask({ title: 'Delete repeating task?', text: '“' + t.title + '” repeats ' + (RLABEL[t.recur] || t.recur) + '.',
        buttons: [{ label: 'This one only', primary: true }, { label: 'All future ones', alert: true }, { label: 'Cancel' }] }, function (i) {
        if (i === 0) doDelete(id, 'one'); else if (i === 1) doDelete(id, 'all');
      });
      return;
    }
    if (!window.confirm('Delete this item?')) return;
    doDelete(id, 'all');
  }
  function doDelete(id, scope) {
    closeSheet(); remove(id); render(); lastMutation = Date.now();
    api('DELETE', '?id=' + encodeURIComponent(id) + (scope === 'one' ? '&scope=one' : ''), null, function (s) {
      if (s !== 200) { toast('Could not delete, refreshing'); lastMutation = 0; load(); }
      else if (scope === 'one') { lastMutation = 0; load(); } // the next repeat appears
    });
  }
  function ask(o, cb) {
    var h = '<div class="big">' + esc(o.title) + '</div>' + (o.text ? '<div class="rvsub">' + esc(o.text) + '</div>' : '') + '<div class="rvbtns">';
    for (var i = 0; i < o.buttons.length; i++) {
      var b = o.buttons[i];
      h += '<button class="btn' + (b.primary ? ' primary' : '') + (b.alert ? ' alert' : '') + '" data-act="askbtn" data-i="' + i + '">' + esc(b.label) + '</button>';
    }
    $('askCard').innerHTML = h + '</div>'; askCb = cb; $('ask').style.display = 'flex';
  }
  function askDone(i) { var cb = askCb; askCb = null; $('ask').style.display = 'none'; if (cb) cb(i); }
  function maybeCalSync() { // pull any edits made in the Calendar app, at most every 5 minutes
    if (!settings.caldav || idle || calBusy || Date.now() - lastCalSync < 2 * 60000) return;
    calBusy = true;
    api('POST', '?sync=1', {}, function (s, d) {
      calBusy = false;
      if (s === 200 && d) { lastCalSync = Date.now(); if (d.changed) { lastMutation = 0; load(); } }
      else lastCalSync = Date.now() - 90000; /* failed: retry in ~30s */
    }, '/api/cal');
  }

  /* daily preview */
  function pvDefault(a, b) {
    var fa = isFocus(a) ? 0 : 1, fb = isFocus(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (a.list === 'work' && b.list === 'work') return autoCmp(a, b);
    var ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta !== tb) return ta ? -1 : 1;
    var oa = a.due_date < curToday() ? 0 : 1, ob = b.due_date < curToday() ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return byCreated(a, b);
  }
  function pvList() {
    var t0 = curToday(), arr = [];
    for (var i = 0; i < todos.length; i++) {
      var t = todos[i];
      if (inMode(t) && !t.done && !t.blocked && !isOut(t) && (isFocus(t) || (t.due_date && t.due_date <= t0))) arr.push(t);
    }
    arr.sort(function (a, b) { var ga = tonight(a) ? 0 : 1, gb = tonight(b) ? 0 : 1; return ga !== gb ? ga - gb : planCmp(a, b, pvDefault); });
    projSlots(arr, segTonight);
    var ids = [];
    for (var j = 0; j < arr.length; j++) ids.push(arr[j].id);
    return ids;
  }
  function lateNight() { return new Date().getHours() < 6; } // after midnight, before you wake up: the order screen is split in two
  function openPreview() {
    pv = { ids: pvList(), pick: null, tn: {} };
    for (var ti = 0; ti < pv.ids.length; ti++) { var tt0 = find(pv.ids[ti]); if (tt0 && tonight(tt0)) pv.tn[pv.ids[ti]] = true; }
    renderPreview();
    $('preview').style.display = 'flex';
  }
  function closePreview() {
    pv = null; $('preview').style.display = 'none';
    lastMutation = 0; load();
  }
  function maybeAutoPreview() {
    if (autoPrev || !loaded) return;
    autoPrev = true;
    var t0 = curToday();
    if (new Date().getHours() < 12 && store.get('pvSeen') !== t0 && !editing && !rv && !sess && !setDraft && pvList().length) {
      store.set('pvSeen', t0); openPreview();
    }
  }
  function renderPreview() {
    var hr = new Date().getHours(), t0 = curToday(), p = t0.split('-'), i, h = '', open = 0;
    h += '<div class="big">' + (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + '</div>';
    for (i = 0; i < pv.ids.length; i++) { var q = find(pv.ids[i]); if (q && !q.done) open++; }
    h += '<div class="rvsub">' + DOWL[dowOf(t0)] + ' ' + (+p[2]) + ' ' + MONL[+p[1] - 1] + ' · ' + open + (open === 1 ? ' task' : ' tasks') + ' to do. Put them in the order you’ll do them.</div>';
    if (glance && glance.events && glance.events.length) {
      h += '<div class="lbl" style="margin-top:8px">On your calendar</div>';
      for (i = 0; i < glance.events.length && i < 8; i++) {
        var e = glance.events[i];
        h += '<div class="pvcal">' + (e.allDay ? '<b>All day</b>' : '<b>' + e.s + '</b>') + esc(e.title) + '</div>';
      }
    }
    var nTn = 0, rank = {}, rn = [0, 0], grp, lastGrp = -1, late = lateNight();
    for (i = 0; i < pv.ids.length; i++) if (pv.tn[pv.ids[i]]) nTn++;
    var split = nTn > 0 || late, divider = '<div class="lbl" style="margin-top:18px;padding-top:12px;border-top:3px solid var(--accent)">Today, from when you wake up</div>';
    h += '<div class="lbl">' + (split ? 'Finish tonight' : 'Your order') + '</div>';
    if (split) h += '<div class="sethint">' + (late ? 'Still up? This is what you\'ll finish before bed. Tap ↓ to move a task to today, or ↑ on a task below to do it tonight.' : 'Left over from before midnight. Tap ↓ on a task to move it to today instead.') + '</div>';
    if (split && late && !nTn && pv.ids.length) h += '<div class="rvsub">Nothing here yet.</div>';
    if (!pv.ids.length) h += '<div class="rvsub">Nothing due today. Enjoy it.</div>';
    h += '<div>';
    for (i = 0; i < pv.ids.length; i++) { var rq = find(pv.ids[i]); grp = pv.tn[pv.ids[i]] ? 0 : 1; if (rq && !rq.done) rank[i] = ++rn[grp]; }
    for (i = 0; i < pv.ids.length; i++) {
      var t = find(pv.ids[i]); if (!t) continue;
      grp = pv.tn[pv.ids[i]] ? 0 : 1;
      if (split && grp !== lastGrp && grp === 1) h += divider;
      lastGrp = grp;
      var meta = tagChips(t);
      if (isFocus(t)) meta += '<span class="rem">★ focus</span>';
      if (t.remind_time) meta += '<span class="rem">⏰ ' + fmtTime(timeOf(t)) + '</span>';
      if (t.due_date && t.due_date < t0) meta += '<span class="due overdue">Overdue · ' + fmtDate(t.due_date) + '</span>';
      if (t.category) meta += '<span class="cat">' + esc(t.category) + '</span>';
      if (t.is_session) { var sc = sessCounts(t); meta += '<span class="cat">session' + (sc.total ? ' ' + sc.done + '/' + sc.total : '') + '</span>'; }
      meta += subChip(t, false);
      h += '<div class="pvrow' + (t.done ? ' d' : '') + '"><div class="pvgrip" aria-label="Drag to reorder">☰</div>' +
        (t.done ? '<button class="pvnum" disabled aria-label="Done">✓</button>' : '<button class="pvnum" data-act="pvnum" data-i="' + i + '" aria-label="Move to a position">' + rank[i] + '</button>') +
        '<div class="pvmain"><div class="pvt">' + esc(t.title) + '</div>' + (meta ? '<div class="meta">' + meta + '</div>' : '') + '</div>' +
        '<div class="pvbtns">' +
 (t.done || grp !== 1 || !late || isFocus(t) ? '' : '<button data-act="pvtonight" data-id="' + esc(t.id) + '" aria-label="Do it tonight" title="Do it tonight">↑</button>') +
        (t.done || grp !== 0 ? '' : '<button data-act="pvtoday" data-id="' + esc(t.id) + '" aria-label="Move to today" title="Move to today">↓</button>') +
        (t.done ? '' : '<button data-act="pvlater" data-id="' + esc(t.id) + '" aria-label="Move to tomorrow" title="Tomorrow">→</button>') +
        '<button class="tk" data-act="pvtick" data-id="' + esc(t.id) + '" aria-label="Done">' + (t.done ? '↺' : '✓') + '</button>' +
        '</div></div>';
      if (pv.pick === i) {
        h += '<div class="pvpick"><span class="qlabel">Move to position</span>';
        for (var pp = 0; pp < pv.ids.length; pp++) {
          if (pp !== i && rank[pp] && (pv.tn[pv.ids[pp]] ? 0 : 1) === grp) h += '<button class="chip" data-act="pvto" data-i="' + i + '" data-to="' + pp + '">' + rank[pp] + '</button>';
        }
        h += '</div>';
      }
    }
    if (split && pv.ids.length && lastGrp !== 1) h += divider;
    h += '</div><div class="sethint">Drag ☰ to reorder, or tap a number to jump to a position · → push to tomorrow · ✓ done.</div>';
    h += '<div class="row"><span class="sp"></span><button class="btn primary" data-act="pvclose">Start my day</button></div>';
    $('previewCard').innerHTML = h;
  }
  var planSaving = false, planDirty = false;
  function pvSave() {
    var t0 = curToday(), n = 0, i;
    for (i = 0; i < pv.ids.length; i++) {
      var t = find(pv.ids[i]);
      if (t && !t.done) { n++; t.plan_order = n; t.plan_date = t0; } else if (t) { t.plan_order = null; t.plan_date = null; }
    }
    lastMutation = Date.now();
    if (planSaving) { planDirty = true; return; }
    planSaving = true;
    var ids = [];
    for (i = 0; i < pv.ids.length; i++) { var tt = find(pv.ids[i]); if (tt && !tt.done) ids.push(tt.id); }
    if (App.afterPlan) App.afterPlan(ids, mode);
    api('POST', '', { plan: ids, list: mode }, function (st) {
      planSaving = false;
      if (st !== 200) toast('Could not save the order, check your connection');
      if (planDirty && pv) { planDirty = false; pvSave(); } else lastMutation = Date.now();
    });
  }
  function pvTo(i, j) {
    if (!pv || i === j || j < 0 || j >= pv.ids.length) return;
    var x = pv.ids.splice(i, 1)[0];
    pv.ids.splice(j, 0, x);
    pv.pick = null;
    pvKeepBlocks();
    if (pv.ids[j] !== x) toast('Use ↑ or ↓ to move a task across');
    pvSave(); renderPreview(); render();
  }
  function pvKeepBlocks() { // "Finish tonight" tasks stay above today's tasks
    var a = [], b = [], k;
    for (k = 0; k < pv.ids.length; k++) (pv.tn[pv.ids[k]] ? a : b).push(pv.ids[k]);
    pv.ids = a.concat(b);
  }
  function pvToday(id) {
    var t = find(id); if (!t || !pv) return;
    var before = { due_date: t.due_date };
    t.due_date = curToday(); delete pv.tn[id]; pv.pick = null;
    pvKeepBlocks();
    patchTodo(id, { due_date: t.due_date }, before);
    pvSave(); renderPreview(); render(); toast('Moved to today');
  }
  function pvTonight(id) { // after midnight: do this one before bed. It counts as yesterday's, so it joins the "Finish tonight" block.
    var t = find(id); if (!t || !pv) return;
    var before = { due_date: t.due_date };
    t.due_date = addDays(curToday(), -1); pv.tn[id] = true; pv.pick = null;
    pvKeepBlocks();
    patchTodo(id, { due_date: t.due_date }, before);
    pvSave(); renderPreview(); render(); toast('Moved to tonight');
  }
  var drag = null;
  var DRAGS = {
    pv: { root: function () { return $('previewCard'); }, scroller: function () { return $('previewCard'); }, move: function (a, b) { pvTo(a, b); }, redo: function () { renderPreview(); } },
    ss: { root: function () { return $('sList'); }, scroller: function () { return $('sess').querySelector('.card'); }, move: function (a, b) { ssMove(a, b); }, redo: function () { renderSess(); } },
    pt: { root: function () { return $('ptRows'); }, scroller: function () { return $('vPlan').querySelector('.scrollview'); }, move: function (a, b) { ptMove(a, b); }, redo: function () { renderPlan(); } }
  };
  function dragRows(c) { return c.root().querySelectorAll('.pvrow'); }
  function scrollPos(c) { return c.scroller().scrollTop + (window.pageYOffset || 0); }
  function dragStart(c, grip, y) {
    var row = grip.parentNode, rows = dragRows(c), from = -1, i;
    for (i = 0; i < rows.length; i++) if (rows[i] === row) from = i;
    if (from < 0) return false;
    drag = { c: c, from: from, to: from, row: row, y0: y, s0: scrollPos(c), dy: 0 };
    row.className += ' dragging';
    row.style.position = 'relative'; row.style.zIndex = 5;
    return true;
  }
  function dragMove(y) {
    if (!drag) return;
    var c = drag.c, sc = c.scroller(), rows = dragRows(c), i, to = 0, cr = sc.getBoundingClientRect();
    var top = Math.max(cr.top, 0), bot = Math.min(cr.bottom, window.innerHeight || 768);
    var step = y < top + 60 ? -12 : (y > bot - 60 ? 12 : 0);
    if (step) { if (sc.scrollHeight > sc.clientHeight + 2) sc.scrollTop += step; else window.scrollBy(0, step); }
    drag.dy = y - drag.y0 + (scrollPos(c) - drag.s0);
    var tf = 'translateY(' + drag.dy + 'px)';
    drag.row.style.webkitTransform = tf; drag.row.style.transform = tf;
    for (i = 0; i < rows.length; i++) {
      if (i === drag.from) continue;
      var r = rows[i].getBoundingClientRect();
      if (r.top + (r.bottom - r.top) / 2 < y) to++;
      rows[i].className = rows[i].className.replace(/ drop[ab]/g, '');
    }
    drag.to = to;
    if (to !== drag.from && rows[to]) rows[to].className += to < drag.from ? ' dropb' : ' dropa';
  }
  function dragEnd() {
    if (!drag) return;
    var d = drag; drag = null;
    d.row.style.webkitTransform = ''; d.row.style.transform = ''; d.row.style.position = ''; d.row.style.zIndex = '';
    if (d.to !== d.from) d.c.move(d.from, d.to); else d.c.redo();
  }
  function bindDrag(card, key) {
    var c = DRAGS[key];
    function gripOf(el) { while (el && el !== card) { if (el.className && /(^| )pvgrip( |$)/.test(el.className)) return el; el = el.parentNode; } return null; }
    card.addEventListener('touchstart', function (e) {
      var g = gripOf(e.target); if (!g || !e.touches || e.touches.length !== 1) return;
      if (!dragStart(c, g, e.touches[0].clientY)) return;
      e.preventDefault();
      var move = function (ev) { ev.preventDefault(); dragMove(ev.touches[0].clientY); };
      var end = function () {
        g.removeEventListener('touchmove', move, false); g.removeEventListener('touchend', end, false); g.removeEventListener('touchcancel', end, false);
        dragEnd();
      };
      g.addEventListener('touchmove', move, false); g.addEventListener('touchend', end, false); g.addEventListener('touchcancel', end, false);
    }, false);
    card.addEventListener('mousedown', function (e) {
      var g = gripOf(e.target); if (!g) return;
      if (!dragStart(c, g, e.clientY)) return;
      e.preventDefault();
      var move = function (ev) { dragMove(ev.clientY); };
      var up = function () { document.removeEventListener('mousemove', move, false); document.removeEventListener('mouseup', up, false); dragEnd(); };
      document.addEventListener('mousemove', move, false); document.addEventListener('mouseup', up, false);
    }, false);
  }
  bindDrag($('previewCard'), 'pv');
  bindDrag($('sess'), 'ss');
  function pvTick(id) {
    var t = find(id); if (!t) return;
    var nd = !t.done, before = { done: t.done, done_at: t.done_at };
    t.done = nd; t.done_at = nd ? new Date().toISOString() : null;
    patchTodo(id, { done: nd }, before);
    pvSave(); renderPreview(); render();
  }
  function pvLater(id) {
    var t = find(id); if (!t) return;
    var wasFocus = isFocus(t), before = { due_date: t.due_date, focus_date: t.focus_date || null }, patch = { due_date: addDays(curToday(), 1) };
    t.due_date = patch.due_date;
    if (wasFocus) { t.focus_date = null; patch.focus = false; }
    patchTodo(id, patch, before);
    for (var i = 0; i < pv.ids.length; i++) if (pv.ids[i] === id) { pv.ids.splice(i, 1); break; }
    pvSave(); renderPreview(); render(); toast('Moved to tomorrow');
  }

  /* session checklists */
  function renderSess() {
    var t = find(sess.id); if (!t) { closeSess(); return; }
    var it = t.items || [], c = sessCounts(t), h = '';
    $('sTitle').textContent = t.title;
    $('sBadge').textContent = t.is_session ? 'SESSION' : 'SUB-TASKS';
    $('sInput').placeholder = t.is_session ? 'Add a task…' : 'Add a sub-task…';
    $('sFinish').style.display = t.is_session ? '' : 'none';
    $('sDetails').style.display = editing ? 'none' : '';
    $('sMeta').textContent = c.total ? c.done + ' of ' + c.total + ' done' : (t.is_session ? 'Add everything that needs doing this session.' : 'Break this task into smaller steps.');
    $('sBar').style.width = (c.total ? Math.round(c.done * 100 / c.total) : 0) + '%';
    if (sess.reorder) {
      for (var i = 0; i < it.length; i++) {
        h += '<li class="pvrow' + (it[i].d ? ' d' : '') + '"><div class="pvgrip" aria-label="Drag to reorder">☰</div>' +
          '<button class="pvnum" data-act="ssnum" data-i="' + i + '" aria-label="Move to a position">' + (i + 1) + '</button>' +
          '<div class="pvmain"><div class="pvt">' + esc(it[i].t) + '</div></div></li>';
        if (sess.pick === i) {
          h += '<li class="pvpick"><span class="qlabel">Move to position</span>';
          for (var pp = 0; pp < it.length; pp++) if (pp !== i) h += '<button class="chip" data-act="ssto" data-i="' + i + '" data-to="' + pp + '">' + (pp + 1) + '</button>';
          h += '</li>';
        }
      }
    } else {
      for (var i2 = 0; i2 < it.length; i2++) {
        h += '<li class="srow' + (it[i2].d ? ' d' : '') + '"><button class="stick" data-act="stick" data-i="' + i2 + '" aria-label="Toggle"></button>' +
          '<div class="stext" data-act="stick" data-i="' + i2 + '">' + esc(it[i2].t) + '</div>' +
          '<button class="sdel" data-act="sdel" data-i="' + i2 + '" aria-label="Remove">×</button></li>';
      }
    }
    $('sList').innerHTML = h;
    $('sForm').style.display = sess.reorder ? 'none' : '';
    $('sReorder').style.display = it.length > 1 ? '' : 'none';
    $('sReorder').textContent = sess.reorder ? 'Done ordering' : 'Re-order';
    $('sFinish').className = 'btn' + (c.total && c.done === c.total ? ' primary' : '');
  }
  function ssMove(i, j) {
    var t = sess && find(sess.id); if (!t || i === j || j < 0 || j >= t.items.length) return;
    var x = t.items.splice(i, 1)[0];
    t.items.splice(j, 0, x);
    sess.pick = null; renderSess(); saveItems(t.id);
  }
  function openSession(id) {
    var t = find(id); if (!t) return;
    sess = { id: id };
    renderSess();
    $('sess').style.display = 'flex';
  }
  function closeSess() {
    sess = null; $('sess').style.display = 'none';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (editing) renderSheet();
    render(); lastMutation = Date.now();
  }
  function saveItems(id) {
    lastMutation = Date.now();
    if (itemsSaving) { itemsDirty = true; return; }
    var t = find(id); if (!t) return;
    itemsSaving = true;
    api('PATCH', '?id=' + encodeURIComponent(id), { items: t.items }, function (s) {
      itemsSaving = false;
      if (s !== 200) toast('Could not save the checklist, check your connection');
      if (itemsDirty) { itemsDirty = false; saveItems(id); } else lastMutation = Date.now();
    });
  }
  function addSessItems(text) {
    var t = find(sess.id); if (!t) return;
    var lines = text.split(/\r?\n/), added = 0;
    t.items = t.items || [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/^[\s\-\*•]+|\s+$/g, '');
      if (l && t.items.length < 100) { t.items.push({ t: l.slice(0, 200), d: false }); added++; }
    }
    if (added) { renderSess(); saveItems(t.id); }
  }
  function toggleSessItem(i) {
    var t = find(sess.id); if (!t || !t.items[i]) return;
    t.items[i].d = !t.items[i].d; renderSess(); saveItems(t.id);
    var c = sessCounts(t);
    if (t.items[i].d && c.done === c.total) toast(t.is_session ? 'All done, finish the session?' : 'All sub-tasks done');
  }
  function delSessItem(i) {
    var t = find(sess.id); if (!t) return;
    t.items.splice(i, 1); renderSess(); saveItems(t.id);
  }
  function maybeOpenPending() {
    if (!pendingOpen || !loaded) return;
    var want = pendingOpen, id = null, i;
    pendingOpen = null;
    try { if (window.history && history.replaceState) history.replaceState(null, '', window.location.pathname + (window.location.hash || '')); } catch (e) {}
    if (want === 'latest') {
      var best = 0;
      for (i = 0; i < todos.length; i++) {
        var t = todos[i];
        if (inMode(t) && t.is_session && !t.done && parseTS(t.created_at) >= best) { best = parseTS(t.created_at); id = t.id; }
      }
    } else if (find(want)) id = want;
    if (id) { var pt = find(id); if (pt && !inMode(pt)) setMode(pt.list || 'personal'); openSession(id); }
  }

  /* settings */
  function hourLabel(h) { return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm'); }
  function tabsHTML() {
    var list = [['general', 'General']].concat(App.tabList), h = '<div class="tabs">';
    for (var i = 0; i < list.length; i++) h += '<button class="tab' + (settingsTab === list[i][0] ? ' on' : '') + '" data-act="stab" data-val="' + list[i][0] + '">' + list[i][1] + '</button>';
    return h + '</div>';
  }
  function renderSettings() {
    var d = setDraft, h = '', i, opts;
    if (settingsTab !== 'general' && App.tabs[settingsTab]) {
      $('settingsCard').innerHTML = '<div class="big">Settings</div>' + tabsHTML() + '<div id="tabBody"></div><div class="row"><span class="sp"></span><button class="btn primary" data-act="setcancel">Done</button></div>';
      App.tabs[settingsTab].render($('tabBody'));
      return;
    }
    settingsTab = 'general';
    h += '<div class="big">Settings</div>' + tabsHTML();
    h += '<div class="lbl" style="margin-top:6px">City for weather</div><input class="setinput" id="setCity" type="text" autocomplete="off" autocorrect="off" placeholder="e.g. Cardiff" value="' + esc(settings.city || '') + '">';
    h += '<div class="sethint">' + (settings.place ? 'Showing weather for ' + esc(settings.place) : 'Not set yet, showing London.') + '</div>';
    h += '<div class="lbl">Temperature</div><button class="chip' + (d.units === 'c' ? ' on' : '') + '" data-act="setv" data-k="units" data-val="c">°C</button>' +
      '<button class="chip' + (d.units === 'f' ? ' on' : '') + '" data-act="setv" data-k="units" data-val="f">°F</button>';
    if (settings.caldav) {
      h += '<div class="lbl">Calendar</div><div class="rvsub">Using Apple Calendar: today’s events, and your timed tasks appear there with an alert. Manage it in the Calendar tab.</div>';
    } else {
      h += '<div class="lbl">Calendar (today’s events)</div>';
      if (settings.calendar_set && !d.clearCal) h += '<div class="rvsub">Connected ✓ <button class="chip" data-act="setclearcal">Remove</button></div>';
      h += '<input class="setinput" id="setCal" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Paste a private iCal link (https://…)">';
      h += '<div class="sethint">Google Calendar → Settings → your calendar → “Secret address in iCal format”. Keep it private.</div>';
      h += '<div class="lbl">Calendar reminders</div>';
      h += '<a class="btn icsbtn" style="margin-left:0" href="webcal://' + window.location.host + '/api/ics?feed=1&amp;t=' + encodeURIComponent(token) + '">📅 Subscribe on this device</a>';
      h += '<div class="sethint">Give a task a time (or type “call dentist fri 3pm”) and it shows in Calendar with an alert. Subscribe once on your iPhone. iPhone decides how often it refreshes, so new times can take a while; for an instant one, open the task and tap “Add to Calendar”. Use one or the other, not both.</div>';
    }
    h += '<div class="lbl">Flag parked items after</div>';
    opts = [7, 14, 21, 30];
    for (i = 0; i < opts.length; i++) h += '<button class="chip' + (d.stale_days === opts[i] ? ' on' : '') + '" data-act="setv" data-k="stale_days" data-val="' + opts[i] + '">' + opts[i] + ' days</button>';
    h += '<div class="lbl">Night mode starts</div>';
    opts = [19, 20, 21, 22, 23];
    for (i = 0; i < opts.length; i++) h += '<button class="chip' + (d.night_start === opts[i] ? ' on' : '') + '" data-act="setv" data-k="night_start" data-val="' + opts[i] + '">' + hourLabel(opts[i]) + '</button>';
    h += '<div class="lbl">Night mode ends</div>';
    opts = [5, 6, 7, 8, 9];
    for (i = 0; i < opts.length; i++) h += '<button class="chip' + (d.night_end === opts[i] ? ' on' : '') + '" data-act="setv" data-k="night_end" data-val="' + opts[i] + '">' + hourLabel(opts[i]) + '</button>';
    h += '<div class="sethint">Tap the clock any time to force night or day on this device.</div>';
    h += '<div class="row"><span class="sp"></span><button class="btn" data-act="setcancel">Cancel</button><button class="btn primary" data-act="setsave">Save</button></div>';
    var keepCity = $('setCity') ? $('setCity').value : (d.cityText !== undefined ? d.cityText : null), keepCal = $('setCal') ? $('setCal').value : (d.calText !== undefined ? d.calText : null);
    $('settingsCard').innerHTML = h;
    if (keepCity !== null) $('setCity').value = keepCity;
    if (keepCal !== null) $('setCal').value = keepCal;
  }
  function openSettings() {
    settingsTab = 'general';
    setDraft = { units: settings.units, stale_days: settings.stale_days, night_start: settings.night_start, night_end: settings.night_end, clearCal: false };
    $('settingsCard').innerHTML = '';
    renderSettings();
    $('settings').style.display = 'flex';
  }
  function closeSettings() { setDraft = null; $('settings').style.display = 'none'; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  function saveSettings() {
    var body = {}, city = $('setCity').value.replace(/^\s+|\s+$/g, ''), cal = $('setCal') ? $('setCal').value.replace(/^\s+|\s+$/g, '') : '';
    if (city !== (settings.city || '')) body.city = city;
    if (cal) body.calendar_url = cal; else if (setDraft.clearCal) body.calendar_url = '';
    var ks = ['units', 'stale_days', 'night_start', 'night_end'];
    for (var i = 0; i < ks.length; i++) if (setDraft[ks[i]] !== settings[ks[i]]) body[ks[i]] = setDraft[ks[i]];
    var any = false; for (var k in body) if (body.hasOwnProperty(k)) any = true;
    if (!any) { closeSettings(); return; }
    toast('Saving…');
    api('POST', '', body, function (st, d) {
      if (st === 200 && d && d.settings) {
        applySettings(d.settings);
        closeSettings(); render(); loadGlance(); toast('Settings saved');
      } else if (st === 422) toast('Could not find that city');
      else if (st === 400) toast((d && d.error) || 'Check the calendar link');
      else toast('Could not save, try again');
    }, '/api/settings');
  }
  function applySettings(sv) {
    for (var k in sv) if (sv.hasOwnProperty(k)) settings[k] = sv[k];
    store.set('settingsCache', JSON.stringify(settings));
    applyTheme();
  }
  function loadSettings() {
    if (!token) return;
    api('GET', '', null, function (st, d) {
      if (st === 200 && d && d.settings) { applySettings(d.settings); render(); }
    }, '/api/settings');
  }

  /* reviews */
  function showReview() { $('review').style.display = 'flex'; }
  function closeReview() { rv = null; $('review').style.display = 'none'; lastMutation = 0; load(); }
  function openStale() {
    var g = groups();
    if (!g.stale.length) { toast('Nothing to review'); return; }
    var ids = [];
    for (var i = 0; i < g.stale.length; i++) ids.push(g.stale[i].id);
    rv = { mode: 'stale', ids: ids, i: 0 };
    renderReview(); showReview();
  }
  function openWeek() {
    rv = { mode: 'week' };
    renderReview(); showReview();
  }
  function ageText(t) {
    var d = ageDays(t);
    return d >= 14 ? Math.floor(d / 7) + ' weeks' : d + ' days';
  }
  function renderReview() {
    var h = '', i;
    if (rv.mode === 'stale') {
      var t = find(rv.ids[rv.i]);
      while (!t && rv.i < rv.ids.length - 1) { rv.i++; t = find(rv.ids[rv.i]); }
      if (!t) { closeReview(); return; }
      h = '<div class="lbl" style="margin-top:0">Still relevant? · ' + (rv.i + 1) + ' of ' + rv.ids.length + '</div>' +
        '<div class="rvtitle">' + esc(t.title) + '</div>' +
        '<div class="rvsub">Parked for ' + ageText(t) + (t.category ? ' · ' + esc(t.category) : '') + '</div>' +
        '<div class="rvbtns"><button class="btn primary" data-act="rvkeep">Keep</button>' +
        '<button class="btn" data-act="rvtoday">Do today</button>' +
        '<button class="btn" data-act="rvdrop">Drop it</button>' +
        '<button class="btn" data-act="rvskip">Skip</button></div>' +
        '<div class="row"><span class="sp"></span><button class="btn" data-act="rvclose">Close</button></div>';
    } else {
      var g = groups(), bycat = {}, order = [], seen = {};
      for (i = 0; i < g.done.length; i++) {
        var c = g.done[i].category || 'Uncategorised';
        if (!seen[c]) { seen[c] = 1; order.push(c); }
        bycat[c] = (bycat[c] || 0) + 1;
      }
      var cs = [];
      for (i = 0; i < order.length; i++) cs.push(esc(order[i]) + ' ' + bycat[order[i]]);
      h = '<div class="big">Your week</div>' +
        '<div class="rvsub">' + g.done.length + ' done in the last 7 days' + (cs.length ? ' · ' + cs.join(' · ') : '') + '</div>';
      if (g.done.length) {
        h += '<ul class="rvlist">';
        for (i = 0; i < g.done.length && i < 8; i++) h += '<li>✓ ' + esc(g.done[i].title) + '</li>';
        if (g.done.length > 8) h += '<li>…and ' + (g.done.length - 8) + ' more</li>';
        h += '</ul>';
      }
      var od = [];
      for (i = 0; i < todos.length; i++) if (inMode(todos[i]) && !todos[i].done && !todos[i].blocked && !isOut(todos[i]) && todos[i].due_date && todos[i].due_date < curToday()) od.push(todos[i]);
      od.sort(byDue);
      h += '<div class="lbl">Rolled over (' + od.length + ')</div>';
      if (od.length) {
        h += '<ul class="rvlist">';
        for (i = 0; i < od.length && i < 6; i++) h += '<li>' + esc(od[i].title) + ' <span class="rvsub">· ' + fmtDate(od[i].due_date) + '</span></li>';
        if (od.length > 6) h += '<li>…and ' + (od.length - 6) + ' more</li>';
        h += '</ul><div class="rvbtns"><button class="btn" data-act="rvmove" data-when="today">Move all to today</button>' +
          '<button class="btn" data-act="rvmove" data-when="tomorrow">Move all to tomorrow</button></div>';
      } else h += '<div class="rvsub">Nothing carried over. Clean slate.</div>';
      if (g.stale.length) h += '<div class="lbl">Parked</div><button class="btn" data-act="review">Review ' + g.stale.length + ' parked item' + (g.stale.length === 1 ? '' : 's') + '</button>';
      h += '<div class="row"><span class="sp"></span><button class="btn primary" data-act="rvclose">Done</button></div>';
    }
    $('reviewCard').innerHTML = h;
  }
  function rvAdvance() {
    rv.i++;
    if (rv.i >= rv.ids.length) { closeReview(); toast('Review done'); } else renderReview();
  }
  function rvAct(act) {
    var id = rv.ids[rv.i], t = find(id);
    if (!t) { rvAdvance(); return; }
    if (act === 'rvkeep') {
      var b1 = { reviewed_at: t.reviewed_at || null };
      t.reviewed_at = new Date().toISOString(); render(); patchTodo(id, { reviewed: true }, b1);
    } else if (act === 'rvtoday') {
      var b2 = { due_date: t.due_date || null, reviewed_at: t.reviewed_at || null };
      t.due_date = curToday(); t.reviewed_at = new Date().toISOString(); render(); patchTodo(id, { due_date: t.due_date, reviewed: true }, b2);
    } else if (act === 'rvdrop') {
      remove(id); render(); lastMutation = Date.now();
      api('DELETE', '?id=' + encodeURIComponent(id), null, function (s) {
        if (s !== 200) { toast('Could not delete, refreshing'); lastMutation = 0; load(); }
      });
    }
    rvAdvance();
  }
  function maybeAutoReview() {
    if (autoChecked || !loaded) return;
    autoChecked = true;
    var t0 = curToday();
    if (dowOf(t0) === 0 && new Date().getHours() >= 17 && store.get('weekSeen') !== t0 && !editing && !rv) {
      store.set('weekSeen', t0); openWeek();
    }
  }

  /* today at a glance */
  function loadGlance() {
    if (!token) return;
    var x = new XMLHttpRequest();
    x.open('GET', '/api/glance?_=' + Date.now(), true);
    x.setRequestHeader('x-todo-token', token);
    x.timeout = 20000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || x.status !== 200) return;
      try { glance = JSON.parse(x.responseText); } catch (e) { return; }
      render();
    };
    x.send(null);
  }

  /* gate */
  function showGate(msg) {
    token = null; store.del('todoToken');
    $('gateMsg').textContent = msg || '';
    $('gate').style.display = 'flex';
  }
  function saveGate() {
    var v = $('gateInput').value.replace(/\s+/g, '').toLowerCase();
    if (!v) return;
    token = v; store.set('todoToken', v);
    $('gate').style.display = 'none'; $('gateMsg').textContent = '';
    $('gateInput').blur();
    loaded = false; render(); load(); loadGlance(); loadSettings();
  }

  /* theme + clock */
  function applyTheme() {
    var h = new Date().getHours();
    var ns = settings.night_start, ne = settings.night_end;
    var auto = ns > ne ? (h >= ns || h < ne) : (h >= ns && h < ne);
    var night = themeMode === 'night' || (themeMode === 'auto' && auto);
    var de = document.documentElement;
    if (appliedNight === null) appliedNight = /(^| )night( |$)/.test(de.className);
    if (night !== appliedNight) {
      /* iOS 9 repaints only part of a live page when the theme flips, so reload for a clean paint.
         Wait until nothing is open, and not more than once every 20 seconds. */
      if (!(idle || editing || rv || sess || setDraft || pv || drag || askCb)) {
        var lastR = 0; try { lastR = parseInt(sessionStorage.getItem('themeReload') || '0', 10) || 0; } catch (e) {}
        if (Date.now() - lastR > 20000) {
          try { sessionStorage.setItem('themeReload', String(Date.now())); } catch (e2) {}
          appliedNight = night;
          try { location.reload(); return; } catch (e3) {}
        }
      }
      night = appliedNight; /* not safe yet: keep the current look until the next check */
    }
    var cls = (night ? 'night' : '') + (mode === 'work' ? (night ? ' work' : 'work') : '');
    if (idle) cls += (cls ? ' ' : '') + 'idle';
    if (de.className !== cls) de.className = cls;
  }
  function cycleTheme() {
    themeMode = themeMode === 'auto' ? 'night' : themeMode === 'night' ? 'day' : 'auto';
    store.set('themeMode', themeMode); applyTheme();
    toast('Theme: ' + (themeMode === 'auto' ? 'automatic (dark ' + hourLabel(settings.night_start) + '–' + hourLabel(settings.night_end) + ')' : themeMode));
  }
  function tickClock() {
    if (idle && (++clockSkip % 6)) return; // idle: update the clock about once a minute
    var d = new Date();
    $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    applyTheme();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
    if (!el || el === document) {
      if (e.target === $('sheet')) closeSheet();
      else if (e.target === $('review')) closeReview();
      else if (e.target === $('preview') && pv) closePreview();
      else if (e.target === $('sess')) closeSess();
      else if (e.target === $('settings')) closeSettings();
      else if (e.target === $('ask')) askDone(-1);
      return;
    }
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    if (act === 'tick') doTick(id);
    else if (act === 'edit') openSheet(id);
    else if (act === 'sortday') sortDay();
    else if (act === 'pushrest') pushRest();
    else if (act === 'sprio') { editing.prio = +el.getAttribute('data-val') || 0; renderSheet(); }
    else if (act === 'sblock') { stashUb(); editing.blocked = !editing.blocked; if (editing.blocked) { editing.must = false; editing.focus = false; editing.paused = false; } renderSheet(); $('eUnblock').value = editing.paused ? editing.pausedOn : editing.unblock; if (editing.blocked) { try { $('eUnblock').focus(); } catch (e) {} } }
    else if (act === 'spause') { stashUb(); editing.paused = !editing.paused; if (editing.paused) { editing.blocked = false; editing.must = false; editing.focus = false; } renderSheet(); $('eUnblock').value = editing.paused ? editing.pausedOn : editing.unblock; if (editing.paused) { try { $('eUnblock').focus(); } catch (e) {} } }
    else if (act === 'resume') { setPaused(id, false, '', null); toast('Resumed'); }
    else if (act === 'smore') { editing.more = !editing.more; renderSheet(); }
    else if (act === 'unblock') { var ub = find(id); if (ub) { var ubb = { blocked: true, blocked_at: ub.blocked_at || null, unblock_action: ub.unblock_action || null }; ub.blocked = false; ub.blocked_at = null; ub.unblock_action = null; render(); patchTodo(id, { blocked: false }, ubb); toast('Unblocked'); } }
    else if (act === 'squick') { editing.quick = !editing.quick; renderSheet(); }
    else if (act === 'smust') { editing.must = !editing.must; if (editing.must) { editing.blocked = false; editing.paused = false; } if (editing.must && !editing.due) editing.due = curToday(); if (editing.must && editing.due > curToday()) editing.due = curToday(); renderSheet(); }
    else if (act === 'quick') doQuick(id, el.getAttribute('data-when'));
    else if (act === 'star') toggleStar(id);
    else if (act === 'sess') openSession(id);
    else if (act === 'esubs') { if (editing) openSession(editing.id); }
    else if (act === 'stick') toggleSessItem(+el.getAttribute('data-i'));
    else if (act === 'sdel') delSessItem(+el.getAttribute('data-i'));
    else if (act === 'sclose') closeSess();
    else if (act === 'sreorder') { sess.reorder = !sess.reorder; sess.pick = null; renderSess(); }
    else if (act === 'ssnum') { var sn = +el.getAttribute('data-i'); sess.pick = sess.pick === sn ? null : sn; renderSess(); }
    else if (act === 'ssto') ssMove(+el.getAttribute('data-i'), +el.getAttribute('data-to'));
    else if (act === 'sdetails') { var sid = sess.id; closeSess(); openSheet(sid); }
    else if (act === 'sfinish') { var fid = sess.id; closeSess(); var ft = find(fid); if (ft && !ft.done) doTick(fid); }
    else if (act === 'settings') openSettings();
    else if (act === 'setv') {
      var sk2 = el.getAttribute('data-k'), sv2 = el.getAttribute('data-val');
      setDraft[sk2] = sk2 === 'units' ? sv2 : parseInt(sv2, 10); renderSettings();
    }
    else if (act === 'setclearcal') { setDraft.clearCal = true; renderSettings(); }
    else if (act === 'setcancel') closeSettings();
    else if (act === 'setsave') saveSettings();
    else if (act === 'filter') { var fv = el.getAttribute('data-val') || null; filterCat = (fv && filterCat === fv) ? null : fv; if (filterCat) store.set('filterCat', filterCat); else store.del('filterCat'); render(); }
    else if (act === 'week') openWeek();
    else if (act === 'review') openStale();
    else if (act === 'rvkeep' || act === 'rvtoday' || act === 'rvdrop') rvAct(act);
    else if (act === 'rvskip') rvAdvance();
    else if (act === 'rvclose') closeReview();
    else if (act === 'rvmove') {
      var w = el.getAttribute('data-when');
      for (var oi = todos.length - 1; oi >= 0; oi--) {
        var ot = todos[oi];
        if (inMode(ot) && !ot.done && !ot.blocked && !isOut(ot) && ot.due_date && ot.due_date < curToday()) doQuick(ot.id, w);
      }
      renderReview();
    }
    else if (act === 'preview') openPreview();
    else if (act === 'pvclose') closePreview();
    else if (act === 'pvnum') { var pi2 = +el.getAttribute('data-i'); pv.pick = pv.pick === pi2 ? null : pi2; renderPreview(); }
    else if (act === 'pvto') pvTo(+el.getAttribute('data-i'), +el.getAttribute('data-to'));
    else if (act === 'pvtick') pvTick(id);
    else if (act === 'pvlater') pvLater(id);
    else if (act === 'pvtoday') pvToday(id);
    else if (act === 'pvtonight') pvTonight(id);
    else if (act === 'mode') setMode(el.getAttribute('data-val'));
    else if (act === 'askbtn') askDone(+el.getAttribute('data-i'));
    else if (act === 'nav') navTo(el.getAttribute('data-view'));
    else if (act === 'rail') toggleRail();
    else if (act === 'soon') toast('Workouts is coming soon');
    else if (act === 'ptnum') { var pj = +el.getAttribute('data-i'); ptPick = ptPick === pj ? null : pj; renderPlan(); }
    else if (act === 'ptto') ptMove(+el.getAttribute('data-i'), +el.getAttribute('data-to'));
    else if (act === 'ptpush') ptPush(id);
    else if (act === 'stab') {
      if (settingsTab === 'general' && $('setCity')) { setDraft.cityText = $('setCity').value; setDraft.calText = $('setCal') ? $('setCal').value : ''; }
      settingsTab = el.getAttribute('data-val'); renderSettings();
    }
    else if (act === 'slist') { editing.list = el.getAttribute('data-val') === 'work' ? 'work' : 'personal'; renderSheet(); }
    else if (act === 'stime') { editing.time = el.getAttribute('data-val') || null; renderSheet(); }
    else if (act === 'srecur') { editing.recur = el.getAttribute('data-val') || null; if (!editing.recur) { editing.until = null; editing.untilOn = false; } renderSheet(); }
    else if (act === 'suntil') { editing.untilOn = el.getAttribute('data-val') === 'date'; if (!editing.untilOn) editing.until = null; renderSheet(); }
    else if (act === 'sfocus') {
      if (!editing.focus && focusCount(editing.id) >= 3) toast('Focus is full (3), unstar one first');
      else { editing.focus = !editing.focus; if (editing.focus) editing.low = false; renderSheet(); }
    }
    else if (act === 'toggledone') { showDone = !showDone; render(); }
    else if (act === 'togglelow') { showLow = !showLow; render(); }
    else if (act === 'toggleshelved') { showShelved = !showShelved; render(); }
    else if (act === 'sproj') { var pv2 = el.getAttribute('data-val') || null; editing.pp = (!pv2 || editing.pp === pv2) ? null : pv2; if (!editing.pp) editing.bl = false; renderSheet(); }
    else if (act === 'sppbl') { editing.bl = el.getAttribute('data-val') === '1'; renderSheet(); }
    else if (act === 'ppbl') { var pbt = find(id); if (pbt) { var pbv = el.getAttribute('data-val') === '1', pbb = { pp_backlog: !!pbt.pp_backlog }; pbt.pp_backlog = pbv; render(); patchTodo(id, { pp_backlog: pbv }, pbb); toast(pbv ? 'Moved to the backlog' : 'Added to your Personal list'); } }
    else if (act === 'low') doLow(id, el.getAttribute('data-val') === '1');
    else if (act === 'slow') { editing.low = !editing.low; renderSheet(); }
    else if (act === 'swhen') { editing.due = whenToDate(el.getAttribute('data-val')); if (editing.due) editing.low = false; renderSheet(); }
    else if (act === 'scat') { var v = el.getAttribute('data-val'); editing.cat = (!v || editing.cat === v) ? null : v; renderSheet(); }
    else if (act === 'save') saveSheet();
    else if (act === 'cancel') closeSheet();
    else if (act === 'delete') deleteFromSheet();
    else if (act === 'gatesave') saveGate();
    else if (act === 'theme') cycleTheme();
  }, false);

  $('eDate').addEventListener('change', function () {
    if (editing) { editing.due = this.value || null; if (editing.due) editing.low = false; renderSheet(); }
  }, false);
  $('eEndDate').addEventListener('change', function () {
    if (editing) { editing.until = this.value || null; renderSheet(); }
  }, false);
  $('eTimeIn').addEventListener('change', function () {
    if (editing) { editing.time = this.value || null; renderSheet(); }
  }, false);
  $('eTitle').addEventListener('keydown', function (e) { if (e.keyCode === 13) saveSheet(); }, false);
  $('gateInput').addEventListener('keydown', function (e) { if (e.keyCode === 13) saveGate(); }, false);

  $('sForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('sInput'), v = inp.value;
    if (v.replace(/\s+/g, '')) { inp.value = ''; addSessItems(v); }
    inp.focus();
  }, false);

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('addInput'), text = input.value.replace(/^\s+|\s+$/g, '');
    if (!text || !token) return;
    input.value = ''; input.blur();
    api('POST', '', mode === 'work' ? { text: text, list: 'work' } : { text: text }, function (s, d) {
      if (s === 201 && d && d.todo) {
        merge(d.todo); lastMutation = Date.now(); render();
        toast(inMode(d.todo) ? 'Added' : 'Added to ' + (d.todo.list === 'work' ? 'Work' : 'Personal'));
        if (d.todo.is_session && inMode(d.todo)) openSession(d.todo.id);
      }
      else if (s === 401) { showGate('That token was not accepted.'); }
      else { input.value = text; toast('Could not add, try again'); }
    });
  }, false);

  function hidden() { return document.hidden === true || document.webkitHidden === true; }
  document.addEventListener('visibilitychange', function () { if (!hidden()) load(); }, false);
  document.addEventListener('webkitvisibilitychange', function () { if (!hidden()) load(); }, false);
  window.addEventListener('pageshow', load, false);
  window.addEventListener('focus', load, false);
  setInterval(function () { if (hidden()) return; if (idle && ++idleTicks < 40) return; idleTicks = 0; load(); }, 15000); // idle: refresh every 10 minutes
  setInterval(tickClock, 10000);
  setInterval(function () { if (!idle) loadGlance(); }, 10 * 60000);

  /* ---------- shared helpers for the feature modules (budget, screensaver, insights, calendar) ---------- */
  App.$ = $; App.esc = esc; App.api = api; App.store = store; App.toast = toast; App.setHTML = setHTML; App.setCls = setCls;
  App.today = curToday; App.addDays = addDays; App.diffDays = diffDays; App.dowOf = dowOf; App.pad = pad; App.fmtDate = fmtDate;
  App.localISO = localISO; App.parseTS = parseTS; App.nowMs = nowMs; App.isFocus = isFocus; App.inMode = inMode;
  App.DOWL = DOWL; App.DOWS = DOWS; App.MONS = MONS; App.MONL = MONL;
  App.todos = function () { return todos; };
  App.mode = function () { return mode; };
  App.token = function () { return token; };
  App.settings = settings;
  App.render = render;
  App.ask = ask;
  App.reload = function () { lastMutation = 0; load(); };
  // Projects board <-> Work list
  App.isPaused = isPaused;
  App.isShelved = isShelved;
  App.inBacklog = inBacklog;
  App.listHTML = function (arr) { return listHTML(arr); };
  App.find = function (id) { return find(id); };
  App.pprojects = function () { return pprojs; };
  App.setPProjects = function (list) { // Personal Projects: names for the task chip + editor, statuses for the shelved rule
    var st = {}, nm = {}, i, sig;
    list = list || [];
    for (i = 0; i < list.length; i++) { st[list[i].id] = list[i].status; nm[list[i].id] = list[i].name; }
    sig = JSON.stringify(list.map(function (p) { return [p.id, p.name, p.status]; }));
    pprojs = list; ppStat = st; ppName = nm;
    if (sig !== ppSig) { ppSig = sig; render(); }
  };
  App.cmpWork = autoCmp;
  App.setProjects = function (list) { // priority and hand-set order of each project, used by the Work list's automatic order
    var pr = {}, od = {}, i, p, sig;
    for (i = 0; i < (list || []).length; i++) {
      p = list[i];
      if (p.status === 'done') continue;
      pr[p.name] = p.status === 'hold' ? -1 : (p.prio || 0);
      if (p.order && p.order.length) od[p.name] = p.order;
    }
    sig = JSON.stringify([pr, od]);
    if (sig === projSig) return;
    projSig = sig; projPrio = pr; projOrder = od;
    render();
  };
  App.dayIds = function (listName) { // today's order for a list, as ids
    var saved = mode, ids;
    mode = listName === 'work' ? 'work' : 'personal';
    try { ids = pvList(); } finally { mode = saved; }
    return ids;
  };
  var spSaving = false, spQueue = null;
  App.savePlan = function (ids, listName) { // save an order for today and show it straight away
    var t0 = curToday(), n = 0, i, t, list = [];
    for (i = 0; i < ids.length; i++) { t = find(ids[i]); if (t && !t.done) { n++; t.plan_order = n; t.plan_date = t0; list.push(t.id); } }
    lastMutation = Date.now();
    render();
    if (spSaving) { spQueue = [list, listName]; return; }
    spSaving = true;
    api('POST', '', { plan: list, list: listName === 'work' ? 'work' : 'personal' }, function (st) {
      spSaving = false;
      if (st !== 200) toast('Could not save the order, check your connection');
      var q = spQueue; spQueue = null;
      if (q) App.savePlan(q[0], q[1]); else lastMutation = Date.now();
    });
  };
  App.mutated = function () { lastMutation = Date.now(); };
  App.calSyncSoon = function () { lastCalSync = 0; };
  App.hidden = function () { return hidden(); };
  App.setIdle = function (b) {
    b = !!b; if (idle === b) return;
    idle = b; idleTicks = 0; clockSkip = 0; applyTheme();
    if (!b) { lastMutation = 0; tickClock(); load(); loadGlance(); }
  };
  App.isIdle = function () { return idle; };
  App.applySettings = function (sv) { applySettings(sv); render(); };
  App.addTab = function (id, label, fn) { App.tabs[id] = { render: fn }; App.tabList.push([id, label]); };
  App.refreshTab = function () { if (setDraft && settingsTab !== 'general' && App.tabs[settingsTab]) App.tabs[settingsTab].render($('tabBody')); };
  App.register = function (name, def) {
    App.views[name] = def;
    var n = $('n' + name.charAt(0).toUpperCase() + name.slice(1));
    if (n) n.style.display = '';
    if (view === name) render();
  };

  /* ---------- boot ---------- */
  var m = /[#&]t=([^&]+)/.exec(window.location.hash || '');
  if (m) { token = decodeURIComponent(m[1]).toLowerCase(); store.set('todoToken', token); }
  else token = store.get('todoToken');
  var qm = /[?&]open=([^&#]+)/.exec(window.location.search || '');
  if (qm) pendingOpen = decodeURIComponent(qm[1]);
  initPlan(); tickClock(); render();
  if (token) { load(); loadGlance(); loadSettings(); } else showGate('');
})();
