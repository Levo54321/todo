(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc;
  var map = {}, canWrite = false, calName = '', needCal = false, loaded = false, tries = 0;
  var curId = '', stateFor = '', st = { choice: null, dur: 30, vis: 'private' };
  var DURS = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']];

  function load(cb) {
    if (!App.token()) { App.whenToken(function () { load(cb); }); return; }
    App.api('GET', '?sched=1', null, function (s, d) {
      if (s === 200 && d) { map = d.map || {}; canWrite = !!d.can_write; calName = d.cal || ''; needCal = !!d.write_error; loaded = true; if (cb) cb(); }
    }, '/api/gcal');
  }
  setTimeout(function () { load(); }, 1200);
  document.addEventListener('visibilitychange', function () { if (!App.hidden()) load(); }, false);

  function find(id) {
    var all = App.todos(), i;
    for (i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function isWork() {
    var on = $('eList') && $('eList').querySelector('.on');
    return !!on && on.getAttribute('data-val') === 'work';
  }
  function timeVal() { return $('eTimeIn') ? $('eTimeIn').value : ''; }
  function when() {
    var d = $('eDate') ? $('eDate').value : '', tm = timeVal();
    if (!tm) return '';
    var dt = d ? new Date(d.slice(0, 4), +d.slice(5, 7) - 1, d.slice(8, 10)) : new Date(), s;
    s = (d ? App.DOWS[dt.getDay()] + ' ' + dt.getDate() + ' ' + App.MONS[dt.getMonth()] : 'Today') + ', ';
    var m = (+tm.slice(0, 2)) * 60 + (+tm.slice(3, 5)), e = m + st.dur;
    function f(x) { x = x % 1440; return App.pad(Math.floor(x / 60)) + ':' + App.pad(x % 60); }
    return s + f(m) + ' to ' + f(e);
  }

  function ensureBox() {
    if ($('eWcal')) return $('eWcal');
    var anchor = $('eIcs'); if (!anchor) return null;
    var box = document.createElement('div'); box.id = 'eWcal';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    return box;
  }
  function initState() {
    if (stateFor === curId) return;
    stateFor = curId;
    var m = map[curId];
    st = m ? { choice: m.on ? 'yes' : 'no', dur: m.dur || 30, vis: m.vis === 'public' ? 'public' : 'private' } : { choice: null, dur: 30, vis: 'private' };
  }
  function render() {
    var box = ensureBox(); if (!box) return;
    if ($('eIcs')) $('eIcs').style.display = isWork() ? 'none' : ''; // Work tasks never go to the Apple calendar, so hide its hint
    if (!curId || !loaded || !isWork() || !timeVal() || !$('sheet') || $('sheet').style.display !== 'flex') { box.innerHTML = ''; return; }
    initState();
    var h = '<div class="lbl">Work calendar</div>', i;
    if (!canWrite) {
      box.innerHTML = needCal ? h + '<div class="sethint">Choose a calendar to add tasks to in Settings, Screensaver.</div>' : '';
      return;
    }
    if (st.choice === null) {
      h += '<div class="nudge">Add this to your work calendar?<br><button class="chip" data-wc="yes">Yes, add it</button><button class="chip" data-wc="no">Not now</button></div>';
    } else {
      h += '<button class="chip' + (st.choice === 'yes' ? ' on' : '') + '" data-wc="yes">Add to calendar</button>' +
        '<button class="chip' + (st.choice === 'no' ? ' on' : '') + '" data-wc="no">Not on calendar</button>';
      if (st.choice === 'yes') {
        h += '<div class="qlabel" style="margin-top:6px">Length</div><div>';
        for (i = 0; i < DURS.length; i++) h += '<button class="chip' + (st.dur === DURS[i][0] ? ' on' : '') + '" data-wc="dur" data-val="' + DURS[i][0] + '">' + DURS[i][1] + '</button>';
        h += '</div><div class="qlabel">Others see</div><div>' +
          '<button class="chip' + (st.vis === 'private' ? ' on' : '') + '" data-wc="vis" data-val="private">Busy (private)</button>' +
          '<button class="chip' + (st.vis === 'public' ? ' on' : '') + '" data-wc="vis" data-val="public">Task name (public)</button></div>';
        h += '<div class="sethint">' + esc(when()) + (calName ? ' on ' + esc(calName) : '') + '. Updates if you change or finish the task.</div>';
      }
    }
    box.innerHTML = h;
  }

  function post(id, onFlag, dur, vis) {
    App.api('POST', '', { sched: { id: id, on: onFlag, dur: dur, vis: vis }, sync: true }, function (s, d) {
      if (s === 200 && d && d.ok) { map[id] = { on: onFlag, dur: dur, vis: vis }; App.toast(onFlag ? 'Added to work calendar' : 'Removed from work calendar'); }
      else App.toast((d && d.error) || 'Could not update the work calendar');
    }, '/api/gcal');
  }

  if (window.MutationObserver && $('eCats')) new MutationObserver(function () { render(); }).observe($('eCats'), { childList: true });

  // Which task is the editor showing? Capture it as the editor opens.
  document.addEventListener('click', function (e) {
    var el = e.target, a, id;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
    if (!el || el === document) return;
    a = el.getAttribute('data-act');
    if (a === 'edit') { curId = el.getAttribute('data-id') || ''; }
    else if (a === 'sdetails') {
      var title = $('sTitle') ? $('sTitle').textContent : '', all = App.todos(), i; curId = '';
      for (i = 0; i < all.length; i++) if (all[i].title === title && all[i].is_session && !all[i].done) curId = all[i].id;
    } else if (a === 'save' && curId && $('sheet') && $('sheet').style.display === 'flex') {
      id = curId;
      if (loaded && canWrite && stateFor === id && st.choice !== null) {
        if (st.choice === 'yes' && isWork() && timeVal()) post(id, true, st.dur, st.vis);
        else if (st.choice === 'no' && map[id] && map[id].on) post(id, false, st.dur, st.vis);
        else if (st.choice === 'yes') { /* time or list changed away: the server drops the event itself */ }
      }
      stateFor = '';
    } else if (a === 'cancel' || a === 'delete') { stateFor = ''; }
    if (a === 'edit' || a === 'sdetails') stateFor = '';
  }, true);

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-wc'))) el = el.parentNode;
    if (!el || el === document) return;
    var a = el.getAttribute('data-wc'), v = el.getAttribute('data-val');
    if (a === 'yes') st.choice = 'yes';
    else if (a === 'no') st.choice = 'no';
    else if (a === 'dur') st.dur = parseInt(v, 10) || 30;
    else if (a === 'vis') st.vis = v === 'public' ? 'public' : 'private';
    render();
  }, false);
  App.workcal = { reload: load };
})();
