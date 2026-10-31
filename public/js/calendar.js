(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc;
  var st = { known: false, connected: false, apple_id: '', calendar: '' }, busy = '', msg = '', tries = 0;

  function apply(d) {
    st.known = true; st.connected = !!(d && d.connected); st.apple_id = (d && d.apple_id) || ''; st.calendar = (d && d.calendar) || '';
    if (App.settings.caldav !== st.connected) App.applySettings({ caldav: st.connected });
  }
  function check() {
    if (!App.token()) { if (tries++ < 8) setTimeout(check, 1500); return; }
    App.api('GET', '', null, function (s, d) { if (s === 200 && d) { apply(d); App.refreshTab(); } }, '/api/cal');
  }
  setTimeout(check, 800);

  function tabHTML() {
    var h = '';
    if (!st.known) return '<p class="empty">Checking…</p>';
    if (st.connected) {
      h += '<div class="lbl" style="margin-top:6px">Apple Calendar</div>';
      h += '<div class="rvsub">Connected ✓ as ' + esc(st.apple_id) + '<br>Tasks with a time appear in your “' + esc(st.calendar) + '” calendar with an alert. Today’s events from your other calendars show on the main screen.</div>';
      h += '<div class="sethint">Move or delete an event in Calendar and the task follows. Completing a task removes its event. Only events made by this app are ever changed.</div>';
      h += '<div class="row"><button class="btn danger" data-cl="disc">Disconnect</button><span class="sp"></span><button class="btn primary" data-cl="sync"' + (busy ? ' disabled' : '') + '>' + (busy === 'sync' ? 'Syncing…' : 'Sync now') + '</button></div>';
      if (msg) h += '<div class="sethint" style="margin-top:8px">' + esc(msg) + '</div>';
      return h;
    }
    h += '<div class="lbl" style="margin-top:6px">Connect Apple Calendar</div>';
    h += '<div class="rvsub">1. In the Calendar app, make a new calendar (for example “To-Do”).<br>2. On a computer or phone, go to appleid.apple.com → Sign-In and Security → App-Specific Passwords, and create one called “To-Do”.<br>3. Enter your details below.</div>';
    h += '<div class="sethint">Apple ID (your iCloud email)</div><input class="setinput" id="clId" type="email" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="you@icloud.com">';
    h += '<div class="sethint" style="margin-top:10px">App-specific password</div><input class="setinput" id="clPw" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="abcd-efgh-ijkl-mnop">';
    h += '<div class="sethint" style="margin-top:10px">Calendar name</div><input class="setinput" id="clName" type="text" autocomplete="off" autocorrect="off" value="To-Do">';
    h += '<div class="row"><span class="sp"></span><button class="btn primary" data-cl="connect"' + (busy ? ' disabled' : '') + '>' + (busy === 'connect' ? 'Connecting…' : 'Connect') + '</button></div>';
    h += '<div class="sethint">This is not your normal Apple password. It is stored encrypted and only used to talk to iCloud Calendar.</div>';
    if (msg) h += '<div class="sethint" style="margin-top:8px;color:var(--alert)">' + esc(msg) + '</div>';
    return h;
  }
  App.addTab('cal', 'Calendar', function (el) {
    var keep = { id: $('clId') && $('clId').value, pw: $('clPw') && $('clPw').value, nm: $('clName') && $('clName').value };
    el.innerHTML = tabHTML();
    if ($('clId') && keep.id !== null && keep.id !== undefined && keep.id !== false) { $('clId').value = keep.id || ''; $('clPw').value = keep.pw || ''; if (keep.nm) $('clName').value = keep.nm; }
    if (!st.known) check();
  });

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-cl'))) el = el.parentNode;
    if (!el || el === document) return;
    var a = el.getAttribute('data-cl');
    if (busy) return;
    if (a === 'connect') {
      var id = $('clId').value, pw = $('clPw').value, nm = $('clName').value;
      if (!id || !pw) { msg = 'Enter your Apple ID and the app-specific password.'; App.refreshTab(); return; }
      busy = 'connect'; msg = ''; App.refreshTab();
      App.api('POST', '', { apple_id: id, password: pw, calendar: nm }, function (s, d) {
        busy = '';
        if (s === 200 && d && d.connected) {
          apply(d); msg = d.synced === false ? 'Connected, but the first sync did not finish: ' + (d.syncError || 'try Sync now') : 'Connected and synced.';
          App.reload();
        } else msg = (d && d.error) || 'Could not connect, try again.';
        App.refreshTab();
      }, '/api/cal');
    } else if (a === 'sync') {
      busy = 'sync'; msg = ''; App.refreshTab();
      App.api('POST', '?sync=1', {}, function (s, d) {
        busy = '';
        msg = (s === 200 && d) ? (d.failed ? d.failed + ' updates did not go through, try again.' : (d.changed ? 'Brought in changes from Calendar.' : 'Everything is up to date.')) : ((d && d.error) || 'Could not sync, try again.');
        if (s === 200 && d && d.diag && d.diag.length) { var ln = []; for (var q = 0; q < d.diag.length; q++) ln.push(d.diag[q].task + ' · app ' + d.diag[q].app + ' · calendar ' + (d.diag[q].cal || '?') + ' · ' + d.diag[q].act + (d.diag[q].n > 1 ? ' · ' + d.diag[q].n + ' copies' : '')); msg += ' (' + (d.events || 0) + ' events in calendar) ' + ln.join(' | '); }
        if (s === 200 && d && d.changed) App.reload();
        App.refreshTab();
      }, '/api/cal');
    } else if (a === 'disc') {
      App.ask({ title: 'Disconnect Apple Calendar?', text: 'Your tasks stay. Events already in the calendar are left as they are.', buttons: [{ label: 'Disconnect', alert: true }, { label: 'Cancel', primary: true }] }, function (i) {
        if (i !== 0) return;
        App.api('DELETE', '', null, function (s) {
          if (s === 200) { st.connected = false; st.apple_id = ''; msg = ''; App.applySettings({ caldav: false }); App.toast('Disconnected'); }
          else App.toast('Could not disconnect, try again');
          App.refreshTab();
        }, '/api/cal');
      });
    }
  }, false);
})();
