(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, store = App.store, esc = App.esc;
  var images = [], listAt = 0, listing = false, uploading = '', err = '';
  var lastAct = Date.now(), running = false, startedAt = 0, idx = -1, front = 'slideA', slideTimer = null, restTimer = null, clockTimer = null;
  var gc = { known: false, configured: false, connected: false, email: '', calendars: [], selected: [], expired: false, redirect: '' }, evs = [], evTimer = null, gBusy = '', gMsg = '';
  var TIMEOUTS = [[2, '2 min'], [5, '5 min'], [10, '10 min'], [0, 'Never']];

  function timeoutMin() {
    var v = store.get('saverTimeout');
    if (v === null || v === undefined) return window.innerWidth >= 700 ? 5 : 0;
    return parseInt(v, 10) || 0;
  }
  function mode() { return store.get('saverMode') === 'plugged' ? 'plugged' : 'battery'; }
  function imgUrl(id) { return '/api/saver?id=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(App.token()); }

  function loadList(cb) {
    if (listing) return; listing = true;
    App.api('GET', '', null, function (s, d) {
      listing = false;
      if (s === 200 && d) { images = d.images || []; listAt = Date.now(); err = ''; }
      else if (s === 409) err = 'Run setup6.sql in Supabase first.';
      if (cb) cb();
    }, '/api/saver');
  }

  /* ---------- Google calendar tiles ---------- */
  function applyG(d) {
    if (!d) return;
    gc.known = true; gc.configured = !!d.configured; gc.connected = !!d.connected; gc.email = d.email || ''; gc.expired = !!d.expired;
    gc.calendars = d.calendars || []; gc.selected = d.selected || []; gc.redirect = d.redirect_uri || '';
    gc.canWrite = !!d.can_write; gc.writeCal = d.write_cal || '';
  }
  function loadGcal(cb) {
    App.api('GET', '', null, function (s, d) { if (s === 200) applyG(d); if (cb) cb(); }, '/api/gcal');
  }
  function loadEvents() {
    App.api('GET', '?events=1', null, function (s, d) {
      if (s === 200 && d && d.events) { evs = d.events; if (running) paintEvents(); }
    }, '/api/gcal');
  }
  function evTime(e, now) {
    if (e.allDay) return e.day === 'tomorrow' ? 'Tomorrow · all day' : 'All day';
    var span = e.s + (e.e && e.e !== e.s ? ' – ' + e.e : '');
    return e.day === 'tomorrow' ? 'Tomorrow · ' + span : span;
  }
  function paintEvents() {
    var el = $('saverEvents'); if (!el) return;
    var now = Date.now(), list = [], i, e, h = '';
    for (i = 0; i < evs.length; i++) {
      e = evs[i];
      if (!e.allDay && Math.max(e.em, e.sm + 30 * 60000) < now) continue; // already over
      list.push(e);
    }
    if (!list.length) { el.innerHTML = ''; return; }
    var shown = list.slice(0, 5);
    for (i = 0; i < shown.length; i++) {
      e = shown[i];
      var on = !e.allDay && e.sm <= now && now < Math.max(e.em, e.sm + 30 * 60000), pill = '';
      if (on) pill = 'Now';
      else if (!e.allDay && e.day === 'today' && e.sm - now < 60 * 60000) pill = 'in ' + Math.max(1, Math.round((e.sm - now) / 60000)) + ' min';
      h += '<div class="evt' + (on ? ' now' : '') + (e.allDay ? ' allday' : '') + '"><div class="et">' + esc(evTime(e, now)) + (pill ? '<span class="et-p">' + pill + '</span>' : '') + '</div>' +
        '<div class="en">' + esc(e.title) + '</div>' + (e.loc ? '<div class="el">' + esc(e.loc) + '</div>' : '') + '</div>';
    }
    if (list.length > shown.length) h += '<div class="evmore">+' + (list.length - shown.length) + ' more</div>';
    el.innerHTML = h;
  }

  /* ---------- slideshow ---------- */
  function paintClock() {
    var d = new Date(), el = $('saverClock');
    if (!el) return;
    el.innerHTML = App.pad(d.getHours()) + ':' + App.pad(d.getMinutes()) + '<small>' + App.DOWL[d.getDay()] + ' ' + d.getDate() + ' ' + App.MONL[d.getMonth()] + '</small>';
  }
  function showSlide(i) {
    if (!images.length) return;
    idx = i % images.length;
    var back = front === 'slideA' ? 'slideB' : 'slideA', el = $(back), pre = new Image();
    pre.onload = function () {
      if (!running) return;
      el.style.backgroundImage = 'url(' + imgUrl(images[idx].id) + ')';
      el.className = 'slide on';
      $(front).className = 'slide';
      front = back;
    };
    pre.src = imgUrl(images[idx].id);
  }
  function nextSlide() { if (running) showSlide((idx + 1) % images.length); }
  function startSaver() {
    if (running || App.hidden() || !images.length) return;
    running = true; startedAt = Date.now();
    var sv = $('saver'); sv.className = ''; sv.style.display = 'block';
    $('slideA').className = 'slide'; $('slideB').className = 'slide'; front = 'slideA';
    App.setIdle(true);
    paintClock(); clockTimer = setInterval(function () { paintClock(); paintEvents(); }, 60000);
    paintEvents(); loadEvents(); evTimer = setInterval(loadEvents, 5 * 60000);
    showSlide(Math.floor(Math.random() * images.length));
    slideTimer = setInterval(nextSlide, mode() === 'plugged' ? 30000 : 20000);
    if (mode() === 'battery') restTimer = setTimeout(rest, 10 * 60000); // then a black rest screen
  }
  function rest() {
    if (!running) return;
    clearInterval(slideTimer); clearInterval(clockTimer); clearInterval(evTimer);
    $('saver').className = 'rest';
  }
  function stopSaver() {
    if (!running) return;
    running = false;
    clearInterval(slideTimer); clearInterval(clockTimer); clearInterval(evTimer); clearTimeout(restTimer);
    $('saver').style.display = 'none'; $('saver').className = '';
    lastAct = Date.now();
    App.setIdle(false);
  }

  function activity() { lastAct = Date.now(); }
  ['touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (!running) activity(); }, true);
  });
  $('saver').addEventListener('click', function (e) { e.preventDefault(); stopSaver(); }, false);
  setInterval(function () {
    var t = timeoutMin();
    if (running || !t || App.hidden() || !App.token()) return;
    if (Date.now() - lastAct < t * 60000) return;
    if (!images.length || Date.now() - listAt > 10 * 60000) { loadList(function () { if (Date.now() - lastAct >= t * 60000) startSaver(); }); return; }
    startSaver();
  }, 10000);
  if (/#gcal/.test(window.location.hash || '')) {
    try { if (window.history && history.replaceState) history.replaceState(null, '', window.location.pathname); } catch (e) {}
    setTimeout(function () { App.toast('Google connected. Pick calendars in Settings, Screensaver.'); }, 1500);
  }
  document.addEventListener('visibilitychange', function () { if (!App.hidden() && running && mode() === 'battery' && Date.now() - startedAt > 10 * 60000) rest(); }, false);

  /* ---------- upload (resize in the browser) ---------- */
  function resizeFile(file, cb) {
    var fr = new FileReader();
    fr.onerror = function () { cb(null); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null); };
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, max = 1280, sc = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc)), c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          c.getContext('2d').drawImage(img, 0, 0, cw, ch);
          var url = c.toDataURL('image/jpeg', 0.8);
          cb({ data: url.split(',')[1], w: cw, h: ch });
        } catch (e) { cb(null); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function uploadFiles(files) {
    var list = [], i;
    for (i = 0; i < files.length; i++) list.push(files[i]);
    var done = 0, fail = 0;
    (function next() {
      if (!list.length) {
        uploading = ''; loadList(function () { App.refreshTab(); });
        App.toast(fail ? (done + ' added, ' + fail + ' failed') : (done + (done === 1 ? ' photo added' : ' photos added')));
        return;
      }
      var f = list.shift();
      uploading = 'Adding photo ' + (done + fail + 1) + ' of ' + (done + fail + 1 + list.length) + '…';
      App.refreshTab();
      resizeFile(f, function (r) {
        if (!r) { fail++; next(); return; }
        App.api('POST', '', { data: r.data, mime: 'image/jpeg', w: r.w, h: r.h }, function (s, d) {
          if (s === 201) done++; else { fail++; if (d && d.error) err = d.error; }
          next();
        }, '/api/saver');
      });
    })();
  }

  /* ---------- settings tab ---------- */
  function gcalHTML() {
    var h = '<div class="lbl">Screensaver calendar (all devices)</div>', i, c, on, sel;
    if (!gc.known) return h + '<div class="sethint">Checking…</div>';
    if (!gc.configured) {
      return h + '<div class="sethint">Google is not set up on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, with this redirect address in the Google Cloud client: <b>' + esc(gc.redirect) + '</b></div>';
    }
    if (!gc.connected) {
      h += '<div class="sethint">Sign in with the Google account that can see your work calendar, then tick the calendars to show. Events appear as glass tiles on the screensaver of every device. Read-only.</div>';
      h += '<div class="row"><span class="sp"></span><button class="btn primary" data-sv="gsign">Sign in with Google</button></div>';
      return h;
    }
    h += '<div class="rvsub">Signed in as ' + esc(gc.email) + '</div>';
    if (gc.expired) h += '<div class="sethint" style="color:var(--alert)">Google needs you to sign in again.</div>';
    h += '<div class="sethint">Tick the calendars to show on the screensaver:</div>';
    for (i = 0; i < gc.calendars.length; i++) {
      c = gc.calendars[i]; on = gc.selected.indexOf(c.id) >= 0;
      h += '<button class="chip' + (on ? ' on' : '') + '" data-sv="gtick" data-id="' + esc(c.id) + '">' + (on ? '✓ ' : '') + esc(c.name) + '</button>';
    }
    h += '<div class="row" style="margin-top:10px"><button class="btn danger" data-sv="gdisc">Disconnect</button><span class="sp"></span>' +
      '<button class="btn" data-sv="grefresh"' + (gBusy ? ' disabled' : '') + '>Refresh list</button>' + (gc.expired ? '<button class="btn primary" data-sv="gsign">Sign in again</button>' : '') + '</div>';
    if (gMsg) h += '<div class="sethint">' + esc(gMsg) + '</div>';
    h += '<div class="lbl">Add timed Work tasks to a calendar</div>';
    if (!gc.canWrite) {
      h += '<div class="sethint">Optional. Lets you put a Work task’s time into a Google calendar from the task editor. This needs one more permission from Google (to add and change events).</div>' +
        '<div class="row"><span class="sp"></span><button class="btn" data-sv="gsign">Allow adding events</button></div>';
    } else {
      var wn = 0;
      h += '<div class="sethint">Choose where they go. Events show as “Busy” and Private unless you set a task to Public.</div>';
      for (i = 0; i < gc.calendars.length; i++) {
        c = gc.calendars[i]; if (!c.w) continue; wn++;
        on = gc.writeCal === c.id;
        h += '<button class="chip' + (on ? ' on' : '') + '" data-sv="gwrite" data-id="' + esc(c.id) + '">' + (on ? '✓ ' : '') + esc(c.name) + '</button>';
      }
      h += '<button class="chip' + (!gc.writeCal ? ' on' : '') + '" data-sv="gwrite" data-id="">Off</button>';
      if (!wn) h += '<div class="sethint">No calendars you can edit were found. Tap Refresh list above.</div>';
    }
    return h;
  }
  function tabHTML() {
    var h = '', i, t = timeoutMin(), m = mode();
    h += '<div class="lbl" style="margin-top:6px">Start after (this device)</div>';
    for (i = 0; i < TIMEOUTS.length; i++) h += '<button class="chip' + (t === TIMEOUTS[i][0] ? ' on' : '') + '" data-sv="timeout" data-val="' + TIMEOUTS[i][0] + '">' + TIMEOUTS[i][1] + '</button>';
    h += '<div class="sethint">Start the photo slideshow when nothing has been touched for this long.</div>';
    h += '<div class="lbl">Power (this device)</div>' +
      '<button class="chip' + (m === 'battery' ? ' on' : '') + '" data-sv="mode" data-val="battery">Battery saver</button>' +
      '<button class="chip' + (m === 'plugged' ? ' on' : '') + '" data-sv="mode" data-val="plugged">Plugged in</button>';
    h += '<div class="sethint">' + (m === 'battery' ? 'Photos for 10 minutes, then a black rest screen. Tap to wake. Updates slow right down meanwhile.' : 'Photos keep going all day, like a digital photo frame. Best when the iPad is on its charger.') + '</div>';
    h += '<div class="sethint">To let the iPad switch itself off after a while instead: iPad Settings → Display &amp; Brightness → Auto-Lock.</div>';
    h += gcalHTML();
    h += '<div class="lbl">Photos (' + images.length + ' of 100)</div>';
    if (err) h += '<div class="sethint" style="color:var(--alert)">' + esc(err) + '</div>';
    if (images.length) {
      h += '<div class="thumbs">';
      for (i = 0; i < images.length; i++) h += '<div class="thumb" style="background-image:url(' + imgUrl(images[i].id) + ')"><button data-sv="del" data-id="' + esc(images[i].id) + '" aria-label="Remove photo">×</button></div>';
      h += '</div>';
    } else h += '<div class="sethint">No photos yet.</div>';
    h += '<div class="row" style="margin-top:12px">' + (uploading ? '<span class="sethint">' + uploading + '</span>' : '<label class="btn primary" style="margin-left:0">Add photos<input id="svFile" type="file" accept="image/*" multiple style="display:none"></label>') +
      '<span class="sp"></span><button class="btn" data-sv="try"' + (images.length ? '' : ' disabled') + '>Preview</button></div>';
    h += '<div class="sethint">Pick up to 15 or so at a time (100 photos in total) from your photo library. They are shrunk to screen size first, so it is quick.</div>';
    return h;
  }
  App.addTab('saver', 'Screensaver', function (el) {
    el.innerHTML = tabHTML();
    var f = $('svFile');
    if (f) f.onchange = function () { if (f.files && f.files.length) uploadFiles(f.files); };
    if (!listAt && !listing) loadList(function () { App.refreshTab(); });
    if (!gc.known) loadGcal(function () { App.refreshTab(); });
  });
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-sv'))) el = el.parentNode;
    if (!el || el === document) return;
    var a = el.getAttribute('data-sv'), v = el.getAttribute('data-val');
    if (a === 'timeout') { store.set('saverTimeout', v); lastAct = Date.now(); App.refreshTab(); }
    else if (a === 'mode') { store.set('saverMode', v); App.refreshTab(); }
    else if (a === 'del') {
      var id = el.getAttribute('data-id');
      for (var i = 0; i < images.length; i++) if (images[i].id === id) { images.splice(i, 1); break; }
      App.refreshTab();
      App.api('DELETE', '?id=' + encodeURIComponent(id), null, function (s) { if (s !== 200) { App.toast('Could not remove, try again'); loadList(function () { App.refreshTab(); }); } }, '/api/saver');
    } else if (a === 'try') {
      startSaver();
    } else if (a === 'gsign') {
      App.api('POST', '', { start: true }, function (s, d) {
        if (s === 200 && d && d.url) window.location.href = d.url; else App.toast((d && d.error) || 'Could not start Google sign-in, try again');
      }, '/api/gcal');
    } else if (a === 'gwrite') {
      gc.writeCal = el.getAttribute('data-id') || '';
      App.refreshTab();
      App.api('POST', '', { wcal: gc.writeCal }, function (s, d) {
        if (s === 200) applyG(d); else App.toast((d && d.error) || 'Could not save, try again');
        App.refreshTab();
      }, '/api/gcal');
    } else if (a === 'gtick') {
      var gid = el.getAttribute('data-id'), at = gc.selected.indexOf(gid);
      if (at >= 0) gc.selected.splice(at, 1); else gc.selected.push(gid);
      App.refreshTab();
      App.api('POST', '', { selected: gc.selected }, function (s, d) {
        if (s === 200) { applyG(d); evs = []; } else App.toast('Could not save, try again');
        App.refreshTab();
      }, '/api/gcal');
    } else if (a === 'grefresh') {
      gBusy = '1'; gMsg = ''; App.refreshTab();
      App.api('POST', '', { refresh: true }, function (s, d) { gBusy = ''; if (s === 200) applyG(d); else gMsg = (d && d.error) || 'Could not refresh'; App.refreshTab(); }, '/api/gcal');
    } else if (a === 'gdisc') {
      App.ask({ title: 'Disconnect Google?', text: 'The calendar tiles stop showing on every device. Nothing in Google is changed.', buttons: [{ label: 'Disconnect', alert: true }, { label: 'Cancel', primary: true }] }, function (i2) {
        if (i2 !== 0) return;
        App.api('DELETE', '', null, function (s, d) { if (s === 200) { applyG(d); evs = []; App.toast('Disconnected'); } else App.toast('Could not disconnect, try again'); App.refreshTab(); }, '/api/gcal');
      });
    }
  }, false);
})();
