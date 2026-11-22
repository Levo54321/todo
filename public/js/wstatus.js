(function () {
  'use strict';
  /* Work status updates (v36): Copy for Claude, the Paste updates screen, and the Status updates section on a project page.
     Format: docs/work-status-format.md. Data: /api/projects ?statusparse=1 (read a pasted block, saves nothing), ?updates=
     (save / list), ?export=1 (the project list for work Claude). Styles: work.css (.ws*), review cards reuse .impcard (app.css). */
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc;
  var API = '/api/projects';
  var RAGN = { r: 'Red', a: 'Amber', g: 'Green' };
  var bulk = { box: false, msg: '', rv: null, busy: false, hint: '' };
  var pp = null;                        // the project page's own state: {pid, open: 'paste'|'manual'|'', box, msg, rv, busy, hint}
  var upd = {};                         // project id -> {list, loading, failed}
  var older = {}, openU = {};           // UI: older updates shown for a project; one update opened
  var exp = { changed: null, ever: true, at: 0, busy: false };

  function ago(iso) { return iso ? App.fmtDate(String(iso).slice(0, 10)) : ''; }
  function dot(r) { return r && RAGN[r] ? '<span class="wprag wprag-' + r + '"></span>' : ''; }
  function fresh(pid) { return { pid: pid, open: '', box: false, msg: '', rv: null, busy: false, hint: '' }; }

  /* ---------- one update, as a card body (history and review) ---------- */
  function listBlock(label, arr) {
    var h = '', i;
    if (!arr || !arr.length) return '';
    h += '<div class="wslbl">' + label + '</div><ul class="wsul">';
    for (i = 0; i < arr.length; i++) h += '<li>' + esc(arr[i]) + '</li>';
    return h + '</ul>';
  }
  function asksBlock(arr) {
    var h = '', i;
    if (!arr || !arr.length) return '';
    h += '<div class="wslbl">Asks of others</div><ul class="wsul">';
    for (i = 0; i < arr.length; i++) h += '<li>' + (arr[i].who ? '<b>' + esc(arr[i].who) + ':</b> ' : '') + esc(arr[i].what) + '</li>';
    return h + '</ul>';
  }
  function host(u) { var m = /^https:\/\/([^\/?#]+)/.exec(u || ''); return m ? m[1].replace(/^www\./, '') : u; }
  function srcBlock(s) {
    var h = '', g, i, L = { slack: 'Slack', linear: 'Linear' }, k, rows;
    s = s || {};
    for (k = 0; k < 2; k++) {
      g = k ? 'linear' : 'slack'; rows = s[g] || [];
      for (i = 0; i < rows.length; i++) h += '<a class="wslink" href="' + esc(rows[i].u) + '" target="_blank" rel="noopener">' + L[g] + ': ' + esc(rows[i].n || host(rows[i].u)) + '</a>';
    }
    return h ? '<div class="wslbl">Sources</div>' + h : '';
  }
  function bodyHTML(u) {
    return listBlock('Done since last', u.done) + listBlock('Next', u.next) + listBlock('Blockers', u.blockers) + listBlock('Risks', u.risks) +
      listBlock('Decisions needed', u.decisions) + asksBlock(u.asks) + srcBlock(u.sources) +
      (u.notes ? '<div class="wsnotes">' + esc(u.notes).replace(/\n/g, '<br>') + '</div>' : '');
  }
  function metaLine(u, withDate) {
    var p = [];
    if (withDate && u.at) p.push(ago(u.at));
    if (u.period) p.push(esc(u.period));
    if (u.origin === 'manual') p.push('typed by hand');
    else if (u.origin === 'claude') p.push('from Claude');
    if (u.rag) p.push('suggested ' + RAGN[u.rag] + (u.origin !== 'manual' ? (u.rag_accepted ? ', accepted' : ', not accepted') : ''));
    return p.length ? '<div class="wsum">' + p.join(' · ') + '</div>' : '';
  }

  /* ---------- review cards (bulk screen and project page) ---------- */
  function rvHTML(st, scope, pid) {
    var rv = st.rv, h = '', i, e, n = rv.entries.length, cur;
    for (i = 0; i < n; i++) {
      e = rv.entries[i]; cur = e.project.rag || '';
      h += '<div class="impcard work wsrv"><div class="wsuh"><b>' + esc(e.project.name) + '</b><small>matched by ' + (e.by === 'id' ? 'id' : 'name') + '</small></div>' +
        '<div class="wshead">' + esc(e.update.headline) + '</div>' + metaLine({ period: e.update.period }, false) + bodyHTML(e.update);
      if (e.update.rag) {
        if (e.update.rag === cur) h += '<div class="wssug">Suggested: ' + dot(e.update.rag) + RAGN[e.update.rag] + ' (same as now)</div>';
        else h += '<div class="wssug">Suggested: ' + dot(e.update.rag) + RAGN[e.update.rag] + ' (now ' + (cur ? RAGN[cur] : 'not set') + ')' +
          '<button type="button" class="chip wsacc' + (rv.acc[e.ref] ? ' on' : '') + '" data-ws="acc" data-scope="' + scope + '" data-ref="' + e.ref + '" aria-pressed="' + (rv.acc[e.ref] ? 'true' : 'false') + '">' + (rv.acc[e.ref] ? '✓ ' : '') + 'Accept</button></div>';
      }
      h += '</div>';
    }
    if (rv.skipped.length) {
      h += '<div class="wslbl wsskh">Skipped (' + rv.skipped.length + ')</div>';
      for (i = 0; i < rv.skipped.length; i++) h += '<div class="impcard skipped">' + esc(rv.skipped[i].label) + ': ' + esc(rv.skipped[i].why) + '</div>';
    }
    for (i = 0; i < (rv.warnings || []).length; i++) h += '<div class="impinfo">' + esc(rv.warnings[i]) + '</div>';
    if (n) h += '<div class="row wsfoot"><span class="sp"></span><button type="button" class="btn" data-ws="discard" data-scope="' + scope + '">Discard</button>' +
      '<button type="button" class="btn primary" data-ws="save" data-scope="' + scope + '"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Saving…' : 'Save ' + n + (n === 1 ? ' update' : ' updates')) + '</button></div>';
    else h += '<div class="row wsfoot"><span class="sp"></span><button type="button" class="btn" data-ws="discard" data-scope="' + scope + '">Close</button></div>';
    return h;
  }
  function pasteHTML(st, scope, field) {
    var h = '<div class="row wsbtns"><button type="button" class="btn primary" data-ws="clip" data-scope="' + scope + '">Paste from clipboard</button>' +
      '<button type="button" class="btn" data-ws="box" data-scope="' + scope + '">' + (st.box ? 'Hide box' : 'Use a box') + '</button></div>';
    if (st.box) h += (st.hint ? '<div class="impinfo">' + esc(st.hint) + '</div>' : '') +
      '<textarea class="setinput wsta" data-f="' + field + '" rows="7" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Paste the whole reply from work Claude here"></textarea>' +
      '<div class="row"><button type="button" class="btn primary" data-ws="read" data-scope="' + scope + '"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Reading…' : 'Read update') + '</button></div>';
    if (st.msg) h += '<div class="impinfo wsmsg" role="status">' + esc(st.msg) + '</div>';
    return h;
  }

  /* ---------- Status updates section on a project page ---------- */
  function cardHTML(u, id, isOpen, first) {
    return '<div class="wsu' + (isOpen ? ' open' : '') + '"><button type="button" class="wsuh wsuhb" data-ws="uo" data-id="' + id + '"' + (first ? ' data-first="1"' : '') + ' aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      dot(u.rag) + '<span class="wshead">' + esc(u.headline) + '</span><small>' + ago(u.at) + '</small></button>' +
      (isOpen ? metaLine(u, false) + bodyHTML(u) : '') + '</div>';
  }
  App.wsSection = function (pid) {
    if (!pp || pp.pid !== pid) pp = fresh(pid);
    var s = upd[pid] || {}, list = s.list, h = '<h2>Status updates' + (list ? '<span class="count">' + list.length + '</span>' : '') + '</h2>', i, mh = '', mn = '';
    h += '<div class="row wsbtns"><button type="button" class="btn' + (pp.open === 'paste' ? ' on' : '') + '" data-ws="ppaste" data-pid="' + pid + '">Paste update</button>' +
      '<button type="button" class="btn' + (pp.open === 'manual' ? ' on' : '') + '" data-ws="pman" data-pid="' + pid + '">Add manual update</button></div>';
    if (pp.open === 'paste') {
      h += '<div class="wspanel">' + (pp.rv ? rvHTML(pp, 'p', pid) + (pp.msg ? '<div class="impinfo wsmsg" role="status">' + esc(pp.msg) + '</div>' : '') : pasteHTML(pp, 'p', 'wsPaste')) + '</div>';
    } else if (pp.open === 'manual') {
      h += '<div class="wspanel"><input class="setinput wsin" data-f="wsMHead" type="text" maxlength="200" placeholder="Headline: where it stands in one line" autocomplete="off" autocapitalize="sentences">' +
        '<textarea class="setinput wsta" data-f="wsMNotes" rows="4" maxlength="4000" placeholder="Notes (optional)" autocapitalize="sentences"></textarea>' +
        (pp.msg ? '<div class="impinfo wsmsg" role="status">' + esc(pp.msg) + '</div>' : '') +
        '<div class="row wsfoot"><span class="sp"></span><button type="button" class="btn" data-ws="mcancel">Cancel</button><button type="button" class="btn primary" data-ws="msave" data-pid="' + pid + '"' + (pp.busy ? ' disabled' : '') + '>' + (pp.busy ? 'Saving…' : 'Save update') + '</button></div></div>';
    }
    if (!list) { h += s.failed ? '<p class="empty">Could not load the updates.</p><div class="row"><button type="button" class="btn sm" data-ws="uretry" data-pid="' + pid + '">Try again</button></div>' : '<div class="pphint">Loading…</div>'; return h; }
    if (!list.length) return h + '<p class="empty">No status updates yet.</p>';
    h += cardHTML(list[0], list[0].id, openU[list[0].id] !== false, true);
    if (list.length > 1) {
      h += '<button type="button" class="donebtn" data-ws="older" data-pid="' + pid + '">' + (older[pid] ? '▾' : '▸') + ' Older updates (' + (list.length - 1) + ')</button>';
      if (older[pid]) for (i = 1; i < list.length; i++) h += cardHTML(list[i], list[i].id, openU[list[i].id] === true);
    }
    return h;
  };
  function loadUpd(pid, force) {
    var s = upd[pid] || (upd[pid] = {});
    if (s.loading || (s.list && !force)) return;
    if (!App.token()) { App.whenToken(function () { loadUpd(pid, force); }); return; }
    s.loading = true; s.failed = false;
    App.api('GET', '?updates=' + encodeURIComponent(pid), null, function (st, d) {
      s.loading = false;
      if (st === 200 && d && d.updates) s.list = d.updates; else if (!s.list) s.failed = true;
      App.render();
    }, API);
  }
  App.wsLoad = function (pid) { loadUpd(pid, true); }; // every time the page is fetched, so a save from another device shows up

  /* ---------- Copy for Claude ---------- */
  function checkExport(force) {
    if (exp.busy || !App.token()) return;
    if (!force && Date.now() - exp.at < 60000) return;
    exp.busy = true; exp.at = Date.now();
    App.api('GET', '?export=1', null, function (s, d) {
      exp.busy = false;
      if (s === 200 && d && (exp.changed !== !!d.changed || exp.ever !== !!d.ever)) { exp.changed = !!d.changed; exp.ever = !!d.ever; App.render(); }
    }, API);
  }
  App.wsCheck = function () { checkExport(false); };
  App.wsBar = function () {
    var pill = exp.changed ? '<span class="wschg" role="status">' + (exp.ever ? 'Changed since last copy' : 'Not copied yet') + '</span>' : '';
    return '<button class="chip" data-ws="copy">Copy for Claude</button>' + pill + '<button class="chip" data-ws="open">Paste updates</button>';
  };
  function copyText(t, ok, no) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) { navigator.clipboard.writeText(t).then(ok, no); return; }
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select(); try { ta.setSelectionRange(0, t.length); } catch (e1) {}
      var done = document.execCommand && document.execCommand('copy'); document.body.removeChild(ta);
      if (done) ok(); else no();
    } catch (e) { no(); }
  }
  function recordCopy(hash) {
    App.api('POST', '?export=1', { hash: hash }, function (s) { if (s === 200) { exp.changed = false; exp.ever = true; exp.at = Date.now(); App.render(); } }, API);
  }
  function closeModal() { var m = $('wsModal'); if (m && m.parentNode) m.parentNode.removeChild(m); }
  function openModal(d) { // the select-all box for browsers that cannot copy by script (iPad 2): tap in it, Select All, Copy
    closeModal();
    var m = document.createElement('div'); m.id = 'wsModal'; m.className = 'wsmodal'; m.setAttribute('role', 'dialog');
    m.innerHTML = '<div class="wsmbox"><b>Copy for Claude</b><div class="impinfo">This browser cannot copy by itself. Tap inside the box, tap Select All, then Copy. Then tap “I have copied it”.</div>' +
      '<textarea id="wsExpBox" class="setinput wsta" readonly rows="9">' + esc(d.text) + '</textarea>' +
      '<div class="row"><span class="sp"></span><button type="button" class="btn" data-ws="mclose">Close</button><button type="button" class="btn primary" data-ws="mdone" data-hash="' + esc(d.hash) + '">I have copied it</button></div></div>';
    document.body.appendChild(m);
    setTimeout(function () { var ta = $('wsExpBox'); if (ta) try { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); } catch (e) {} }, 60);
  }
  function doCopy() {
    App.api('GET', '?export=1', null, function (s, d) {
      if (s !== 200 || !d || !d.text) { App.toast('Could not build the list, check your connection'); return; }
      copyText(d.text, function () { App.toast('Copied ' + d.count + ' projects. Paste them into work Claude.'); recordCopy(d.hash); }, function () { openModal(d); });
    }, API);
  }

  /* ---------- reading, saving ---------- */
  function readText(st, scope, txt) {
    if (!txt || !/\S/.test(txt)) { st.msg = 'Nothing to read yet: copy the reply from work Claude first.'; App.render(); return; }
    st.busy = true; st.msg = ''; App.render();
    App.api('POST', '?statusparse=1', { text: txt, only: scope === 'p' ? st.pid : undefined }, function (s, d) {
      st.busy = false;
      if (s !== 200 || !d) st.msg = s === 401 ? 'Not signed in.' : 'Could not read that, check your connection and try again.';
      else if (!d.ok) st.msg = d.error;
      else { st.rv = { entries: d.entries, skipped: d.skipped, warnings: d.warnings, acc: {} }; st.msg = d.entries.length ? '' : 'Nothing in that paste matches one of your projects.'; st.box = false; }
      App.render();
    }, API);
  }
  function clip(st, scope) {
    st.hint = 'This browser would not let the page read the clipboard. Paste the update here instead:';
    App.pasteClip(function (txt) { readText(st, scope, txt); },
      function () { st.box = true; st.msg = ''; App.render(); },
      function () { st.msg = 'The clipboard is empty. Copy the reply from work Claude first, then tap Paste.'; App.render(); });
  }
  function afterSave(pids) {
    var i;
    for (i = 0; i < pids.length; i++) { if (upd[pids[i]]) loadUpd(pids[i], true); if (App.wpReload) App.wpReload(pids[i]); }
    if (App.boardReload) App.boardReload();
    exp.at = 0;
  }
  function save(st, scope) {
    if (st.busy || !st.rv || !st.rv.entries.length) return;
    var items = [], i, e;
    for (i = 0; i < st.rv.entries.length; i++) { e = st.rv.entries[i]; items.push({ id: e.project.id, update: e.update, accept_rag: !!st.rv.acc[e.ref] }); }
    st.busy = true; st.msg = ''; App.render();
    App.api('POST', '?updates=1', { items: items }, function (s, d) {
      st.busy = false;
      if (s === 201 && d) {
        st.rv = null; st.box = false;
        st.msg = 'Saved ' + d.saved + (d.saved === 1 ? ' update.' : ' updates.');
        App.toast(st.msg); afterSave(d.projects || []);
        if (scope === 'p') { st.open = ''; st.msg = ''; }
      } else st.msg = s === 400 && d && d.error ? d.error : 'Could not save, check your connection and try again. Nothing was saved.';
      App.render();
    }, API);
  }
  function saveManual(pid) {
    var hd = document.querySelector('[data-f="wsMHead"]'), nt = document.querySelector('[data-f="wsMNotes"]');
    if (!pp || pp.busy) return;
    var head = hd ? hd.value : '', notes = nt ? nt.value : '';
    if (!/\S/.test(head)) { pp.msg = 'Give the update a headline.'; App.render(); return; }
    pp.busy = true; pp.msg = ''; App.render();
    App.api('POST', '?updates=1', { id: pid, manual: { headline: head, notes: notes } }, function (s, d) {
      pp.busy = false;
      if (s === 201) { pp.open = ''; pp.msg = ''; App.toast('Update added'); afterSave([pid]); }
      else pp.msg = s === 400 && d && d.error ? d.error : 'Could not save, check your connection and try again.';
      App.render();
    }, API);
  }

  /* ---------- Paste updates screen ---------- */
  function bulkHTML() {
    var h = '<div class="wptop"><button type="button" class="btn wpback" data-ws="back">‹ Board</button><span class="sp"></span></div><h2 class="wsh2">Paste updates</h2>';
    if (bulk.rv) return h + '<p class="impinfo">Check each project, then Save. Nothing is saved until you tap Save. Turn on Accept to also change that project’s RAG.</p>' + rvHTML(bulk, 'b', '') +
      (bulk.msg ? '<div class="impinfo wsmsg" role="status">' + esc(bulk.msg) + '</div>' : '');
    return h + '<p class="impinfo">Copy the whole reply from work Claude (the todo-status block is what the app reads), then tap Paste.</p>' + pasteHTML(bulk, 'b', 'wsBulk') +
      (bulk.done ? '<div class="impinfo wsmsg">' + esc(bulk.done) + '</div>' : '');
  }
  function paintBulk() {
    if (!App.view || App.view() !== 'wstatus') return;
    var pane = $('wsPane'); if (!pane) return;
    var f = pane.querySelectorAll('[data-f]'), keep = {}, i, k, ae = document.activeElement, fk = null, s0 = null, s1 = null;
    for (i = 0; i < f.length; i++) keep[f[i].getAttribute('data-f')] = f[i].value;
    if (ae && pane.contains(ae) && ae.getAttribute('data-f')) { fk = ae.getAttribute('data-f'); try { s0 = ae.selectionStart; s1 = ae.selectionEnd; } catch (e) {} }
    if (!App.setHTML(pane, bulkHTML())) return;
    f = pane.querySelectorAll('[data-f]');
    for (i = 0; i < f.length; i++) {
      k = f[i].getAttribute('data-f');
      if (keep.hasOwnProperty(k) && f[i].value !== keep[k]) f[i].value = keep[k];
      if (k === fk && f[i] !== ae) { f[i].focus(); if (s0 !== null) try { f[i].setSelectionRange(s0, s1); } catch (e2) {} }
    }
  }
  App.register('wstatus', { title: 'Paste updates', render: paintBulk, show: function () { window.scrollTo(0, 0); bulk.done = ''; paintBulk(); } });

  /* ---------- events ---------- */
  function stOf(scope) { return scope === 'p' ? pp : bulk; }
  function boxText(field) { var t = document.querySelector('[data-f="' + field + '"]'); return t ? t.value : ''; }
  document.addEventListener('click', function (e) {
    var el = e.target, a, st, sc, pid, id;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-ws'))) {
      if (el.getAttribute && (el.getAttribute('data-act') || el.tagName === 'A')) return;
      el = el.parentNode;
    }
    if (!el || el === document || el.disabled) return;
    a = el.getAttribute('data-ws'); sc = el.getAttribute('data-scope'); pid = el.getAttribute('data-pid'); st = stOf(sc);
    if (a === 'copy') doCopy();
    else if (a === 'open') { bulk = { box: false, msg: '', rv: null, busy: false, hint: '', done: bulk.done }; App.navTo('wstatus'); }
    else if (a === 'back') App.navTo('board');
    else if (a === 'clip') { if (st) clip(st, sc); }
    else if (a === 'box') { if (st) { st.box = !st.box; st.hint = st.hint || 'Paste the update here:'; App.render(); } }
    else if (a === 'read') { if (st) readText(st, sc, boxText(sc === 'p' ? 'wsPaste' : 'wsBulk')); }
    else if (a === 'acc') { if (st && st.rv) { id = +el.getAttribute('data-ref'); st.rv.acc[id] = !st.rv.acc[id]; App.render(); } }
    else if (a === 'save') save(st, sc);
    else if (a === 'discard') { if (st) { st.rv = null; st.msg = ''; st.box = false; if (sc === 'p') st.open = ''; App.render(); } }
    else if (a === 'ppaste' || a === 'pman') { if (!pp || pp.pid !== pid) pp = fresh(pid); var w = a === 'ppaste' ? 'paste' : 'manual'; pp.open = pp.open === w ? '' : w; pp.msg = ''; pp.rv = null; pp.box = false; App.render(); }
    else if (a === 'mcancel') { if (pp) { pp.open = ''; pp.msg = ''; App.render(); } }
    else if (a === 'msave') saveManual(pid);
    else if (a === 'older') { older[pid] = !older[pid]; App.render(); }
    else if (a === 'uo') { id = +el.getAttribute('data-id'); openU[id] = el.getAttribute('data-first') ? openU[id] === false : !openU[id]; App.render(); }
    else if (a === 'uretry') { if (upd[pid]) upd[pid].failed = false; loadUpd(pid, true); App.render(); }
    else if (a === 'mclose') closeModal();
    else if (a === 'mdone') { recordCopy(el.getAttribute('data-hash')); closeModal(); App.toast('Marked as copied'); }
  }, false);
})();
