(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var rows = null, err = '', loading = false, fetchedAt = 0;
  var scope = store.get('insScope');
  if (scope !== 'personal' && scope !== 'work' && scope !== 'both') scope = 'both';
  var tab = store.get('insTab') === 'day' ? 'day' : 'overview', dayISO = null;

  function fetchRows() {
    if (loading) return;
    loading = true; err = '';
    App.api('GET', '?days=120', null, function (s, d) {
      loading = false;
      if (s === 200 && d) { rows = d.rows || []; fetchedAt = Date.now(); }
      else err = s === 409 ? 'Run setup6.sql in Supabase first.' : 'Could not load your history, try again.';
      paint();
    }, '/api/history');
  }

  /* ---------- helpers ---------- */
  function listOf(x) { return x === 'work' ? 'work' : 'personal'; }
  function inScope(l) { return scope === 'both' || listOf(l) === scope; }
  function dayOf(ms) { return App.localISO(new Date(ms)); }
  function mondayOf(iso) { var d = App.dowOf(iso); return App.addDays(iso, -((d + 6) % 7)); }
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
    var d = Math.round(h / 24);
    return d + ' days';
  }

  /* ---------- numbers ---------- */
  function compute() {
    var t0 = App.today(), mon = mondayOf(t0), lastMon = App.addDays(mon, -7);
    var done = [], i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.d || r.s || !inScope(r.l)) continue; // session checklists are containers, not tasks
      done.push({ c: App.parseTS(r.c), d: App.parseTS(r.d), due: r.due, cat: r.cat, l: listOf(r.l) });
    }
    var out = { n: done.length, thisWeek: 0, lastWeek: 0, weeks: [], wd: [0, 0, 0, 0, 0, 0, 0], tod: [0, 0, 0, 0], cats: {}, split: { personal: 0, work: 0 } };
    var w;
    for (w = 7; w >= 0; w--) out.weeks.push({ start: App.addDays(mon, -7 * w), n: 0 });
    var onTime = 0, withDue = 0, waits = [], d28 = App.addDays(t0, -28), d7 = App.addDays(t0, -6), done7 = 0;
    for (i = 0; i < done.length; i++) {
      r = done[i];
      var dd = dayOf(r.d), hr = new Date(r.d).getHours();
      if (dd >= mon) out.thisWeek++; else if (dd >= lastMon) out.lastWeek++;
      for (w = out.weeks.length - 1; w >= 0; w--) if (dd >= out.weeks[w].start) { if (dd < App.addDays(out.weeks[w].start, 7)) out.weeks[w].n++; break; }
      if (dd >= d7) done7++;
      if (dd >= d28) { // recent habits only
        out.wd[(App.dowOf(dd) + 6) % 7]++;
        out.tod[hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 17 ? 1 : hr >= 17 && hr < 22 ? 2 : 3]++;
        var cn = r.cat || 'No category';
        out.cats[cn] = (out.cats[cn] || 0) + 1;
        out.split[r.l]++;
      }
      if (r.due) { withDue++; if (dd <= r.due) onTime++; }
      if (r.d > r.c) waits.push(r.d - r.c);
    }
    // open work (current lists)
    var todos = App.todos(), open = 0, behind = 0, parked = 0, oldest = 0, nowm = App.nowMs();
    for (i = 0; i < todos.length; i++) {
      var t = todos[i];
      if (t.done || t.is_session || t.low || t.paused || (App.isShelved && App.isShelved(t)) || (App.inBacklog && App.inBacklog(t)) || !inScope(t.list)) continue;
      open++;
      if (t.due_date && t.due_date <= t0 && !t.blocked) behind++;
      if (!t.due_date) { parked++; var age = Math.floor((nowm - App.parseTS(t.created_at)) / 86400000); if (age > oldest) oldest = age; }
    }
    out.open = open; out.parked = parked; out.oldest = oldest;
    out.rate = (done7 + behind) ? Math.round(done7 * 100 / (done7 + behind)) : null;
    out.done7 = done7; out.behind = behind;
    out.onTime = withDue >= 3 ? Math.round(onTime * 100 / withDue) : null; out.withDue = withDue;
    out.wait = median(waits);
    return out;
  }

  /* ---------- drawing ---------- */
  function barsSVG(vals, labels, hl) {
    var W = 320, H = 120, pad = 22, n = vals.length, max = 1, i;
    for (i = 0; i < n; i++) if (vals[i] > max) max = vals[i];
    var bw = (W - 8) / n, s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 18) + '" role="img">';
    s += '<line class="grid" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '"/>';
    for (i = 0; i < n; i++) {
      var h = Math.round((vals[i] / max) * (H - pad)), x = 4 + i * bw;
      s += '<rect x="' + (x + 4) + '" y="' + (H - h) + '" width="' + Math.max(4, bw - 8) + '" height="' + h + '" rx="3" fill="' + (i === hl ? 'var(--accent)' : 'var(--chip)') + '" stroke="var(--accent)" stroke-width="1"/>';
      if (vals[i]) s += '<text x="' + (x + bw / 2) + '" y="' + (H - h - 4) + '" text-anchor="middle">' + vals[i] + '</text>';
      if (n <= 6 || i % 2 === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H + 13) + '" text-anchor="middle">' + esc(labels[i]) + '</text>';
    }
    return s + '</svg>';
  }
  function heatRow(vals, labels) {
    var max = 1, i, h = '<div style="display:flex">';
    for (i = 0; i < vals.length; i++) if (vals[i] > max) max = vals[i];
    for (i = 0; i < vals.length; i++) {
      var a = vals[i] ? 0.18 + 0.82 * vals[i] / max : 0;
      h += '<div style="flex:1;text-align:center;margin:0 2px"><div style="height:44px;border-radius:8px;border:1px solid var(--rule);background:var(--chip);position:relative;overflow:hidden">' +
        (a ? '<div style="position:absolute;left:0;right:0;top:0;bottom:0;background:var(--accent);opacity:' + a.toFixed(2) + '"></div>' : '') +
        '<div style="position:relative;line-height:44px;font-weight:600;font-size:14px;color:var(--ink)">' + vals[i] + '</div></div>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:4px">' + esc(labels[i]) + '</div></div>';
    }
    return h + '</div>';
  }
  function hbars(pairs, total) {
    var h = '', i, max = 1;
    for (i = 0; i < pairs.length; i++) if (pairs[i][1] > max) max = pairs[i][1];
    for (i = 0; i < pairs.length; i++) h += '<div class="hbar"><span class="hl">' + esc(pairs[i][0]) + '</span><span class="hb"><i style="width:' + Math.round(pairs[i][1] * 100 / max) + '%"></i></span><span>' + pairs[i][1] + '</span></div>';
    return h;
  }
  function peak(vals, labels) {
    var b = 0, i, any = false;
    for (i = 0; i < vals.length; i++) { if (vals[i]) any = true; if (vals[i] > vals[b]) b = i; }
    return any ? labels[b] : null;
  }

  /* ---------- day review ---------- */
  function dayLabel(iso) { var p = iso.split('-'); return App.DOWL[App.dowOf(iso)] + ' ' + (+p[2]) + ' ' + App.MONL[+p[1] - 1]; }
  function clock(ms) { var d = new Date(ms); return App.pad(d.getHours()) + ':' + App.pad(d.getMinutes()); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function dayMetrics(iso) {
    var items = [], sessions = [], counts = {}, i, r, ms, dd, o;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.d || !inScope(r.l)) continue;
      ms = App.parseTS(r.d); dd = dayOf(ms);
      if (!r.s) counts[dd] = (counts[dd] || 0) + 1;
      if (dd !== iso) continue;
      o = { t: r.t || '', d: ms, c: App.parseTS(r.c), due: r.due, cat: r.cat, l: listOf(r.l), rec: !!r.r, n: r.n || 0, k: r.k || 0 };
      if (r.s) sessions.push(o); else items.push(o);
    }
    items.sort(function (a, b) { return a.d - b.d; });
    sessions.sort(function (a, b) { return a.d - b.d; });
    var m = { iso: iso, items: items, sessions: sessions, n: items.length, onTime: 0, late: 0, withDue: 0, cats: {}, split: { personal: 0, work: 0 }, hours: [], waits: [], oldest: 0, rec: 0 };
    for (i = 0; i < 24; i++) m.hours.push(0);
    for (i = 0; i < items.length; i++) {
      o = items[i];
      m.hours[new Date(o.d).getHours()]++;
      m.split[o.l]++;
      var cn = o.cat || 'No category';
      m.cats[cn] = (m.cats[cn] || 0) + 1;
      if (o.rec) m.rec++;
      if (o.due) { m.withDue++; if (iso <= o.due) m.onTime++; else m.late++; }
      if (o.d > o.c) { m.waits.push(o.d - o.c); if (o.d - o.c > m.oldest) m.oldest = o.d - o.c; }
    }
    m.wait = median(m.waits);
    var tot = 0, k, back = 0;
    for (i = 1; i <= 28; i++) { tot += counts[App.addDays(iso, -i)] || 0; back++; }
    m.avg = tot / back;
    var days = 0, better = 0;
    for (k in counts) if (counts.hasOwnProperty(k)) { days++; if (counts[k] > m.n) better++; }
    m.rank = m.n ? better + 1 : 0; m.activeDays = days;
    var added = 0, todos = App.todos(), t;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (r.s || !inScope(r.l)) continue;
      if (dayOf(App.parseTS(r.c)) === iso) added++;
    }
    for (i = 0; i < todos.length; i++) {
      t = todos[i];
      if (t.done || t.is_session || t.low || !inScope(t.list)) continue;
      if (dayOf(App.parseTS(t.created_at)) === iso) added++;
    }
    m.added = added;
    m.peak = -1;
    for (i = 0; i < 24; i++) if (m.hours[i] && (m.peak < 0 || m.hours[i] > m.hours[m.peak])) m.peak = i;
    return m;
  }
  function dayNav() {
    var t0 = App.today(), lo = App.addDays(t0, -119);
    var h = '<div class="toolbar" style="flex-wrap:wrap">' +
      '<button class="chip" data-day="-1" aria-label="Previous day"' + (dayISO <= lo ? ' disabled' : '') + '>‹ Prev</button>' +
      '<input id="insDate" type="date" class="edate" style="width:auto;margin:0 6px" value="' + dayISO + '" min="' + lo + '" max="' + t0 + '">' +
      '<button class="chip" data-day="1" aria-label="Next day"' + (dayISO >= t0 ? ' disabled' : '') + '>Next ›</button>' +
      '<button class="chip' + (dayISO === t0 ? ' on' : '') + '" data-day="today">Today</button>' +
      '<button class="chip' + (dayISO === App.addDays(t0, -1) ? ' on' : '') + '" data-day="yday">Yesterday</button></div>';
    return h + '<div class="big" style="margin:6px 0 10px">' + esc(dayLabel(dayISO)) + '</div>';
  }
  function dayHTML() {
    var t0 = App.today(), h, i;
    if (!dayISO || dayISO > t0) dayISO = t0;
    h = dayNav();
    var m = dayMetrics(dayISO), lo = App.addDays(t0, -119);
    if (dayISO < lo) return h + '<p class="empty">History only goes back 120 days.</p>';
    h += '<div class="tiles">';
    var diff = m.n - m.avg, avgTxt = (Math.round(m.avg * 10) / 10) + '';
    h += '<div class="tile"><h3>Finished</h3><div class="kpi">' + m.n + '</div><div class="ksub">' +
      (m.n ? (Math.abs(diff) < 0.5 ? 'About your usual (' + avgTxt + ' a day)' : (diff > 0 ? 'Above' : 'Below') + ' your ' + avgTxt + ' a day average') : 'Your usual is ' + avgTxt + ' a day') +
      (m.sessions.length ? ' · plus ' + plural(m.sessions.length, 'session') : '') + '</div></div>';
    if (m.n && m.activeDays > 4) h += '<div class="tile"><h3>How it ranks</h3><div class="kpi">#' + m.rank + '</div><div class="ksub">of ' + m.activeDays + ' active days in the last 120' + (m.rank === 1 ? ' · your best' : '') + '</div></div>';
    h += '<div class="tile"><h3>Dated tasks</h3><div class="kpi' + (!m.withDue ? '' : m.late === 0 ? ' ok' : m.late > m.onTime ? ' bad' : '') + '">' + (m.withDue ? m.onTime + '/' + m.withDue : '–') + '</div><div class="ksub">' +
      (!m.withDue ? 'No dated tasks finished' : m.late ? plural(m.late, 'task') + ' finished late, ' + m.onTime + ' on time' : 'All finished by their date') + '</div></div>';
    var first = m.items.length ? m.items[0].d : 0, last = m.items.length ? m.items[m.items.length - 1].d : 0;
    h += '<div class="tile"><h3>Active window</h3><div class="kpi" style="font-size:24px">' + (m.n ? (m.n > 1 ? clock(first) + '–' + clock(last) : clock(first)) : '–') + '</div><div class="ksub">' +
      (m.n > 1 ? 'Spread over ' + waitText(Math.max(last - first, 60000)) : m.n ? 'Single task' : 'Nothing finished') + (m.peak >= 0 && m.n > 2 ? ' · busiest hour ' + App.pad(m.peak) + ':00' : '') + '</div></div>';
    h += '<div class="tile"><h3>Added that day</h3><div class="kpi">' + m.added + '</div><div class="ksub">' + (m.n || m.added ? (m.n - m.added === 0 ? 'Finished the same number' : m.n > m.added ? 'You finished ' + (m.n - m.added) + ' more than you added' : 'Pile grew by ' + (m.added - m.n)) : 'Nothing added or finished') + '</div></div>';
    h += '<div class="tile"><h3>Waiting time</h3><div class="kpi" style="font-size:24px">' + (m.wait === null ? '–' : waitText(m.wait)) + '</div><div class="ksub">' + (m.wait === null ? 'Nothing to measure' : 'Typical, from adding to finishing · longest ' + waitText(m.oldest)) + '</div></div>';
    if (m.n) {
      var lab = [];
      for (i = 0; i < 24; i++) lab.push(i % 3 === 0 ? App.pad(i) : '');
      h += '<div class="tile full"><h3>When you finished things</h3><div style="max-width:560px">' + barsSVG(m.hours, lab, m.peak) + '</div></div>';
      var cp = [], k;
      for (k in m.cats) if (m.cats.hasOwnProperty(k)) cp.push([k, m.cats[k]]);
      cp.sort(function (a, b) { return b[1] - a[1]; });
      h += '<div class="tile"><h3>Where it went</h3>' + hbars(cp.slice(0, 6)) + '</div>';
      if (scope === 'both') h += '<div class="tile"><h3>Personal and work</h3>' + hbars([['Personal', m.split.personal], ['Work', m.split.work]]) + '</div>';
      if (m.rec) h += '<div class="tile"><h3>Repeating</h3><div class="kpi">' + m.rec + '</div><div class="ksub">of the ' + m.n + ' were repeating tasks</div></div>';
    }
    h += '</div>';
    h += '<h3 style="margin:14px 0 6px">' + (m.n ? 'Everything finished' : '') + '</h3>';
    if (!m.n && !m.sessions.length) h += '<p class="empty">Nothing was finished on this day.</p>';
    var o;
    for (i = 0; i < m.items.length; i++) {
      o = m.items[i];
      var chips = '';
      if (scope === 'both') chips += '<span class="cat">' + (o.l === 'work' ? 'Work' : 'Personal') + '</span>';
      if (o.cat) chips += '<span class="cat">' + esc(o.cat) + '</span>';
      if (o.rec) chips += '<span class="recur">↻ repeating</span>';
      if (o.n) chips += '<span class="cat">☑ ' + o.k + '/' + o.n + '</span>';
      if (o.due && dayISO > o.due) chips += '<span class="due overdue">' + plural(App.diffDays(dayISO, o.due), 'day') + ' late</span>';
      else if (o.due) chips += '<span class="cat">on time</span>';
      if (o.d - o.c >= 86400000) chips += '<span class="cat">took ' + waitText(o.d - o.c) + '</span>';
      h += '<div style="display:flex;gap:10px;padding:9px 2px;border-bottom:1px solid var(--rule)"><div style="width:46px;flex:none;color:var(--muted);font-variant-numeric:tabular-nums">' + clock(o.d) + '</div>' +
        '<div style="flex:1;min-width:0"><div>' + (o.t ? esc(o.t) : '<span style="color:var(--muted)">(untitled)</span>') + '</div>' + (chips ? '<div class="meta">' + chips + '</div>' : '') + '</div></div>';
    }
    if (m.sessions.length) {
      h += '<h3 style="margin:14px 0 6px">Sessions finished</h3>';
      for (i = 0; i < m.sessions.length; i++) {
        o = m.sessions[i];
        h += '<div style="display:flex;gap:10px;padding:9px 2px;border-bottom:1px solid var(--rule)"><div style="width:46px;flex:none;color:var(--muted);font-variant-numeric:tabular-nums">' + clock(o.d) + '</div>' +
          '<div style="flex:1;min-width:0"><div>' + (o.t ? esc(o.t) : '<span style="color:var(--muted)">(untitled)</span>') + '</div><div class="meta"><span class="sbadge">SESSION</span>' + (o.n ? '<span class="cat">' + o.k + ' of ' + o.n + ' steps done</span>' : '') + '</div></div></div>';
      }
    }
    h += '<div class="sethint">Times are on this device. Repeating tasks count each time you finish one.</div>';
    return h;
  }

  function paint() {
    var pane = $('insightsPane'); if (!pane) return;
    var h = '<div class="toolbar"><div class="seg">' +
      ['personal', 'work', 'both'].map(function (k) { return '<button class="' + (scope === k ? 'on' : '') + '" data-in="' + k + '">' + (k === 'both' ? 'Both' : k === 'work' ? 'Work' : 'Personal') + '</button>'; }).join('') + '</div>' +
      '<div class="seg" style="margin-left:10px"><button class="' + (tab === 'overview' ? 'on' : '') + '" data-itab="overview">Overview</button><button class="' + (tab === 'day' ? 'on' : '') + '" data-itab="day">Day review</button></div></div>';
    if (err) h += '<div class="rvsub" style="color:var(--alert)">' + esc(err) + '</div>';
    if (!rows) { App.setHTML(pane, h + (err ? '' : '<p class="empty">Loading…</p>')); return; }
    if (tab === 'day') { App.setHTML(pane, h + dayHTML()); return; }
    var m = compute();
    if (!m.n && !m.open) { App.setHTML(pane, h + '<p class="empty">Nothing to show yet. Finish a few tasks and this fills in.</p>'); return; }
    var diff = m.thisWeek - m.lastWeek, i;
    h += '<div class="tiles">';
    h += '<div class="tile"><h3>Done this week</h3><div class="kpi">' + m.thisWeek + '</div><div class="ksub">Last week ' + m.lastWeek + (m.lastWeek || m.thisWeek ? ' · ' + (diff > 0 ? '+' + diff + ' up' : diff < 0 ? (-diff) + ' down' : 'level') : '') + '</div></div>';
    h += '<div class="tile"><h3>Completion rate</h3><div class="kpi' + (m.rate === null ? '' : m.rate >= 70 ? ' ok' : m.rate < 40 ? ' bad' : '') + '">' + (m.rate === null ? '–' : m.rate + '%') + '</div><div class="ksub">' + (m.rate === null ? 'Nothing due yet' : m.done7 + ' done in 7 days, ' + m.behind + ' due or overdue now') + '</div></div>';
    h += '<div class="tile"><h3>Done on time</h3><div class="kpi' + (m.onTime === null ? '' : m.onTime >= 70 ? ' ok' : m.onTime < 40 ? ' bad' : '') + '">' + (m.onTime === null ? '–' : m.onTime + '%') + '</div><div class="ksub">' + (m.onTime === null ? 'Needs a few dated tasks' : 'of ' + m.withDue + ' dated tasks, finished by their date') + '</div></div>';
    h += '<div class="tile"><h3>Typical wait</h3><div class="kpi">' + (m.wait === null ? '–' : waitText(m.wait)) + '</div><div class="ksub">Median time from adding a task to finishing it</div></div>';
    var lab = [];
    for (i = 0; i < m.weeks.length; i++) { var p = m.weeks[i].start.split('-'); lab.push(+p[2] + ' ' + App.MONS[+p[1] - 1]); }
    var vals = [];
    for (i = 0; i < m.weeks.length; i++) vals.push(m.weeks[i].n);
    h += '<div class="tile full"><h3>Last 8 weeks (weeks starting Monday)</h3>' + barsSVG(vals, lab, m.weeks.length - 1) + '</div>';
    var wdl = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], bd = peak(m.wd, ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']);
    h += '<div class="tile"><h3>Busiest days</h3>' + heatRow(m.wd, wdl) + '<div class="ksub">' + (bd ? 'You finish most on ' + bd + ' (last 4 weeks)' : 'Last 4 weeks') + '</div></div>';
    var tl = ['Morning', 'Afternoon', 'Evening', 'Night'], bt = peak(m.tod, ['mornings', 'afternoons', 'evenings', 'late nights']);
    h += '<div class="tile"><h3>Time of day</h3>' + heatRow(m.tod, tl) + '<div class="ksub">' + (bt ? 'Mostly ' + bt + ' (last 4 weeks)' : 'Last 4 weeks') + '</div></div>';
    var cp = [], k;
    for (k in m.cats) if (m.cats.hasOwnProperty(k)) cp.push([k, m.cats[k]]);
    cp.sort(function (a, b) { return b[1] - a[1]; });
    if (cp.length) h += '<div class="tile"><h3>Where it goes (4 weeks)</h3>' + hbars(cp.slice(0, 6)) + '</div>';
    h += '<div class="tile"><h3>Parked pile</h3><div class="kpi">' + m.parked + '</div><div class="ksub">' + (m.parked ? 'Undated tasks, oldest ' + m.oldest + (m.oldest === 1 ? ' day' : ' days') : 'Nothing parked') + '</div></div>';
    if (scope === 'both') h += '<div class="tile"><h3>Personal and work (4 weeks)</h3>' + hbars([['Personal', m.split.personal], ['Work', m.split.work]]) + '</div>';
    h += '</div>';
    h += '<div class="sethint">Based on the last 120 days of finished tasks. Repeating tasks count each time you finish one.</div>';
    App.setHTML(pane, h);
  }

  document.addEventListener('click', function (e) {
    var el = e.target, a = null;
    while (el && el !== document && el.getAttribute) {
      if (el.getAttribute('data-in')) { a = 'in'; break; }
      if (el.getAttribute('data-itab')) { a = 'tab'; break; }
      if (el.getAttribute('data-day')) { a = 'day'; break; }
      el = el.parentNode;
    }
    if (!a || !el || el === document || el.disabled) return;
    if (a === 'in') { scope = el.getAttribute('data-in'); store.set('insScope', scope); }
    else if (a === 'tab') { tab = el.getAttribute('data-itab') === 'day' ? 'day' : 'overview'; store.set('insTab', tab); if (tab === 'day' && (!rows || Date.now() - fetchedAt > 60000)) fetchRows(); }
    else {
      var v = el.getAttribute('data-day'), t0 = App.today();
      if (!dayISO) dayISO = t0;
      if (v === 'today') dayISO = t0;
      else if (v === 'yday') dayISO = App.addDays(t0, -1);
      else dayISO = App.addDays(dayISO, v === '1' ? 1 : -1);
      if (dayISO > t0) dayISO = t0;
      if (dayISO < App.addDays(t0, -119)) dayISO = App.addDays(t0, -119);
    }
    paint();
  }, false);
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || el.id !== 'insDate') return;
    var v = el.value, t0 = App.today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    if (v > t0) v = t0;
    if (v < App.addDays(t0, -119)) v = App.addDays(t0, -119);
    dayISO = v; paint();
  }, false);

  App.register('insights', {
    title: 'Insights',
    register: 0,
    render: function () { paint(); },
    show: function () { if (!rows || Date.now() - fetchedAt > 60000) fetchRows(); else paint(); }
  });
})();
