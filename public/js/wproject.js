(function () {
  'use strict';
  /* Work project page (v34): one Work project's details (owner, requester, recruiter, goal, success criteria, dates,
     links, campaign codes, RAG), its open and recently finished tasks and its activity log.
     Opened from the board's "Open ›" button and from Manage projects; Back returns to the board.
     Data: GET/PATCH /api/projects?page= / ?meta=1 (api/_wpmeta.js). Styles: work.css (.wp*). */
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var sel = '', pages = {}, loading = {}, failed = {}, editing = false, draft = null, noKeep = false, saving = false, formMsg = '';
  var showDone = true, showAct = true, mainTop = 0, sideTop = 0, scrollFor = '';
  try { sel = store.get('wpSel') || ''; } catch (e) { sel = ''; }

  var GROUPS = ['slack', 'groups', 'studies', 'other'];
  var GLABEL = { slack: 'Slack', groups: 'Prolific Groups', studies: 'Prolific Studies', other: 'Other links' };
  var GHINT = { slack: 'The initial request and any related channels or threads', groups: '', studies: '', other: 'Linear project and anything else' };
  var DATES = ['requested', 'started', 'target', 'due'];
  var DLABEL = { requested: 'Requested', started: 'Started', target: 'Target', due: 'Due' };
  var PEOPLE = ['owner', 'requester', 'recruiter'];
  var PLABEL = { owner: 'Owner', requester: 'Requester', recruiter: 'Recruiter' };
  var RAG = [['', 'Not set'], ['r', 'Red'], ['a', 'Amber'], ['g', 'Green']];
  var RAGN = { r: 'Red', a: 'Amber', g: 'Green' };
  var PRIO = ['None', 'Low', 'Medium', 'High'];
  var MAXROWS = 25;

  function onView() { return App.view && App.view() === 'wproject'; }
  function proj() { // the project as the board knows it (name, prio, status)
    var p = App.boardProject ? App.boardProject(sel) : null, l, i;
    if (!p && App.projects && App.projects.list) { l = App.projects.list(); for (i = 0; i < l.length; i++) if (l[i].id === sel) p = l[i]; }
    return p;
  }
  function pg() { return pages[sel] || null; }
  function meta() { var d = pg(); return (d && d.meta) || {}; }
  function personOf(id) {
    var d = pg(), l = (d && d.people) || [], i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function personText(id) {
    if (!id) return '';
    var pe = personOf(id);
    return pe ? pe.name + (pe.removed ? ' (removed)' : '') : '(removed)';
  }
  function clientOf(id) {
    var d = pg(), l = (d && d.clients) || [], i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function pastDue(p, m) { return !!(m.dates && m.dates.due && m.dates.due < App.today() && p && p.status !== 'done'); }
  function fmtDay(d) { return d ? App.fmtDate(d) : ''; }
  function ago(at) {
    var t = App.parseTS ? App.parseTS(at) : Date.parse(at), s = (Date.now() - t) / 1000;
    if (!(s >= 0)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return App.fmtDate(String(at).slice(0, 10));
  }
  function host(u) { var m = /^https:\/\/([^\/?#]+)/.exec(u || ''); return m ? m[1].replace(/^www\./, '') : u; }
  function copyMeta(m) { return JSON.parse(JSON.stringify(m || {})); }

  /* ---------- tasks ---------- */
  function workOf(name, done) {
    var all = App.todos(), out = [], i, t;
    for (i = 0; i < all.length; i++) {
      t = all[i];
      if ((t.list || 'personal') === 'work' && !t.is_session && t.category === name && !!t.done === done) out.push(t);
    }
    return out;
  }
  function openTasks(p) {
    var b = App.boardTasks ? App.boardTasks(p.id) : null, l;
    if (b) return b;
    l = workOf(p.name, false); // a completed project is not on the board: same automatic order as the Work list
    l.sort(App.cmpWork);
    return l;
  }
  function doneTasks(p) {
    var from = App.addDays(App.today(), -30), l = workOf(p.name, true), out = [], i;
    for (i = 0; i < l.length; i++) if (l[i].done_at && l[i].done_at.slice(0, 10) >= from) out.push(l[i]);
    out.sort(function (a, b) { return a.done_at < b.done_at ? 1 : a.done_at > b.done_at ? -1 : 0; });
    return out.slice(0, 20);
  }

  /* ---------- activity ---------- */
  function evText(e) {
    var t = e.text || '';
    if (e.kind === 'created') return 'Created';
    if (e.kind === 'renamed') return 'Renamed: ' + esc(t);
    if (e.kind === 'prio') return 'Priority: ' + (PRIO[+t] || esc(t));
    if (e.kind === 'status') return 'Status: ' + (t === 'hold' ? 'On hold' : t === 'done' ? 'Completed' : 'Active');
    if (e.kind === 'rag') return 'RAG: ' + (RAGN[t] ? '<span class="wprag wprag-' + t + '"></span>' + RAGN[t] : 'not set');
    if (e.kind === 'client') return t ? 'Client: ' + esc(t) : 'Internal';
    if (e.kind === 'client_removed') return 'Back to Internal (client ' + esc(t) + ' was removed)';
    if (PLABEL[e.kind]) return PLABEL[e.kind] + ': ' + (t ? esc(t) : 'cleared');
    if (e.kind === 'details') {
      var names = { goal: 'goal', success: 'success criteria', dates: 'dates', links: 'links', codes: 'campaign codes' };
      return 'Edited ' + esc(t.split(',').map(function (k) { return names[k] || k; }).join(', '));
    }
    return esc(e.kind + (t ? ': ' + t : ''));
  }

  /* ---------- page ---------- */
  function ragSeg(m) {
    var h = '<span class="sg sm wpragsg">', i, cur = m.rag || '';
    for (i = 0; i < RAG.length; i++) {
      h += '<button class="' + (cur === RAG[i][0] ? 'on' : '') + '" data-wp="rag" data-val="' + RAG[i][0] + '">' +
        (RAG[i][0] ? '<span class="wprag wprag-' + RAG[i][0] + '"></span>' : '') + RAG[i][1] + '</button>';
    }
    return h + '</span>';
  }
  function seg(kind, labels, cur) {
    var h = '<span class="sg sm">', i;
    for (i = 0; i < labels.length; i++) h += '<button class="' + (i === cur ? 'on' : '') + '" data-wp="' + kind + '" data-val="' + i + '">' + labels[i] + '</button>';
    return h + '</span>';
  }
  function textBlock(v) { return esc(v).replace(/\n/g, '<br>'); }
  function sideHTML(p, m, d) {
    var cl = m.client ? clientOf(m.client) : null;
    var h = '<div class="wphd"><b class="wpnm">' + (cl ? App.clientLogo(cl, 'lg') : '') + esc(p.name) + '</b><div class="wppills">' +
      (p.status === 'done' ? '<span class="bdp">Completed</span>' : p.status === 'hold' ? '<span class="bdp hold">On hold</span>' : '<span class="bdp wpact">Active</span>') +
      (p.prio ? '<span class="bdp bdp' + p.prio + '">' + PRIO[p.prio] + '</span>' : '') +
      (pastDue(p, m) ? '<span class="bdh bad pdue">Past due</span>' : '') + '</div></div>';
    h += '<div class="wpsec"><div class="lbl">For</div>' + (m.client ? '<span class="wpfor">' + (cl ? App.clientLogo(cl) + esc(cl.name) : '(client removed)') + '</span>' : '<span class="wpfor int">Internal</span>') + '</div>';
    h += '<div class="wpsec"><div class="lbl">RAG status</div>' + ragSeg(m) + '</div>';
    if (p.status !== 'done') {
      h += '<div class="wpsec"><div class="lbl">Priority</div>' + seg('prio', PRIO, p.prio || 0) + '</div>';
      h += '<div class="wpsec"><div class="lbl">Status</div>' + seg('stat', ['Active', 'On hold'], p.status === 'hold' ? 1 : 0) + '</div>';
    }
    var i, k, any = false;
    h += '<div class="wpsec"><div class="lbl">People</div><dl class="wpdl">';
    for (i = 0; i < PEOPLE.length; i++) {
      k = PEOPLE[i];
      h += '<dt>' + PLABEL[k] + '</dt><dd' + (m[k] ? '' : ' class="none"') + '>' + (m[k] ? esc(personText(m[k])) : 'Not set') + '</dd>';
    }
    h += '</dl></div><div class="wpsec"><div class="lbl">Dates</div><dl class="wpdl">';
    for (i = 0; i < DATES.length; i++) {
      k = DATES[i];
      var v = m.dates && m.dates[k];
      if (k === 'requested' && !v && d && d.created) h += '<dt>Requested</dt><dd>' + fmtDay(d.created) + ' <small>(created)</small></dd>';
      else h += '<dt>' + DLABEL[k] + '</dt><dd' + (v ? (k === 'due' && pastDue(p, m) ? ' class="late"' : '') : ' class="none"') + '>' + (v ? fmtDay(v) : 'Not set') + '</dd>';
    }
    h += '</dl></div>';
    h += '<div class="wpsec"><div class="lbl">Goal</div>' + (m.goal ? '<div class="wptext">' + textBlock(m.goal) + '</div>' : '<div class="wpnone">Not written yet</div>') + '</div>';
    h += '<div class="wpsec"><div class="lbl">Success criteria</div>' + (m.success ? '<div class="wptext">' + textBlock(m.success) + '</div>' : '<div class="wpnone">Not written yet</div>') + '</div>';
    var L = m.links || {};
    for (i = 0; i < GROUPS.length; i++) {
      var rows = L[GROUPS[i]] || [], j;
      if (!rows.length) continue;
      any = true;
      h += '<div class="wpsec"><div class="lbl">' + GLABEL[GROUPS[i]] + '</div><ul class="wplinks">';
      for (j = 0; j < rows.length; j++) {
        h += '<li><a href="' + esc(rows[j].u) + '" target="_blank" rel="noopener noreferrer">' + esc(rows[j].n || host(rows[j].u)) + '</a>' +
          (rows[j].init ? '<span class="bdh wpinitb">Initial request</span>' : '') + '</li>';
      }
      h += '</ul></div>';
    }
    if (!any) h += '<div class="wpsec"><div class="lbl">Links</div><div class="wpnone">No links yet</div></div>';
    var C = m.codes || [];
    h += '<div class="wpsec"><div class="lbl">Campaign codes</div>';
    if (!C.length) h += '<div class="wpnone">None yet</div>';
    else {
      h += '<ul class="wpcodes">';
      for (i = 0; i < C.length; i++) h += '<li>' + (C[i].n ? '<span>' + esc(C[i].n) + '</span>' : '') + '<code>' + esc(C[i].c) + '</code></li>';
      h += '</ul>';
    }
    return h + '</div>';
  }
  function pickHTML(k, cur) {
    var d = pg(), l = (d && d.people) || [], h = '<select class="setinput" data-f="' + k + '"><option value="">Not set</option>', i, seen = false;
    for (i = 0; i < l.length; i++) {
      if (l[i].removed && l[i].id !== cur) continue;
      if (l[i].id === cur) seen = true;
      h += '<option value="' + esc(l[i].id) + '"' + (l[i].id === cur ? ' selected' : '') + '>' + esc(l[i].name + (l[i].removed ? ' (removed)' : '')) + '</option>';
    }
    if (cur && !seen) h += '<option value="' + esc(cur) + '" selected>(removed)</option>';
    return h + '</select>';
  }
  function clientPick(cur) {
    var d = pg(), l = (d && d.clients) || [], h = '<select class="setinput" data-f="client"><option value="">Pick a client…</option>', i, seen = false;
    for (i = 0; i < l.length; i++) {
      if (l[i].id === cur) seen = true;
      h += '<option value="' + esc(l[i].id) + '"' + (l[i].id === cur ? ' selected' : '') + '>' + esc(l[i].name) + '</option>';
    }
    if (cur && !seen) h += '<option value="' + esc(cur) + '" selected>(removed)</option>';
    return h + '</select>';
  }
  function formHTML() {
    var m = draft, h = '<div class="wpform"><h2>Edit details</h2>', i, k, j, d = pg();
    h += '<div class="wpfld"><span class="lbl">Project is</span>' + seg('ctype', ['Internal', 'Client'], draft.isClient ? 1 : 0) + '</div>';
    if (draft.isClient) {
      h += '<label class="wpfld"><span class="lbl">Client</span>' + clientPick(m.client || '') + '</label>';
      if (!d || !d.clients || !d.clients.length) h += '<div class="pphint">No clients yet. Add them in Manage projects, under Work clients.</div>';
    }
    h += '<div class="wpflds">';
    for (i = 0; i < PEOPLE.length; i++) { k = PEOPLE[i]; h += '<label class="wpfld"><span class="lbl">' + PLABEL[k] + '</span>' + pickHTML(k, m[k] || '') + '</label>'; }
    h += '</div>';
    if (!d || !d.people || !d.people.length) h += '<div class="pphint">No people yet. Add them in Manage projects, under Work people.</div>';
    h += '<label class="wpfld"><span class="lbl">Goal / description</span><textarea class="setinput" data-f="goal" rows="4" maxlength="2000">' + esc(m.goal || '') + '</textarea></label>';
    h += '<label class="wpfld"><span class="lbl">Success criteria</span><textarea class="setinput" data-f="success" rows="3" maxlength="2000">' + esc(m.success || '') + '</textarea></label>';
    h += '<div class="lbl">Dates</div><div class="wpflds">';
    for (i = 0; i < DATES.length; i++) {
      k = DATES[i];
      h += '<label class="wpfld"><span class="lbl">' + DLABEL[k] + '</span><input class="setinput" type="date" data-f="d:' + k + '" value="' + esc((m.dates && m.dates[k]) || '') + '"></label>';
    }
    h += '</div>';
    for (i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i], rows = (m.links && m.links[g]) || [];
      h += '<div class="wplg" data-g="' + g + '"><div class="lbl">' + GLABEL[g] + '</div>' + (GHINT[g] ? '<div class="pphint">' + GHINT[g] + '</div>' : '');
      for (j = 0; j < rows.length; j++) {
        h += '<div class="wplrow"><input class="setinput wpln" type="text" maxlength="60" placeholder="Name" data-f="ln:' + g + ':' + j + '" value="' + esc(rows[j].n || '') + '">' +
          '<input class="setinput wplu" type="url" maxlength="500" placeholder="https://…" autocapitalize="off" autocorrect="off" spellcheck="false" data-f="lu:' + g + ':' + j + '" value="' + esc(rows[j].u || '') + '">' +
          (g === 'slack' ? '<button type="button" class="chip wpinit' + (rows[j].init ? ' on' : '') + '" data-wp="init" data-i="' + j + '">' + (rows[j].init ? '✓ ' : '') + 'Initial request</button>' : '') +
          '<button type="button" class="pbtn del" data-wp="rmrow" data-g="' + g + '" data-i="' + j + '" aria-label="Remove this link">×</button></div>';
      }
      if (rows.length < MAXROWS) h += '<button type="button" class="btn sm wpaddrow" data-wp="addrow" data-g="' + g + '">+ Add ' + (g === 'other' ? 'link' : GLABEL[g] + ' link') + '</button>';
      h += '</div>';
    }
    var C = m.codes || [];
    h += '<div class="wplg" data-g="codes"><div class="lbl">Campaign codes</div><div class="pphint">Plain text, not links.</div>';
    for (j = 0; j < C.length; j++) {
      h += '<div class="wplrow"><input class="setinput wpln" type="text" maxlength="60" placeholder="Name" data-f="cn:' + j + '" value="' + esc(C[j].n || '') + '">' +
        '<input class="setinput wplu" type="text" maxlength="100" placeholder="Code" autocapitalize="off" autocorrect="off" spellcheck="false" data-f="cc:' + j + '" value="' + esc(C[j].c || '') + '">' +
        '<button type="button" class="pbtn del" data-wp="rmrow" data-g="codes" data-i="' + j + '" aria-label="Remove this code">×</button></div>';
    }
    if (C.length < MAXROWS) h += '<button type="button" class="btn sm wpaddrow" data-wp="addrow" data-g="codes">+ Add campaign code</button>';
    h += '</div>';
    if (formMsg) h += '<div class="sethint wperr">' + esc(formMsg) + '</div>';
    h += '<div class="row wpfoot"><span class="sp"></span><button type="button" class="btn" data-wp="cancel">Cancel</button><button type="button" class="btn primary" data-wp="save"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Saving…' : 'Save details') + '</button></div></div>';
    return h;
  }
  function mainHTML(p, d) {
    if (editing && draft) return formHTML();
    var open = openTasks(p), done = doneTasks(p), ev = d ? d.events || [] : null, h = '', i;
    if (p.status !== 'done') h += '<form class="wpadd" id="wpTaskForm" autocomplete="off"><input id="wpTask" type="text" maxlength="200" placeholder="Add a task to ' + esc(p.name) + '…" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false"><button type="submit">Add</button></form>';
    h += '<h2>Open tasks<span class="count">' + open.length + '</span></h2>';
    h += open.length ? App.listHTML(open) : '<p class="empty">Nothing open in this project.</p>';
    h += App.wsSection ? App.wsSection(p.id) : '';
    h += '<button class="donebtn" data-wp="done">' + (showDone ? '▾' : '▸') + ' Done in the last 30 days (' + done.length + ')</button>';
    if (showDone) h += done.length ? App.listHTML(done) : '<p class="empty">Nothing finished recently.</p>';
    h += '<button class="ppacth" data-wp="act" aria-expanded="' + (showAct ? 'true' : 'false') + '">' + (showAct ? '▾' : '▸') + ' Activity' + (ev ? '<small>' + ev.length + ' entries</small>' : '') + '</button>';
    if (showAct) {
      if (!ev) h += '<div class="pphint">Loading…</div>';
      else if (!ev.length) h += '<div class="pphint">Nothing yet.</div>';
      else {
        h += '<ul class="ppev">';
        for (i = 0; i < ev.length && i < 40; i++) h += '<li><span>' + evText(ev[i]) + '</span><small>' + ago(ev[i].at) + '</small></li>';
        h += '</ul>';
      }
    }
    return h;
  }
  function pageHTML() {
    var p = proj(), d = pg();
    var top = '<div class="wptop"><button class="btn wpback" data-wp="back">‹ Board</button><span class="sp"></span>' +
      (p && d && !editing ? '<button class="btn" data-wp="edit">Edit details</button>' : '') + '</div>';
    if (!p) return top + '<p class="empty">' + (sel ? 'Loading…' : 'No project picked.') + '</p>';
    if (!d) return top + (failed[sel] ? '<p class="empty">Could not load this project.</p><div class="row"><button class="btn sm" data-wp="retry">Try again</button></div>' : '<p class="empty">Loading…</p>');
    return top + '<div class="wpwrap"><aside class="wpside">' + sideHTML(p, d.meta || {}, d) + '</aside><div class="wpmain">' + mainHTML(p, d) + '</div></div>';
  }

  /* ---------- fixed-height layout (wider than 760px), same idea as My projects ---------- */
  function fixedMode() { return !(window.matchMedia && window.matchMedia('(max-width:760px)').matches); }
  function setH(el, px) { if (!el) return; var v = px === '' ? '' : Math.round(Math.max(px, 60)) + 'px'; if (el.style.height !== v) el.style.height = v; }
  function setTop(el, v) { if (el && el.scrollTop !== v) el.scrollTop = v; }
  function layout() {
    var v = $('vWproject'), pane = $('wpPane'); if (!v || !pane || !onView()) return;
    var fix = fixedMode(), on = /(^|\s)wpfix(\s|$)/.test(v.className), wrap = pane.querySelector('.wpwrap');
    if (fix !== on) v.className = fix ? v.className + ' wpfix' : v.className.replace(/\s*wpfix/g, '');
    if (!wrap) return;
    if (!fix) { setH(wrap, ''); setH(pane.querySelector('.wpside'), ''); setH(pane.querySelector('.wpmain'), ''); return; }
    setTop(pane.parentNode, 0);
    var H = window.innerHeight || document.documentElement.clientHeight, wh = H - wrap.getBoundingClientRect().top - 10;
    setH(wrap, wh); setH(pane.querySelector('.wpside'), wh); setH(pane.querySelector('.wpmain'), wh);
  }
  function grabScroll() {
    var pane = $('wpPane'), m = pane && pane.querySelector('.wpmain'), s = pane && pane.querySelector('.wpside');
    if (m && s) { mainTop = m.scrollTop; sideTop = s.scrollTop; scrollFor = pane.getAttribute('data-k') || ''; } // what was on screen: project + form or not
  }
  function putScroll() {
    var pane = $('wpPane'), m = pane.querySelector('.wpmain'), s = pane.querySelector('.wpside');
    if (!m || !s || !fixedMode()) return;
    if (scrollFor !== sel + (editing ? ':e' : '')) { mainTop = 0; } // a different project or the form just opened: start at the top
    setTop(m, mainTop); setTop(s, sideTop);
  }
  var lt = null;
  function relayout() { if (lt) clearTimeout(lt); lt = setTimeout(function () { lt = null; grabScroll(); layout(); putScroll(); }, 120); }
  window.addEventListener('resize', relayout, false);
  window.addEventListener('orientationchange', function () { relayout(); setTimeout(relayout, 500); }, false); // iOS 9 reports the new height late

  // Background refreshes call this every 30 s: it must write nothing when nothing changed (iOS 9 cursor and flicker).
  function paint() {
    if (!onView()) return;
    var pane = $('wpPane'); if (!pane) return;
    var p = proj();
    App.setHTML($('viewTitle'), p ? 'Projects<small>' + esc(p.name) + '</small>' : 'Projects');
    var keep = {}, f = pane.querySelectorAll('[data-f], #wpTask'), i, k, ae = document.activeElement, focusKey = null, s0 = null, s1 = null;
    for (i = 0; i < f.length; i++) keep[f[i].getAttribute('data-f') || f[i].id] = f[i].value;
    if (ae && pane.contains(ae) && (ae.getAttribute('data-f') || ae.id === 'wpTask')) {
      focusKey = ae.getAttribute('data-f') || ae.id;
      try { if (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text')) { s0 = ae.selectionStart; s1 = ae.selectionEnd; } } catch (e) {}
    }
    var y = window.pageYOffset;
    grabScroll();
    var changed = App.setHTML(pane, pageHTML()), key = sel + (editing ? ':e' : '');
    if (pane.getAttribute('data-k') !== key) pane.setAttribute('data-k', key);
    layout(); // writes nothing when the sizes are already right
    if (!changed) { noKeep = false; return; }
    putScroll();
    if (!fixedMode() && window.pageYOffset !== y) window.scrollTo(0, y);
    if (noKeep) { noKeep = false; return; } // rows were added or removed: the form was rebuilt from the draft
    f = pane.querySelectorAll('[data-f], #wpTask');
    for (i = 0; i < f.length; i++) {
      k = f[i].getAttribute('data-f') || f[i].id;
      if (keep.hasOwnProperty(k) && f[i].value !== keep[k]) f[i].value = keep[k];
      if (k === focusKey && f[i] !== ae) { f[i].focus(); if (s0 !== null) try { f[i].setSelectionRange(s0, s1); } catch (e2) {} }
    }
  }

  /* ---------- data ---------- */
  function fetchPage(id, cb) {
    if (!id || loading[id]) return;
    if (!App.token()) { App.whenToken(function () { fetchPage(id, cb); }); return; }
    loading[id] = true;
    App.api('GET', '?page=' + encodeURIComponent(id), null, function (s, d) {
      loading[id] = false;
      if (s === 200 && d && d.meta) { pages[id] = d; failed[id] = false; } else if (!pages[id]) failed[id] = true;
      paint(); if (cb) cb();
      if (App.wsLoad && d && d.meta) App.wsLoad(id);
    }, '/api/projects');
  }
  function toBoard(d) { // the board header shows RAG, owner and due: give it the new values
    if (!App.boardCards || !d) return;
    var m = d.meta || {}, c = {};
    if (m.rag) c.rag = m.rag;
    if (m.owner) c.owner = m.owner;
    if (m.dates && m.dates.due) c.due = m.dates.due;
    if (m.client) c.client = m.client;
    App.boardCards(d.id, c, d.people, d.clients);
  }
  function errMsg(s, d) { return s === 400 && d && d.error ? d.error.charAt(0).toUpperCase() + d.error.slice(1) : 'Could not save, check your connection and try again'; }
  function setRag(v) {
    var d = pg(); if (!d || saving) return;
    var was = d.meta.rag || '';
    if (was === v) return;
    if (v) d.meta.rag = v; else delete d.meta.rag;
    paint();
    var id = sel;
    App.api('PATCH', '?id=' + encodeURIComponent(id) + '&meta=1', { rag: v || null }, function (s, r) {
      if (s === 200 && r && r.meta) { pages[id] = r; toBoard(r); App.toast(v ? 'RAG set to ' + RAGN[v] : 'RAG cleared'); }
      else { if (pages[id]) { if (was) pages[id].meta.rag = was; else delete pages[id].meta.rag; } App.toast(errMsg(s, r)); }
      paint();
    }, '/api/projects');
  }
  function setProj(body, okMsg) { // priority / status: the same call Manage projects makes
    var id = sel;
    App.api('PATCH', '?id=' + encodeURIComponent(id), body, function (s, d) {
      if (s === 200 && d && d.projects) { if (App.boardSet) App.boardSet(d.projects); if (okMsg) App.toast(okMsg); fetchPage(id); }
      else App.toast(errMsg(s, d));
      App.render();
    }, '/api/projects');
  }
  function readForm() { // what is typed in the form -> draft
    var pane = $('wpPane'); if (!pane || !draft) return;
    var f = pane.querySelectorAll('[data-f]'), i, k, v, m;
    for (i = 0; i < f.length; i++) {
      k = f[i].getAttribute('data-f'); v = f[i].value;
      if (PEOPLE.indexOf(k) >= 0 || k === 'goal' || k === 'success' || k === 'client') draft[k] = v;
      else if ((m = /^d:(\w+)$/.exec(k))) { draft.dates = draft.dates || {}; draft.dates[m[1]] = v; }
      else if ((m = /^l([nu]):(\w+):(\d+)$/.exec(k))) { var row = draft.links[m[2]][+m[3]]; if (row) row[m[1]] = v; }
      else if ((m = /^c([nc]):(\d+)$/.exec(k))) { var cr = draft.codes[+m[2]]; if (cr) cr[m[1]] = v; }
    }
  }
  function startEdit() {
    var d = pg(); if (!d) return;
    draft = copyMeta(d.meta);
    draft.isClient = !!draft.client;
    draft.dates = draft.dates || {};
    if (!draft.dates.requested && d.created) draft.dates.requested = d.created; // auto-set to the creation date, editable
    draft.links = draft.links || {};
    for (var i = 0; i < GROUPS.length; i++) draft.links[GROUPS[i]] = draft.links[GROUPS[i]] || [];
    draft.codes = draft.codes || [];
    editing = true; formMsg = ''; noKeep = true; paint();
  }
  function stopEdit() { editing = false; draft = null; formMsg = ''; noKeep = true; paint(); }
  function save() {
    if (!draft || saving) return;
    readForm();
    var out = {}, i, k;
    if (draft.isClient && !draft.client) { formMsg = 'Pick a client, or switch the project back to Internal'; noKeep = false; paint(); return; }
    out.client = draft.isClient ? draft.client : null;
    for (i = 0; i < PEOPLE.length; i++) out[PEOPLE[i]] = draft[PEOPLE[i]] || null;
    out.goal = draft.goal || null; out.success = draft.success || null;
    out.dates = {}; for (i = 0; i < DATES.length; i++) { k = DATES[i]; if (draft.dates[k]) out.dates[k] = draft.dates[k]; }
    out.links = {}; for (i = 0; i < GROUPS.length; i++) out.links[GROUPS[i]] = draft.links[GROUPS[i]];
    out.codes = draft.codes;
    saving = true; formMsg = ''; paint();
    var id = sel;
    App.api('PATCH', '?id=' + encodeURIComponent(id) + '&meta=1', { meta: out }, function (s, d) {
      saving = false;
      if (s === 200 && d && d.meta) { pages[id] = d; toBoard(d); editing = false; draft = null; noKeep = true; App.toast('Details saved'); }
      else { formMsg = errMsg(s, d); noKeep = false; }
      paint();
    }, '/api/projects');
  }
  function addTask(form) {
    var inp = form.querySelector('#wpTask'), p = proj(), title = inp ? (inp.value || '').replace(/^\s+|\s+$/g, '') : '';
    if (!title || !p) return;
    inp.value = '';
    App.api('POST', '', { title: title, category: p.name, list: 'work' }, function (s, d) {
      if (s === 201 && d && d.todo) { App.todos().push(d.todo); App.mutated(); App.toast('Added to ' + p.name); }
      else { inp.value = title; App.toast('Could not add, try again'); }
      App.render();
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.className || String(f.className).indexOf('wpadd') < 0) return;
    e.preventDefault(); addTask(f);
  }, false);
  document.addEventListener('click', function (e) {
    var el = e.target, a, g, i;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-wp'))) {
      if (el.getAttribute && (el.getAttribute('data-act') || el.tagName === 'A')) return; // task rows and links are not ours
      el = el.parentNode;
    }
    if (!el || el === document || el.disabled) return;
    a = el.getAttribute('data-wp');
    if (a === 'back') { editing = false; draft = null; App.navTo('board'); }
    else if (a === 'retry') { failed[sel] = false; paint(); fetchPage(sel); }
    else if (a === 'rag') setRag(el.getAttribute('data-val'));
    else if (a === 'prio') setProj({ prio: +el.getAttribute('data-val') });
    else if (a === 'stat') setProj({ status: el.getAttribute('data-val') === '1' ? 'hold' : 'active' }, el.getAttribute('data-val') === '1' ? 'On hold' : 'Active');
    else if (a === 'ctype') { if (draft) { readForm(); draft.isClient = el.getAttribute('data-val') === '1'; formMsg = ''; noKeep = true; paint(); } }
    else if (a === 'edit') startEdit();
    else if (a === 'cancel') stopEdit();
    else if (a === 'save') save();
    else if (a === 'done') { showDone = !showDone; paint(); }
    else if (a === 'act') { showAct = !showAct; paint(); }
    else if (a === 'addrow' || a === 'rmrow' || a === 'init') {
      if (!draft) return;
      readForm(); g = el.getAttribute('data-g'); i = +el.getAttribute('data-i');
      var list = g === 'codes' ? draft.codes : a === 'init' ? draft.links.slack : draft.links[g];
      if (a === 'addrow') { if (list.length < MAXROWS) list.push(g === 'codes' ? { n: '', c: '' } : { n: '', u: '' }); }
      else if (a === 'rmrow') list.splice(i, 1);
      else { var was = !!list[i].init, j; for (j = 0; j < list.length; j++) delete list[j].init; if (!was) list[i].init = true; } // one "Initial request"
      noKeep = true; paint();
      if (a === 'addrow') { // put the cursor in the new row
        var nf = $('wpPane').querySelectorAll(g === 'codes' ? '[data-f^="cn:"]' : '[data-f^="ln:' + g + ':"]');
        if (nf.length) try { nf[nf.length - 1].focus(); } catch (x) {}
      }
    }
  }, false);

  App.wpReload = function (id) { if (pages[id]) fetchPage(id); }; // v36: an accepted RAG changed the page
  App.openWorkProject = function (id) {
    if (!id) return;
    if (App.view && App.view() === 'board' && App.boardKeep) App.boardKeep();
    if (sel !== id) { mainTop = 0; sideTop = 0; scrollFor = ''; }
    sel = id; editing = false; draft = null; formMsg = '';
    try { store.set('wpSel', id); } catch (e) {}
    App.navTo('wproject');
  };
  App.register('wproject', {
    title: 'Projects',
    render: function () { paint(); },
    show: function () { window.scrollTo(0, 0); paint(); fetchPage(sel); }
  });
})();
