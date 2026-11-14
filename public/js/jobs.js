/* Jobs tab: application tracker (pipeline board, job sheet, stage editor). ES5 only (iPad 2 / iOS 9). Server: api/_jobs.js. */
(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var API = '/api/pprojects';
  var stages = [], jobs = [], loaded = false, loading = false, err = '', fetchedAt = 0, pend = 0;
  var view = store.get('jobsView') === 'stats' ? 'stats' : store.get('jobsView') === 'discover' ? 'discover' : 'board';  // board | discover | stats (Analytics)
  var leads = [], leadsLoaded = false, leadsAt = 0, leadsLoading = false, newLeads = 0, leadsErr = '';
  var stats = null, statsAt = 0, statsLoading = false, statsErr = '';
  var cur = store.get('jobsCur') || '';       // phone: the stage whose cards are showing
  var sh = null;                              // open sheet: {kind:'job', id, stage, mode, events, delArm} or {kind:'stages', draft, pal}
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MODES = [['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site']];
  var COLORS = ['sand', 'clay', 'ochre', 'sage', 'moss', 'stone', 'rose', 'slate'];
  var KINDS = [['active', 'In progress'], ['won', 'Offer (counts as won)'], ['lost', 'Closed (counts as lost)']];
  var SRC = { linkedin: 'LinkedIn', reed: 'Reed', adzuna: 'Adzuna', share: 'Shared from phone', manual: 'Added by hand' };
  var ICAL = '<svg class="jbi" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

  /* ---------- helpers ---------- */
  function sd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? parseInt(p[2], 10) + ' ' + MON[parseInt(p[1], 10) - 1] : ''; }
  function stageOf(id) { for (var i = 0; i < stages.length; i++) if (stages[i].id === id) return stages[i]; return null; }
  function jobOf(id) { for (var i = 0; i < jobs.length; i++) if (jobs[i].id === id) return jobs[i]; return null; }
  function putJob(j) { for (var i = 0; i < jobs.length; i++) if (jobs[i].id === j.id) { jobs[i] = j; return; } jobs.unshift(j); }
  function colorOf(sid) { var s = stageOf(sid); return s ? s.color : 'sand'; }
  function write(method, qs, body, cb) { pend++; App.api(method, qs, body, function (s, d) { pend--; cb(s, d); }, API); }
  function failText(s) { return s === 409 ? 'Run setup26.sql in Supabase first.' : 'Could not reach the server, try again.'; }

  /* ---------- loading ---------- */
  function fetchJobs() {
    if (loading) return;
    loading = true;
    App.api('GET', '?jobs=1', null, function (s, d) {
      loading = false; fetchedAt = Date.now();
      if (s === 200 && d && d.stages) {
        if (!pend) { stages = d.stages; jobs = d.jobs || []; if (typeof d.new_leads === 'number') newLeads = d.new_leads; }
        loaded = true; err = '';
      } else if (!loaded) err = failText(s);
      paint();
    }, API);
  }

  function fetchStats(force) {
    if (statsLoading || (!force && stats && Date.now() - statsAt < 10000)) return;
    statsLoading = true;
    App.api('GET', '?jobs=stats', null, function (s, d) {
      statsLoading = false; statsAt = Date.now();
      if (s === 200 && d && d.stats) { stats = d.stats; statsErr = ''; } else if (!stats) statsErr = failText(s);
      paint();
    }, API);
  }
  function fetchLeads(force) {
    if (leadsLoading || (!force && leadsLoaded && Date.now() - leadsAt < 10000)) return;
    leadsLoading = true;
    App.api('GET', '?jobs=leads', null, function (s, d) {
      leadsLoading = false; leadsAt = Date.now();
      if (s === 200 && d && d.leads) { if (!pend) { leads = d.leads; newLeads = leads.length; } leadsLoaded = true; leadsErr = ''; } else if (!leadsLoaded) leadsErr = failText(s);
      paint();
    }, API);
  }
  /* ---------- Reed feed (v1077) ---------- */
  var feedCfg = null, feedOpen = false, feedBusy = false, feedMsg = '', feedTried = false;
  function fetchFeedCfg() {
    App.api('GET', '?jobs=feedcfg', null, function (s, d) { if (s === 200 && d && d.cfg) { feedCfg = d.cfg; paint(); } }, API);
  }
  function runFeed(force) {
    if (feedBusy || feedOpen) return;
    feedBusy = true; feedMsg = force ? 'Checking Reed…' : ''; paint();
    write('POST', '?jobs=feed', { force: !!force }, function (s, d) {
      feedBusy = false;
      if (s === 200 && d) {
        if (d.skipped) feedMsg = '';
        else feedMsg = d.added ? d.added + ' new from Reed' : 'Nothing new from Reed';
        if (!d.skipped) fetchLeads(true);
        fetchFeedCfg();
      } else feedMsg = s === 503 ? 'Reed key missing in Vercel' : 'Could not reach Reed, try again later';
      paint();
    });
  }
  function lastCheck() {
    if (!feedCfg || !feedCfg.last_run) return 'Not checked yet';
    var d = Math.floor((App.nowMs() - App.parseTS(feedCfg.last_run)) / 3600000);
    return 'Reed checked ' + (d < 1 ? 'within the last hour' : d < 24 ? d + ' hours ago' : Math.floor(d / 24) + ' days ago');
  }
  function feedBar() {
    var h = '<div class="jbfeed"><span class="jbfeedt">' + esc(feedMsg || lastCheck()) + '</span><span class="jbfeedb"><button class="btn" data-jb="fcheck"' + (feedBusy ? ' disabled' : '') + '>Check now</button><button class="btn" data-jb="fcfg">' + (feedOpen ? 'Close' : 'Settings') + '</button></span></div>';
    if (feedOpen && feedCfg) {
      h += '<div class="jbfeedcfg"><label class="jbf"><span>Job titles to search (one per line, up to 10)</span><textarea id="jbFKw" rows="6">' + esc((feedCfg.keywords || []).join('\n')) + '</textarea></label>' +
        '<label class="jbf"><span>Your skills, used for the fit score (one per line)</span><textarea id="jbFSk" rows="8">' + esc((feedCfg.skills || []).join('\n')) + '</textarea></label>' +
        '<div class="jbhint">Fit = how many of these skills a posting mentions (6 or more is 100). London (15 miles) and remote only.</div><div class="jbbtns"><button class="btn primary" data-jb="fsave">Save</button></div></div>';
    }
    return h;
  }
  function lines(id) { var v = ($(id) || {}).value || '', a = v.split(/[\n,]+/), o = [], i; for (i = 0; i < a.length; i++) if (a[i].replace(/\s+/g, '')) o.push(a[i].replace(/^\s+|\s+$/g, '')); return o; }
  function feedSave() {
    var kw = lines('jbFKw'), sk = lines('jbFSk');
    if (!kw.length) { App.toast('Add at least one job title'); return; }
    write('POST', '?jobs=feedcfg', { keywords: kw, skills: sk }, function (s, d) {
      if (s === 200 && d && d.cfg) { feedCfg = d.cfg; feedOpen = false; feedMsg = 'Saved. Check now to search again'; paint(); } else App.toast('Could not save, try again');
    });
  }
  function openDiscover() { if (!feedCfg) fetchFeedCfg(); if (!feedTried) { feedTried = true; App.whenToken(function () { runFeed(false); }); } }
  function dirty() { statsAt = 0; }   // a change was saved: the numbers are out of date

  /* ---------- analytics ---------- */
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function pct(n) { return n === null || n === undefined ? '–' : n + '%'; }
  function card(title, note, body) { return '<section class="jbcard2"><h3>' + title + '</h3>' + (note ? '<p>' + note + '</p>' : '') + body + '</section>'; }
  function statsHTML() {
    if (statsErr && !stats) return '<div class="jbmsg">' + esc(statsErr) + '<br><button class="btn primary" data-jb="sretry">Try again</button></div>';
    if (!stats) return '<div class="jbmsg">Crunching your numbers…</div>';
    var sm = stats.summary, h = '', i, f, max, w, wmax, t, tmax, so, prev, conv, nm;
    if (!sm.total) return '<div class="jbmsg">Add a few jobs and your numbers will appear here.</div>';
    h += '<div class="jbkpis jbkpis2"><div class="jbkpi"><b>' + sm.applied + '</b><span>Applied</span></div><div class="jbkpi"><b>' + sm.heard + '</b><span>Heard back</span></div>' +
      '<div class="jbkpi"><b>' + pct(sm.rate) + '</b><span>Response rate</span></div><div class="jbkpi"><b>' + sm.offers + '</b><span>Offers</span></div></div><div class="jbcards">';
    max = 1; for (i = 0; i < stats.funnel.length; i++) if (stats.funnel[i].count > max) max = stats.funnel[i].count;
    f = ''; prev = null;
    for (i = 0; i < stats.funnel.length; i++) {
      conv = prev && prev.count ? Math.round(stats.funnel[i].count / prev.count * 100) + '% of ' + prev.name : '';
      f += '<div class="jbfr"><div class="jbfl"><span>' + esc(stats.funnel[i].name) + '</span><b>' + stats.funnel[i].count + '</b></div><div class="jbtrack"><i class="jbc-' + esc(stats.funnel[i].color) + '" style="width:' + Math.max(2, Math.round(stats.funnel[i].count / max * 100)) + '%"></i></div>' + (conv ? '<small>' + esc(conv) + '</small>' : '') + '</div>';
      prev = stats.funnel[i];
    }
    h += card('Pipeline funnel', 'Jobs that got at least this far.' + (stats.lost ? ' ' + stats.lost + ' closed along the way.' : ''), f);
    wmax = 1; for (i = 0; i < stats.weeks.length; i++) if (stats.weeks[i].n > wmax) wmax = stats.weeks[i].n;
    w = '<div class="jbwk">';
    for (i = 0; i < stats.weeks.length; i++) w += '<div class="jbwc"><b>' + (stats.weeks[i].n || '') + '</b><div class="jbwbar"><i style="height:' + (stats.weeks[i].n ? Math.max(6, Math.round(stats.weeks[i].n / wmax * 100)) : 2) + '%"></i></div><span>' + esc(sd(stats.weeks[i].start)) + '</span></div>';
    w += '</div>';
    h += card('Applications per week', 'Last 8 weeks, weeks start on Monday.', w);
    if (stats.time.length) {
      tmax = 0.1; for (i = 0; i < stats.time.length; i++) if (stats.time[i].days > tmax) tmax = stats.time[i].days;
      t = '';
      for (i = 0; i < stats.time.length; i++) t += '<div class="jbfr"><div class="jbfl"><span>' + esc(stats.time[i].name) + '</span><b>' + stats.time[i].days + ' days</b></div><div class="jbtrack"><i class="jbc-' + esc(stats.time[i].color) + '" style="width:' + Math.max(2, Math.round(stats.time[i].days / tmax * 100)) + '%"></i></div></div>';
      h += card('Average time in each stage', 'Counts jobs still sitting in a stage up to today.', t);
    }
    so = '<table class="jbtbl"><tr><th>Source</th><th>Jobs</th><th>Applied</th><th>Heard</th><th>Rate</th></tr>';
    for (i = 0; i < stats.sources.length; i++) { nm = SRC[stats.sources[i].source] || stats.sources[i].source; so += '<tr><td>' + esc(nm) + '</td><td>' + stats.sources[i].total + '</td><td>' + stats.sources[i].applied + '</td><td>' + stats.sources[i].heard + '</td><td>' + pct(stats.sources[i].rate) + '</td></tr>'; }
    so += '</table>';
    h += card('Where your best leads come from', '', so);
    return h + '</div><p class="jbfoot">Heard back means an applied job that reached the third stage or later (Screening onwards by default). Reordering or renaming stages changes how this reads.</p>';
  }
  function ago(ts) {
    var d = Math.floor((App.nowMs() - App.parseTS(ts)) / 86400000);
    return d < 1 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }
  function leadsHTML() {
    if (leadsErr && !leadsLoaded) return '<div class="jbmsg">' + esc(leadsErr) + '<br><button class="btn primary" data-jb="lretry">Try again</button></div>';
    if (!leadsLoaded) return '<div class="jbmsg">Loading recommendations…</div>';
    if (!leads.length) return feedBar() + '<div class="jbmsg">Nothing to look at right now.<br><span class="jbsm">Reed postings and your LinkedIn job-alert emails land here. Save the ones you like, dismiss the rest.</span></div>';
    var h = feedBar() + '<p class="jbfoot jbtop">' + leads.length + (leads.length === 1 ? ' recommended posting' : ' recommended postings') + ', London or remote. Save moves one onto your board.</p><div class="jbcards">', i, l, meta;
    for (i = 0; i < leads.length; i++) {
      l = leads[i]; meta = [];
      if (l.location) meta.push(l.location);
      if (l.mode === 'remote' && (l.location || '').toLowerCase().indexOf('remote') < 0) meta.push('Remote');
      if (l.salary) meta.push(l.salary);
      meta.push((SRC[l.source] || l.source) + ' · ' + ago(l.created_at));
      h += '<section class="jbcard2 jblead" data-jb="lopen" data-id="' + esc(l.id) + '"><div class="jbco"><span class="jblogo jbc-sand">' + esc((l.company || l.role || '?').charAt(0).toUpperCase()) + '</span><span class="jbcoh">' + esc(l.company || 'Company not shown') + '</span>' + (typeof l.fit === 'number' ? '<span class="jbfit">' + l.fit + '% fit</span>' : '') + '</div>' +
        '<div class="jbrole">' + esc(l.role || 'Job') + '</div><div class="jbmeta">' + esc(meta.join(' · ')) + '</div>' + (l.why ? '<div class="jbwhy">Matches: ' + esc(l.why) + '</div>' : '') + boostNote(l) +
        '<div class="jbbtns"><button class="btn primary" data-jb="lsave" data-id="' + esc(l.id) + '">Save</button><button class="btn" data-jb="ldismiss" data-id="' + esc(l.id) + '">Dismiss</button>' +
        '<button class="btn' + (l.vote === 1 ? ' on' : '') + '" data-jb="llike" data-id="' + esc(l.id) + '">' + (l.vote === 1 ? 'Liked ✓' : 'More like this') + '</button></div></section>';
    }
    return h + '</div>';
  }
  function boostNote(l) {
    if (typeof l.boost !== 'number' || (l.boost < 4 && l.boost > -4)) return '';
    return '<div class="jbwhy">' + (l.boost > 0 ? '↑ Like roles you liked (+' + l.boost + ')' : '↓ Like roles you skipped (' + l.boost + ')') + '</div>';
  }
  function leadOf(id) { var i; for (i = 0; i < leads.length; i++) if (leads[i].id === id) return leads[i]; return null; }
  function openLead(id) {
    var l = leadOf(id); if (!l) return;
    var init = (l.company || l.role || '?').charAt(0).toUpperCase(), basics = [];
    if (l.location) basics.push(l.location); if (l.mode) basics.push(l.mode === 'onsite' ? 'On-site' : l.mode.charAt(0).toUpperCase() + l.mode.slice(1)); if (l.salary) basics.push(l.salary); basics.push((SRC[l.source] || l.source) + ' · ' + ago(l.created_at));
    sh = { kind: 'lead', id: id, details: l.meta || {}, descOpen: false };
    openSheet('<div class="jbsh1"><span class="jblogo big jbc-sand">' + esc(init) + '</span><div class="jbsht"><b>' + esc(l.role || 'Job') + '</b><span>' + esc(l.company || 'Company not shown') + '</span></div><button class="jbx" data-jb="close" aria-label="Close">&times;</button></div>' +
      '<div class="jbfacts"><span>' + esc(basics.join(' · ')) + '</span>' + (typeof l.fit === 'number' ? '<span>' + l.fit + '% fit</span>' : '') + '</div>' + (l.why ? '<div class="jbwhy">Matches: ' + esc(l.why) + '</div>' : '') + boostNote(l) +
      '<div id="jbInfo"></div><div class="jbhint" id="jbLoadMsg">' + (l.source === 'reed' && !l.has_desc ? 'Loading the advert…' : '') + '</div>',
      '<button class="btn primary" data-jb="lsave" data-id="' + esc(id) + '">Save</button><button class="btn" data-jb="ldismiss" data-id="' + esc(id) + '">Dismiss</button>' +
      '<button class="btn' + (l.vote === 1 ? ' on' : '') + '" data-jb="llike" data-id="' + esc(id) + '">' + (l.vote === 1 ? 'Liked ✓' : 'More like this') + '</button><button class="btn" data-jb="ldislike" data-id="' + esc(id) + '">Not for me</button>' +
      (l.url ? '<a class="btn" href="' + esc(l.url) + '" target="_blank" rel="noopener">Open on ' + esc(SRC[l.source] || 'the web') + '</a>' : ''));
    paintInfo();
    App.api('GET', '?jobs=lead&id=' + encodeURIComponent(id), null, function (st, d) {
      if (!sh || sh.kind !== 'lead' || sh.id !== id) return;
      var m = $('jbLoadMsg');
      if (st === 200 && d && d.lead) { sh.details = d.lead.details || {}; if (m) m.innerHTML = d.detail_error ? esc('Could not load the full advert (' + d.detail_error + '). The basics are above.') : ''; }
      else if (m) m.innerHTML = 'Could not load the full advert, try again later.';
      paintInfo();
    }, API);
  }
  function leadAct(id, act) {
    var l = leadOf(id);
    if (!l) return;
    if (act === 'like' && l.vote === 1) return;
    write('POST', '?jobs=leads', { id: id, action: act }, function (s, d) {
      var i;
      if (s === 200 && d) {
        if (act === 'like') { l.vote = 1; App.toast('Noted: more like this'); var lb = document.querySelectorAll('#jbSheet [data-jb=llike]'), k; for (k = 0; k < lb.length; k++) { lb[k].className = 'btn on'; lb[k].innerHTML = 'Liked ✓'; } paint(); return; }
        for (i = leads.length - 1; i >= 0; i--) if (leads[i].id === id) leads.splice(i, 1);
        newLeads = leads.length;
        if (sh && sh.kind === 'lead') closeSheet();
        if (act === 'save' && d.job) { putJob(d.job); dirty(); App.toast('Saved to ' + ((stageOf(d.job.stage_id) || {}).name || 'your board')); if (d.tasks && d.tasks.follow) App.reload(); }
        else App.toast(act === 'dislike' ? 'Got it, fewer like this' : 'Dismissed');
        paint();
      } else App.toast('Could not do that, try again');
    });
  }
  function segHTML() {
    return '<div class="jbseg"><button class="' + (view === 'board' ? 'on' : '') + '" data-jb="view" data-v="board">Board</button><button class="' + (view === 'discover' ? 'on' : '') + '" data-jb="view" data-v="discover">Discover' + (newLeads ? ' <i class="jbn">' + newLeads + '</i>' : '') + '</button><button class="' + (view === 'stats' ? 'on' : '') + '" data-jb="view" data-v="stats">Analytics</button></div>';
  }

  /* ---------- board ---------- */
  function counts() {
    var today = App.today(), soon = App.addDays(today, 7), c = { saved: 0, prog: 0, due: 0, won: 0 }, i, j, s, first = stages.length ? stages[0].id : '';
    for (i = 0; i < jobs.length; i++) {
      j = jobs[i]; s = stageOf(j.stage_id); if (!s) continue;
      if (s.kind === 'won') c.won++;
      if (s.kind === 'active') { if (j.stage_id === first) c.saved++; else c.prog++; if (j.next_on && j.next_on <= soon) c.due++; }
    }
    return c;
  }
  function cardHTML(j, s) {
    var meta = [], nx = '', over, init = (j.company || j.role || '?').charAt(0).toUpperCase(), lab;
    if (j.location) meta.push(j.location);
    for (var m = 0; m < MODES.length; m++) if (MODES[m][0] === j.mode) meta.push(MODES[m][1]);
    if (j.salary) meta.push(j.salary);
    if (j.next_step || j.next_on) {
      over = j.next_on && j.next_on < App.today() && s.kind === 'active';
      lab = (j.next_step || 'Next step') + (j.next_on ? ' · ' + sd(j.next_on) : '');
      nx = '<div class="jbnx' + (over ? ' due' : '') + '">' + ICAL + '<span>' + esc(lab) + '</span></div>';
    }
    return '<div class="jbcard" data-jb="open" data-id="' + esc(j.id) + '"><div class="jbco"><span class="jblogo jbc-' + esc(s.color) + '">' + esc(init) + '</span><span class="jbcoh">' + esc(j.company || 'No company yet') + '</span></div>' +
      '<div class="jbrole">' + esc(j.role || 'Untitled role') + '</div>' + (meta.length ? '<div class="jbmeta">' + esc(meta.join(' · ')) + '</div>' : '') + nx + '</div>';
  }
  function build() {
    if (err && !loaded) return '<div class="jbmsg">' + esc(err) + '<br><button class="btn primary" data-jb="retry">Try again</button></div>';
    if (!loaded) return '<div class="jbmsg">Loading your jobs…</div>';
    var c = counts(), h = '', tabs = '', cols = '', i, k, s, list, n, on, cards;
    if (view === 'stats') return segHTML() + statsHTML();
    if (view === 'discover') return segHTML() + leadsHTML();
    if (!stageOf(cur) && stages.length) cur = stages[0].id;
    h += segHTML() + '<div class="jbbar"><div class="jbkpis">' +
      '<div class="jbkpi"><b>' + c.saved + '</b><span>Saved</span></div><div class="jbkpi"><b>' + c.prog + '</b><span>In progress</span></div>' +
      '<div class="jbkpi"><b>' + c.due + '</b><span>Next steps, 7 days</span></div><div class="jbkpi"><b>' + c.won + '</b><span>Offers</span></div></div>' +
      '<div class="jbacts"><button class="btn" data-jb="stages">Stages</button><button class="btn primary" data-jb="add">+ Add job</button></div></div>';
    for (i = 0; i < stages.length; i++) {
      s = stages[i]; list = []; for (k = 0; k < jobs.length; k++) if (jobs[k].stage_id === s.id) list.push(jobs[k]);
      n = list.length; on = s.id === cur; cards = '';
      for (k = 0; k < list.length; k++) cards += cardHTML(list[k], s);
      if (!n) cards = '<div class="jbempty">' + (s.kind === 'won' ? 'No offers yet.' : 'Nothing here yet.') + '</div>';
      tabs += '<button class="jbtab' + (on ? ' on' : '') + '" data-jb="tab" data-sid="' + esc(s.id) + '">' + esc(s.name) + ' <i>' + n + '</i></button>';
      cols += '<section class="jbcol' + (on ? ' on' : '') + '"><div class="jbch"><span class="jbdot jbc-' + esc(s.color) + '"></span><span class="jbcn">' + esc(s.name) + '</span><span class="jbcount">' + n + '</span></div>' + cards +
        '<button class="jbaddc" data-jb="addin" data-sid="' + esc(s.id) + '">+ Add</button></section>';
    }
    return h + '<div class="jbtabs">' + tabs + '</div><div class="jbstrip" id="jbStrip">' + cols + '</div>';
  }
  function paint() {
    var pane = $('jobsPane'); if (!pane) return;
    var strip = $('jbStrip'), left = strip ? strip.scrollLeft : 0;
    if (App.setHTML(pane, build())) { strip = $('jbStrip'); if (strip && left) strip.scrollLeft = left; }
  }

  /* ---------- overlay shell ---------- */
  function overlay() {
    var o = $('jbOv');
    if (!o) {
      o = document.createElement('div'); o.id = 'jbOv'; o.className = 'jbov'; o.style.display = 'none';
      o.innerHTML = '<div class="jbdim" data-jb="close"></div><div class="jbsheet" id="jbSheet"></div>';
      document.body.appendChild(o);
    }
    return o;
  }
  function openSheet(html, foot) { var o = overlay(); $('jbSheet').innerHTML = '<div class="jbsbody" id="jbBody">' + html + '</div>' + (foot ? '<div class="jbsfoot"><div class="jbbtns">' + foot + '</div></div>' : ''); $('jbBody').scrollTop = 0; o.style.display = 'block'; }
  function closeSheet() { sh = null; var o = $('jbOv'); if (o) { o.style.display = 'none'; $('jbSheet').innerHTML = ''; } }
  function val(id) { var e = $(id); return e ? e.value : ''; }

  /* ---------- job sheet ---------- */
  function chipsHTML() {
    var h = '', i, s;
    for (i = 0; i < stages.length; i++) { s = stages[i]; h += '<button class="jbchip' + (s.id === sh.stage ? ' on' : '') + '" data-jb="move" data-sid="' + esc(s.id) + '"><span class="jbdot jbc-' + esc(s.color) + '"></span>' + esc(s.name) + '</button>'; }
    return h;
  }
  function modeHTML() {
    var h = '', i;
    for (i = 0; i < MODES.length; i++) h += '<button class="jbchip' + (sh.mode === MODES[i][0] ? ' on' : '') + '" data-jb="mode" data-v="' + MODES[i][0] + '">' + MODES[i][1] + '</button>';
    return h;
  }
  function histHTML() {
    if (!sh.events) return '';
    var h = '', i, e, t;
    for (i = 0; i < sh.events.length; i++) {
      e = sh.events[i]; t = e.kind === 'added' ? 'Added to ' + e.text : 'Moved to ' + e.text;
      h += '<div class="jbhi"><span>' + esc(t) + '</span><span>' + esc(sd(App.localISO(new Date(App.parseTS(e.at))))) + '</span></div>';
    }
    return h;
  }
  function applyTarget(d) {              // what the Apply button opens: Luc's own note if it is a link or email, else the company page Reed gave
    var how = String((d && d.apply_how) || '').replace(/^\s+|\s+$/g, '');
    if (/^https?:\/\/\S+$/i.test(how)) return { href: how, label: 'Open the application link' };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(how)) return { href: 'mailto:' + how, label: 'Email your application' };
    if (d && d.apply_url) return { href: d.apply_url, label: 'Apply on the company site' };
    return null;
  }
  function fdate(iso) { return iso ? sd(iso) : ''; }
  function infoHTML() {
    var d = sh && sh.details, h = '', f = [], i, a, ap;
    if (!d || !sh.id) return '';
    if (d.contract) f.push(d.contract); if (d.job_type) f.push(d.job_type);
    if (d.salary_year) f.push(d.salary_year + ' a year'); else if (d.salary_type && d.salary_type !== 'per annum') f.push(d.salary_type);
    if (d.posted) f.push('Posted ' + fdate(d.posted)); if (d.expires) f.push('Closes ' + fdate(d.expires));
    if (typeof d.applicants === 'number') f.push(d.applicants + (d.applicants === 1 ? ' applicant' : ' applicants'));
    a = d.ai;
    if (!f.length && !a && !d.description && !sh.aiBusy && !applyTarget(d)) return '';
    h = '<div class="jblab">About the role</div>';
    if (f.length) { h += '<div class="jbfacts">'; for (i = 0; i < f.length; i++) h += '<span>' + esc(f[i]) + '</span>'; h += '</div>'; }
    ap = applyTarget(d);
    if (ap) h += '<a class="btn jbapply" href="' + esc(ap.href) + '" target="_blank" rel="noopener">' + esc(ap.label) + '</a>';
    if (a) {
      if (a.summary) h += '<p class="jbsum">' + esc(a.summary) + '</p>';
      if (a.requirements && a.requirements.length) { h += '<div class="jbsub">Requirements</div><ul class="jbul">'; for (i = 0; i < a.requirements.length; i++) h += '<li>' + esc(a.requirements[i]) + '</li>'; h += '</ul>'; }
      if (a.nice_to_have && a.nice_to_have.length) { h += '<div class="jbsub">Nice to have</div><ul class="jbul">'; for (i = 0; i < a.nice_to_have.length; i++) h += '<li>' + esc(a.nice_to_have[i]) + '</li>'; h += '</ul>'; }
      if (a.skills && a.skills.length) { h += '<div class="jbsub">Skills to mention</div><div class="jbtags">'; for (i = 0; i < a.skills.length; i++) h += '<span>' + esc(a.skills[i]) + '</span>'; h += '</div>'; }
    } else if (sh.aiBusy) h += '<div class="jbhint">Reading the advert…</div>';
    else if (sh.aiErr && d.description) h += '<div class="jbhint">Could not read the advert yet. <button class="jblink" data-jb="reenrich">Try again</button></div>';
    if (d.description) h += '<button class="btn jbdtog" data-jb="desctog">' + (sh.descOpen ? 'Hide full description' : 'Show full description') + '</button>' + (sh.descOpen ? '<div class="jbdesc">' + esc(d.description) + '</div>' : '');
    return h;
  }
  function paintInfo() { var el = $('jbInfo'); if (el) el.innerHTML = infoHTML(); }
  function enrich() {
    if (!sh || sh.kind !== 'job' || !sh.id || !sh.details || !sh.details.description || sh.details.ai || sh.aiBusy) return;
    var id = sh.id; sh.aiBusy = true; sh.aiErr = false; paintInfo();
    App.api('POST', '?jobs=enrich', { id: id }, function (s, d) {
      if (!sh || sh.id !== id) return;
      sh.aiBusy = false;
      if (s === 200 && d && d.details) sh.details = d.details; else sh.aiErr = true;
      paintInfo();
    }, API);
  }
  function field(id, label, v, extra) {
    return '<label class="jbf"><span>' + label + '</span><input id="' + id + '" type="' + ((extra && extra.type) || 'text') + '" value="' + esc(v || '') + '" maxlength="' + ((extra && extra.max) || 120) + '" autocomplete="off" autocorrect="off" autocapitalize="' + ((extra && extra.cap) || 'words') + '" spellcheck="false"></label>';
  }
  function openJob(id, stageId) {
    var j = id ? jobOf(id) : null;
    if (id && !j) return;
    j = j || { company: '', role: '', url: '', location: '', mode: '', salary: '', next_step: '', next_on: '', next_at: '', contact: '', cv_variant: '', notes: '', source: 'manual' };
    sh = { kind: 'job', id: id || '', stage: id ? j.stage_id : (stageId || (stages[0] && stages[0].id) || ''), mode: j.mode || '', events: id ? [] : null, delArm: 0 };
    var init = (j.company || j.role || '+').charAt(0).toUpperCase();
    openSheet('<div class="jbsh1"><span class="jblogo big jbc-' + esc(colorOf(sh.stage)) + '">' + esc(init) + '</span><div class="jbsht"><b>' + esc(id ? (j.role || 'Untitled role') : 'New job') + '</b><span>' + esc(id ? (j.company || '') : 'Add what you know, the rest can wait') + '</span></div>' +
      '<button class="jbx" data-jb="close" aria-label="Close">&times;</button></div>' +
      '<div class="jblab">Stage</div><div class="jbchips" id="jbChips">' + chipsHTML() + '</div>' +
      '<div class="jbfs">' + field('jbCompany', 'Company', j.company) + field('jbRole', 'Role', j.role, { max: 160 }) +
      field('jbUrl', 'Link to the posting', j.url, { type: 'url', max: 1000, cap: 'none' }) + field('jbLoc', 'Location', j.location) + field('jbSalary', 'Salary', j.salary, { max: 60 }) + '</div>' +
      '<div class="jblab">Working pattern</div><div class="jbchips" id="jbModes">' + modeHTML() + '</div>' +
      '<div id="jbInfo"></div><div class="jblab">Next step</div><div class="jbfs">' + field('jbNext', 'What', j.next_step, { cap: 'sentences' }) + '<label class="jbf"><span>When</span><input id="jbNextOn" type="date" value="' + esc(j.next_on || '') + '"></label><label class="jbf"><span>Time (optional)</span><input id="jbNextAt" type="time" value="' + esc(j.next_at || '') + '"></label></div><div class="jbhint">Giving the next step a date adds it to your To-do list, and it moves or goes away when you change it here.</div>' +
      '<div class="jbfs">' + field('jbApplyHow', 'How to apply (link, email or form)', '', { max: 300, cap: 'none' }) + field('jbContact', 'Contact', j.contact) + field('jbCv', 'CV sent', j.cv_variant, { max: 80, cap: 'sentences' }) + '</div>' +
      '<label class="jbf"><span>Notes</span><textarea id="jbNotes" maxlength="4000" rows="5" autocapitalize="sentences">' + esc(j.notes || '') + '</textarea></label>' +
      (id ? '<div class="jbsrc">' + esc(SRC[j.source] || 'Added') + (j.created_at ? ' · ' + esc(sd(App.localISO(new Date(App.parseTS(j.created_at))))) : '') + '</div><div class="jblab">History</div><div id="jbHist"></div>' : '') +
      '', '<button class="btn primary" data-jb="save">' + (id ? 'Save' : 'Add job') + '</button>' +
      (j.url ? '<a class="btn" href="' + esc(j.url) + '" target="_blank" rel="noopener">Open posting</a>' : '') +
      (id ? '<button class="btn danger" data-jb="del" id="jbDel">Delete</button>' : ''));
    if (id) App.api('GET', '?jobs=1&id=' + encodeURIComponent(id), null, function (s, d) {
      if (s === 200 && d && sh && sh.id === id) { sh.events = d.events || []; sh.details = (d.job && d.job.details) || {}; sh.applyLoaded = true; var ah = $('jbApplyHow'); if (ah && !ah.value) ah.value = sh.details.apply_how || ''; var el = $('jbHist'); if (el) el.innerHTML = histHTML(); paintInfo(); enrich(); }
    }, API);
  }
  function taskNote(t, base) {
    if (!t) return base;
    if (t.next === 'created' || t.next === 'updated') return base + ' · to-do ' + (t.next === 'created' ? 'added' : 'updated');
    if (t.next === 'removed') return base + ' · to-do removed';
    return base;
  }
  function saveJob() {
    var company = val('jbCompany').replace(/^\s+|\s+$/g, ''), role = val('jbRole').replace(/^\s+|\s+$/g, '');
    if (!company && !role) { App.toast('Add a company or a role first'); return; }
    var body = { company: company, role: role, url: val('jbUrl').replace(/^\s+|\s+$/g, ''), location: val('jbLoc'), salary: val('jbSalary'), mode: sh.mode, next_step: val('jbNext'), next_on: val('jbNextOn'), next_at: val('jbNextOn') ? val('jbNextAt') : '', contact: val('jbContact'), cv_variant: val('jbCv'), notes: val('jbNotes') };
    var id = sh.id;
    if (!id) body.stage_id = sh.stage;
    if (!id || sh.applyLoaded) body.apply_how = val('jbApplyHow');
    write(id ? 'PATCH' : 'POST', '?jobs=1' + (id ? '&id=' + encodeURIComponent(id) : ''), body, function (s, d) {
      if ((s === 200 || s === 201) && d && d.job) { putJob(d.job); closeSheet(); paint(); dirty(); App.toast(taskNote(d.tasks, id ? 'Saved' : 'Job added')); if (d.tasks && (d.tasks.next || d.tasks.follow)) App.reload(); setTimeout(fetchJobs, 300); }
      else App.toast(s === 400 ? 'Check the link and date' : 'Could not save, try again');
    });
  }
  function moveTo(sid) {
    if (!sh || sh.stage === sid) return;
    var was = sh.stage; sh.stage = sid; App.setHTML($('jbChips'), chipsHTML());
    if (!sh.id) return; // a new job takes its stage when it is added
    write('PATCH', '?jobs=1&id=' + encodeURIComponent(sh.id), { stage_id: sid }, function (s, d) {
      if (s === 200 && d && d.job) {
        putJob(d.job); paint(); dirty();
        if (d.tasks && (d.tasks.next || d.tasks.follow)) { App.reload(); if (d.tasks.follow === 'created') App.toast('Follow-up to-do added'); }
        if (sh && sh.id === d.job.id) { sh.events.unshift({ at: new Date().toISOString(), kind: 'stage', text: (stageOf(sid) || {}).name || '' }); var el = $('jbHist'); if (el) el.innerHTML = histHTML(); }
      } else { if (sh) { sh.stage = was; App.setHTML($('jbChips'), chipsHTML()); } App.toast('Could not move it, try again'); }
    });
  }
  function delJob() {
    if (!sh || !sh.id) return;
    var b = $('jbDel');
    if (!sh.delArm) { sh.delArm = 1; if (b) b.innerHTML = 'Tap again to delete'; setTimeout(function () { if (sh && sh.delArm === 1 && b) { sh.delArm = 0; b.innerHTML = 'Delete'; } }, 4000); return; }
    var id = sh.id;
    write('DELETE', '?jobs=1&id=' + encodeURIComponent(id), null, function (s) {
      if (s === 200) { for (var i = jobs.length - 1; i >= 0; i--) if (jobs[i].id === id) jobs.splice(i, 1); closeSheet(); paint(); dirty(); App.reload(); App.toast('Deleted'); }
      else App.toast('Could not delete, try again');
    });
  }

  /* ---------- stage editor ---------- */
  function sRows() {
    var h = '', i, s, k, p, n;
    for (i = 0; i < sh.draft.length; i++) {
      s = sh.draft[i];
      h += '<div class="jbsrow" data-i="' + i + '"><div class="jbs1"><span class="jbgrip" aria-label="Drag to reorder">&#9776;</span><button class="jbswatch jbc-' + esc(s.color) + '" data-jb="pal" data-i="' + i + '" aria-label="Colour"></button>' +
        '<input class="jbsname" data-f="name" data-i="' + i + '" value="' + esc(s.name) + '" maxlength="40" autocomplete="off" autocapitalize="words" spellcheck="false">' +
        '<button class="jbsdel" data-jb="sdel" data-i="' + i + '">' + (sh.delArm === i + 1 ? 'Sure? Tap again' : 'Remove') + '</button></div>' +
        '<div class="jbs2"><select class="jbssel" data-f="kind" data-i="' + i + '">';
      for (k = 0; k < KINDS.length; k++) h += '<option value="' + KINDS[k][0] + '"' + (s.kind === KINDS[k][0] ? ' selected' : '') + '>' + KINDS[k][1] + '</option>';
      h += '</select><label class="jbsfd">Follow up after <input data-f="follow_days" data-i="' + i + '" type="number" min="1" max="60" inputmode="numeric" value="' + (s.follow_days || '') + '" placeholder="–"> days</label></div></div>';
      if (sh.pal === i) {
        h += '<div class="jbpal">';
        for (p = 0; p < COLORS.length; p++) h += '<button class="jbswatch jbc-' + COLORS[p] + (COLORS[p] === s.color ? ' on' : '') + '" data-jb="pick" data-i="' + i + '" data-c="' + COLORS[p] + '" aria-label="' + COLORS[p] + '"></button>';
        h += '</div>';
      }
    }
    return h;
  }
  function openStages() {
    var d = [], i; for (i = 0; i < stages.length; i++) d.push({ id: stages[i].id, name: stages[i].name, color: stages[i].color, kind: stages[i].kind, follow_days: stages[i].follow_days });
    sh = { kind: 'stages', draft: d, pal: -1, delArm: 0 };
    openSheet('<div class="jbsh1"><div class="jbsht"><b>Pipeline stages</b><span>Drag ☰ to reorder. Tap the colour dot to change it. Removing a stage moves its jobs to the stage before it.</span></div><button class="jbx" data-jb="close" aria-label="Close">&times;</button></div>' +
      '<div id="jbSList">' + sRows() + '</div><button class="jbaddc" data-jb="sadd">+ Add stage</button>' +
      '', '<button class="btn primary" data-jb="ssave">Save</button><button class="btn" data-jb="close">Cancel</button>');
  }
  function sRedraw() { var el = $('jbSList'); if (el) el.innerHTML = sRows(); }
  function sRemove(i) {
    var s = sh.draft[i], n = 0, k;
    if (sh.draft.length < 2) { App.toast('Keep at least one stage'); return; }
    for (k = 0; k < jobs.length; k++) if (jobs[k].stage_id === s.id) n++;
    if (n && sh.delArm !== i + 1) { sh.delArm = i + 1; sRedraw(); App.toast(n + (n === 1 ? ' job moves' : ' jobs move') + ' to the stage before'); return; }
    sh.draft.splice(i, 1); sh.delArm = 0; sh.pal = -1; sRedraw();
  }
  function saveStages() {
    var i, out = [];
    for (i = 0; i < sh.draft.length; i++) {
      if (!String(sh.draft[i].name || '').replace(/^\s+|\s+$/g, '')) { App.toast('Every stage needs a name'); return; }
      out.push({ id: sh.draft[i].id || '', name: sh.draft[i].name, color: sh.draft[i].color, kind: sh.draft[i].kind, follow_days: sh.draft[i].follow_days || null });
    }
    write('POST', '?jobs=stages', { stages: out }, function (s, d) {
      if (s === 200 && d && d.stages) { stages = d.stages; jobs = d.jobs || []; if (!stageOf(cur)) cur = ''; closeSheet(); paint(); dirty(); App.toast('Stages saved'); }
      else App.toast('Could not save the stages, try again');
    });
  }
  /* drag to reorder (touch and mouse): the row follows the finger and swaps places in the DOM; the order is read back on release */
  var drag = null;
  function dragStart(g, y) {
    var row = g.parentNode && g.parentNode.parentNode; if (!row || String(row.className).indexOf('jbsrow') < 0) return false;
    drag = { row: row, y0: y, dy: 0 }; row.className += ' drag'; return true;
  }
  function rowH(r) { return r.offsetHeight + 8; }
  function dragMove(y) {
    var d = drag, row = d.row, nx, pv, tr;
    d.dy = y - d.y0;
    for (;;) {
      nx = row.nextElementSibling; while (nx && nx.className.indexOf('jbsrow') < 0) nx = nx.nextElementSibling;
      pv = row.previousElementSibling; while (pv && pv.className.indexOf('jbsrow') < 0) pv = pv.previousElementSibling;
      if (nx && d.dy > rowH(nx) / 2 + (rowH(row) - rowH(nx)) / 2 + 2) { d.y0 += rowH(nx); d.dy = y - d.y0; row.parentNode.insertBefore(nx, row); continue; }
      if (pv && d.dy < -rowH(pv) / 2 - 2) { d.y0 -= rowH(pv); d.dy = y - d.y0; row.parentNode.insertBefore(row, pv); continue; }
      break;
    }
    tr = 'translateY(' + d.dy + 'px)'; row.style.webkitTransform = tr; row.style.transform = tr;
  }
  function dragEnd() {
    var d = drag; if (!d) return; drag = null;
    var rows = $('jbSList').childNodes, out = [], i, ix;
    for (i = 0; i < rows.length; i++) if (rows[i].className && rows[i].className.indexOf('jbsrow') >= 0) { ix = parseInt(rows[i].getAttribute('data-i'), 10); out.push(sh.draft[ix]); }
    if (out.length === sh.draft.length) sh.draft = out;
    sh.pal = -1; sh.delArm = 0; sRedraw();
  }
  (function wireDrag() {
    document.addEventListener('touchstart', function (e) {
      var g = e.target; if (!g || !sh || sh.kind !== 'stages' || String(g.className).indexOf('jbgrip') < 0 || !e.touches || e.touches.length !== 1) return;
      if (!dragStart(g, e.touches[0].clientY)) return;
      var mv = function (ev) { ev.preventDefault(); dragMove(ev.touches[0].clientY); };
      var up = function () { g.removeEventListener('touchmove', mv, false); g.removeEventListener('touchend', up, false); g.removeEventListener('touchcancel', up, false); dragEnd(); };
      g.addEventListener('touchmove', mv, false); g.addEventListener('touchend', up, false); g.addEventListener('touchcancel', up, false);
    }, false);
    document.addEventListener('mousedown', function (e) {
      var g = e.target; if (!g || !sh || sh.kind !== 'stages' || String(g.className).indexOf('jbgrip') < 0) return;
      if (!dragStart(g, e.clientY)) return;
      e.preventDefault();
      var mv = function (ev) { dragMove(ev.clientY); };
      var up = function () { document.removeEventListener('mousemove', mv, false); document.removeEventListener('mouseup', up, false); dragEnd(); };
      document.addEventListener('mousemove', mv, false); document.addEventListener('mouseup', up, false);
    }, false);
  })();

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target, act = null;
    while (el && el !== document.body) {
      if (el.nodeName === 'A') return; // links (Open posting) behave normally
      act = el.getAttribute && el.getAttribute('data-jb'); if (act) break;
      el = el.parentNode;
    }
    if (!act || !el) return;
    var sid = el.getAttribute('data-sid'), i = parseInt(el.getAttribute('data-i'), 10);
    if (act === 'retry') { err = ''; fetchJobs(); paint(); }
    else if (act === 'sretry') { statsErr = ''; fetchStats(true); paint(); }
    else if (act === 'lretry') { leadsErr = ''; fetchLeads(true); paint(); }
    else if (act === 'desctog') { if (sh) { sh.descOpen = !sh.descOpen; paintInfo(); } }
    else if (act === 'reenrich') { if (sh) { sh.aiErr = false; enrich(); } }
    else if (act === 'fcheck') runFeed(true);
    else if (act === 'fcfg') { feedOpen = !feedOpen; if (feedOpen && !feedCfg) fetchFeedCfg(); paint(); }
    else if (act === 'fsave') feedSave();
    else if (act === 'lopen') openLead(el.getAttribute('data-id'));
    else if (act === 'ldislike') leadAct(el.getAttribute('data-id'), 'dislike');
    else if (act === 'llike') leadAct(el.getAttribute('data-id'), 'like');
    else if (act === 'lsave') leadAct(el.getAttribute('data-id'), 'save');
    else if (act === 'ldismiss') leadAct(el.getAttribute('data-id'), 'dismiss');
    else if (act === 'view') { var vv = el.getAttribute('data-v'); view = vv === 'stats' ? 'stats' : vv === 'discover' ? 'discover' : 'board'; store.set('jobsView', view); if (view === 'stats') fetchStats(true); if (view === 'discover') { fetchLeads(true); openDiscover(); } paint(); }
    else if (act === 'tab') { cur = sid; store.set('jobsCur', sid); paint(); }
    else if (act === 'open') openJob(el.getAttribute('data-id'));
    else if (act === 'add') openJob('', '');
    else if (act === 'addin') openJob('', sid);
    else if (act === 'stages') openStages();
    else if (act === 'close') closeSheet();
    else if (act === 'save') saveJob();
    else if (act === 'del') delJob();
    else if (act === 'move') moveTo(sid);
    else if (act === 'mode') { var v = el.getAttribute('data-v'); sh.mode = sh.mode === v ? '' : v; App.setHTML($('jbModes'), modeHTML()); }
    else if (act === 'sadd') { if (sh.draft.length >= 12) { App.toast('12 stages is the most'); return; } sh.draft.push({ id: '', name: 'New stage', color: 'slate', kind: 'active', follow_days: null }); sh.pal = -1; sRedraw(); }
    else if (act === 'sdel') sRemove(i);
    else if (act === 'pal') { sh.pal = sh.pal === i ? -1 : i; sRedraw(); }
    else if (act === 'pick') { sh.draft[i].color = el.getAttribute('data-c'); sh.pal = -1; sRedraw(); }
    else if (act === 'ssave') saveStages();
  }, false);
  function stageField(e) {
    var t = e.target, f = t && t.getAttribute && t.getAttribute('data-f'); if (!f || !sh || sh.kind !== 'stages') return;
    var i = parseInt(t.getAttribute('data-i'), 10), s = sh.draft[i]; if (!s) return;
    if (f === 'follow_days') { var n = parseInt(t.value, 10); s.follow_days = n >= 1 && n <= 60 ? n : null; }
    else s[f] = t.value;
  }
  document.addEventListener('input', stageField, false);
  document.addEventListener('change', stageField, false);
  document.addEventListener('keydown', function (e) { if (e.keyCode === 27 && sh) closeSheet(); }, false);

  App.register('jobs', {
    title: 'Jobs',
    render: function () { paint(); if (loaded && !sh && !loading && Date.now() - fetchedAt > 45000) fetchJobs(); if (view === 'stats' && !sh && Date.now() - statsAt > 60000) fetchStats(); if (view === 'discover' && !sh && !feedOpen && Date.now() - leadsAt > 60000) fetchLeads(); },
    show: function () { App.whenToken(function () { if (!loaded || Date.now() - fetchedAt > 10000) fetchJobs(); if (view === 'stats') fetchStats(); if (view === 'discover') { fetchLeads(true); openDiscover(); } }); paint(); }
  });
})();
