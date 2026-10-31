(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc;
  var DEF = { income: 3400, savings_target: 2100, rent_cost: 700, floor: 300, daily_target: 0, split_rent: 1050, split_deposit: 1050, goal_rent: 3000, goal_deposit: 5500, bills: [] };
  var cfg = null, entries = [], loadedOnce = false, loading = false, revealed = false, err = '', saving = false, reviewOpen = false, subsOpen = false, subFilter = 'all';
  var KIND = { pay: 'Paid', open: 'Opening balance', current: 'Current account', rent: 'Rent fund', deposit: 'Deposit' }, KORDER = ['pay', 'open', 'current', 'rent', 'deposit'];
  function median(a) { if (!a.length) return 0; a = a.slice().sort(function (x, y) { return x - y; }); var n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
  var HOL = ['2026-01-01','2026-04-03','2026-04-06','2026-05-04','2026-05-25','2026-08-31','2026-12-25','2026-12-28',
    '2027-01-01','2027-03-26','2027-03-29','2027-05-03','2027-05-31','2027-08-30','2027-12-27','2027-12-28',
    '2028-01-03','2028-04-14','2028-04-17','2028-05-01','2028-05-29','2028-08-28','2028-12-25','2028-12-26'];

  function C() { var o = {}, k; for (k in DEF) if (DEF.hasOwnProperty(k)) o[k] = DEF[k]; if (cfg) for (k in cfg) if (cfg.hasOwnProperty(k)) o[k] = cfg[k]; if (!o.bills) o.bills = []; return o; }
  function num(v) { var n = parseFloat(String(v).replace(/[£,\s]/g, '')); return isNaN(n) ? null : Math.round(n * 100) / 100; }
  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    var neg = n < 0, s = Math.abs(n).toFixed(2).replace(/\.00$/, ''), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '£' + p.join('.');
  }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-12
  function isWorking(iso) { var d = App.dowOf(iso); return d !== 0 && d !== 6 && HOL.indexOf(iso) < 0; }
  function lastWorking(y, m) {
    var iso = y + '-' + App.pad(m) + '-' + App.pad(daysIn(y, m));
    while (!isWorking(iso)) iso = App.addDays(iso, -1);
    return iso;
  }
  function nextPayday(after) { // first last-working-day of a month that falls after the given date
    var p = after.split('-'), y = +p[0], m = +p[1], i;
    for (i = 0; i < 4; i++) {
      var lw = lastWorking(y, m);
      if (lw > App.addDays(after, 7)) return lw; // paid within a week of month end = early pay for the next cycle
      m++; if (m > 12) { m = 1; y++; }
    }
    return App.addDays(after, 30);
  }
  function ofKind(k) { var a = [], i; for (i = 0; i < entries.length; i++) if (entries[i].k === k) a.push(entries[i]); return a; }
  function latest(k, onOrAfter) {
    var a = ofKind(k), best = null, i;
    for (i = 0; i < a.length; i++) if ((!onOrAfter || a[i].d >= onOrAfter) && (!best || a[i].d >= best.d)) best = a[i];
    return best;
  }
  function billsBetween(from, to, c) { // due dates in (from, to]
    var out = [], d = App.addDays(from, 1), i, guard = 0;
    while (d <= to && guard++ < 70) {
      var p = d.split('-'), y = +p[0], m = +p[1], day = +p[2], dim = daysIn(y, m);
      for (i = 0; i < c.bills.length; i++) {
        var b = c.bills[i], bd = Math.min(Math.max(+b.d || 1, 1), dim);
        if (bd === day) out.push({ d: d, n: b.n, a: +b.a || 0 });
      }
      d = App.addDays(d, 1);
    }
    return out;
  }
  function sum(arr) { var s = 0, i; for (i = 0; i < arr.length; i++) s += arr[i].a; return s; }

  /* ---------- subscriptions (the bills list, with notes, cancel flags and reminders) ---------- */
  var RLAB = [[-1, 'No reminder'], [0, 'On the day'], [1, '1 day before'], [3, '3 days before'], [7, '1 week before']];
  function remOf(b) { return (b.r === 0 || b.r > 0) ? +b.r : -1; }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function nextDue(b, from) { // next date on or after `from` that this bill leaves
    var p = from.split('-'), y = +p[0], m = +p[1], k, d, iso;
    for (k = 0; k < 14; k++) {
      d = Math.min(Math.max(+b.d || 1, 1), daysIn(y, m)); iso = y + '-' + App.pad(m) + '-' + App.pad(d);
      if (iso >= from) return iso;
      m++; if (m > 12) { m = 1; y++; }
    }
    return from;
  }
  function comingSoon(c, days) {
    var out = [], today = App.today(), i, nd;
    for (i = 0; i < c.bills.length; i++) { nd = nextDue(c.bills[i], today); if (App.diffDays(nd, today) <= days) out.push({ b: c.bills[i], d: nd, i: i }); }
    out.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : x.i - y.i; });
    return out;
  }
  function when(iso) { var n = App.diffDays(iso, App.today()); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : App.fmtDate(iso); }
  function subStats(c) {
    var t = 0, cx = 0, nc = 0, nr = 0, i;
    for (i = 0; i < c.bills.length; i++) { t += +c.bills[i].a || 0; if (c.bills[i].c) { cx += +c.bills[i].a || 0; nc++; } if (remOf(c.bills[i]) >= 0) nr++; }
    return { total: t, cancel: cx, nCancel: nc, nRem: nr };
  }
  function comingHTML(c) {
    if (!c.bills.length) return '';
    var list = comingSoon(c, 10), h = '<div class="tile full"><h3>Coming out soon</h3>', i;
    if (!list.length) return h + '<div class="rvsub" style="margin:0">Nothing due in the next 10 days.</div></div>';
    for (i = 0; i < list.length; i++) {
      var x = list[i], r = remOf(x.b);
      h += '<div class="billrow"><span class="bn">' + esc(x.b.n) + (x.b.c ? ' <span class="pill bad" style="font-size:11px;padding:2px 8px">to cancel</span>' : '') + '</span><span class="ba">' + money(+x.b.a) + '</span><span class="bd" style="width:auto;min-width:80px;text-align:right">' + when(x.d) + (r >= 0 ? ' ⏰' : '') + '</span></div>';
    }
    return h + '</div>';
  }
  function subsHTML(c) {
    var h = '<div class="tile full" id="subTile"><h3>Subscriptions</h3>', st = subStats(c), i;
    if (!c.bills.length) return h + '<div class="rvsub" style="margin:0">No bills yet. Add them in Settings → Budget.</div></div>';
    var sum1 = c.bills.length + (c.bills.length === 1 ? ' bill' : ' bills') + ' · ' + money(st.total) + ' a month';
    if (st.nCancel) sum1 += '<br><b>' + st.nCancel + ' marked to cancel</b>: saves ' + money(st.cancel) + ' a month (' + money(st.cancel * 12) + ' a year)';
    if (!subsOpen) return h + '<div class="rvsub">' + sum1 + '</div><div class="row"><span class="sp"></span><button class="btn" data-b="subs">Manage subscriptions</button></div></div>';
    h += '<div class="rvsub">' + sum1 + '</div>';
    h += '<div><span class="seg"><button class="' + (subFilter === 'all' ? 'on' : '') + '" data-b="subFilter" data-f="all">All</button><button class="' + (subFilter === 'cancel' ? 'on' : '') + '" data-b="subFilter" data-f="cancel">To cancel</button></span></div>';
    h += '<div class="sethint" style="margin-bottom:6px">Marking a bill “to cancel” is a note to yourself. It still counts in your budget until you tap “Cancelled it”, which removes it.</div>';
    var shown = 0;
    for (i = 0; i < c.bills.length; i++) {
      var b = c.bills[i], r = remOf(b), j, opts = '';
      if (subFilter === 'cancel' && !b.c) continue;
      shown++;
      for (j = 0; j < RLAB.length; j++) opts += '<option value="' + RLAB[j][0] + '"' + (RLAB[j][0] === r ? ' selected' : '') + '>' + RLAB[j][1] + '</option>';
      h += '<div style="border-top:1px solid var(--rule);padding:10px 0">' +
        '<div style="font-weight:600">' + esc(b.n) + (b.c ? ' <span class="pill bad" style="font-size:11px;padding:2px 8px">to cancel</span>' : '') + '</div>' +
        '<div class="f2" style="margin-top:6px"><div><div class="sethint" style="margin:0 0 3px">Amount (£)</div><input class="setinput" style="margin:0;width:100%;box-sizing:border-box" type="number" step="0.01" inputmode="decimal" data-sub="a" data-i="' + i + '" value="' + (+b.a || 0) + '"></div>' +
        '<div><div class="sethint" style="margin:0 0 3px">Day of month</div><input class="setinput" style="margin:0;width:100%;box-sizing:border-box" type="number" inputmode="numeric" data-sub="d" data-i="' + i + '" value="' + (+b.d || 1) + '"></div>' +
        '<div><div class="sethint" style="margin:0 0 3px">Reminder</div><select class="setinput" style="margin:0;width:100%;box-sizing:border-box" data-sub="r" data-i="' + i + '">' + opts + '</select></div></div>' +
        '<input class="setinput" style="margin:8px 0 0;width:100%;box-sizing:border-box" type="text" maxlength="200" autocorrect="off" placeholder="Note (e.g. free trial ends, cancel by the 3rd)" data-sub="x" data-i="' + i + '" value="' + esc(b.x || '') + '">' +
        '<div class="row" style="margin-top:8px"><button class="chip' + (b.c ? ' on' : '') + '" style="margin:0" data-b="subCancel" data-i="' + i + '">' + (b.c ? 'To cancel ✓' : 'Mark to cancel') + '</button><span class="sp"></span>' +
        (b.c ? '<button class="btn sm" data-b="subDone" data-i="' + i + '">Cancelled it</button> ' : '') + '<button class="sdel" data-b="subDel" data-i="' + i + '" aria-label="Remove">×</button></div></div>';
    }
    if (!shown) h += '<div class="rvsub" style="border-top:1px solid var(--rule);padding-top:10px;margin:0">Nothing marked to cancel yet.</div>';
    var allopts = '<option value="">Set all…</option>';
    for (i = 0; i < RLAB.length; i++) allopts += '<option value="' + RLAB[i][0] + '">' + RLAB[i][1] + '</option>';
    h += '<div style="border-top:1px solid var(--rule);padding-top:10px"><div class="lbl" style="margin-top:0">Calendar reminders</div>' +
      '<div class="rvsub" style="margin-bottom:6px">' + (st.nRem ? st.nRem + ' of ' + c.bills.length + ' bills have a reminder.' : 'No bills have a reminder yet.') + ' Pick a reminder for each bill above, or for all at once: <select class="setinput" style="margin:0;width:auto" data-sub="rall">' + allopts + '</select></div>' +
      '<a class="btn icsbtn" style="margin-left:0" href="webcal://' + window.location.host + '/api/ics?bills=1&amp;t=' + encodeURIComponent(App.token()) + '">📅 Subscribe to bill reminders</a>' +
      '<div class="sethint">Tap this once on your iPhone. It adds a “Bills” calendar that alerts you at 9am, as many days before as you chose. Changes here reach your phone within a few hours.</div></div>';
    return h + '<div class="row"><span class="sp"></span><button class="btn" data-b="subs">Close</button></div></div>';
  }

  function savOf(k, d) { // latest balance of one savings fund on or before a date, or null
    var a = ofKind(k), best = null, i;
    for (i = 0; i < a.length; i++) if (a[i].d <= d && (!best || a[i].d >= best.d)) best = a[i];
    return best ? best.a : null;
  }
  function savAt(d) { // rent + deposit fund balance on or before a date
    var t = 0, k, kinds = ['rent', 'deposit'], i, a, best;
    for (k = 0; k < 2; k++) { a = ofKind(kinds[k]); best = null; for (i = 0; i < a.length; i++) if (a[i].d <= d && (!best || a[i].d >= best.d)) best = a[i]; if (best) t += best.a; }
    return t;
  }
  function savOut(a, b, c) { // money taken out of the savings between two dates (deposit fund, plus rent fund beyond the usual storage cost)
    var dr = savOf('deposit', a), dl = savOf('deposit', b), rr = savOf('rent', a), rl = savOf('rent', b);
    return Math.max(0, (dr !== null && dl !== null) ? dr - dl : 0) + Math.max(0, (rr !== null && rl !== null) ? rr - rl - c.rent_cost : 0);
  }
  /* Typical daily spend from how the current account falls between balance entries over the last 4 weeks.
     Bills are taken out, paydays skipped, and a rise is treated as a top-up (usually from the savings) and left out. */
  function autoSpend(c) {
    var pts = [], seen = {}, i, all = ofKind('open').concat(ofKind('current')), pays = ofKind('pay'), from = App.addDays(App.today(), -28);
    all.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : (x.k === 'open' ? -1 : 1); });
    for (i = 0; i < all.length; i++) if (!seen[all[i].d]) { seen[all[i].d] = 1; pts.push(all[i]); }
    var spend = 0, days = 0, tops = 0, fromSav = 0;
    for (i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i], n = App.diffDays(q.d, p.d), j, pay = false;
      if (n <= 0 || q.d < from) continue;
      for (j = 0; j < pays.length; j++) if (pays[j].d > p.d && pays[j].d <= q.d) pay = true;
      if (pay) continue;
      var sd = savOut(p.d, q.d, c); // money that came into the account from savings in this stretch
      if (q.a - p.a - sd > 0.5) { tops++; if (sd > 0.5) fromSav++; continue; } // a rise savings cannot explain (a refund, say): leave this stretch out
      if (sd > 0.5) { tops++; fromSav++; }
      spend += Math.max(0, p.a - q.a + sd - sum(billsBetween(p.d, q.d, c)));
      days += n;
    }
    return days >= 3 ? { perDay: spend / days, days: days, tops: tops, fromSav: fromSav } : null;
  }
  function model() {
    var c = C(), pay = latest('pay'), m = { c: c, pay: pay };
    if (!pay) return m;
    m.start = pay.d; m.next = nextPayday(pay.d);
    m.open = latest('open', pay.d);
    m.len = Math.max(1, App.diffDays(m.next, m.start));
    m.bills = billsBetween(m.start, m.next, c);
    m.billsTotal = sum(m.bills);
    if (!m.open) return m;
    var cur = latest('current', pay.d), o = m.open;
    m.last = (cur && cur.d > o.d) ? cur : o;
    m.pool = o.a - c.floor - m.billsTotal;
    m.perDay = m.pool / m.len;
    var D = m.last.d;
    m.elapsed = App.diffDays(D, m.start);
    var paid = sum(billsBetween(m.start, D, c));
    m.ideal = o.a - paid - m.perDay * m.elapsed;
    m.fromSav = savOut(o.d, D, c); // taken out of savings this month, so it is not part of what the month gave you
    m.gap = (m.last.a - m.fromSav) - m.ideal;
    m.ok = m.gap >= -0.5;
    m.billsLeft = sum(billsBetween(D, m.next, c));
    m.daysLeft = Math.max(1, App.diffDays(m.next, D));
    m.allow = (m.last.a - c.floor - m.billsLeft) / m.daysLeft;
    m.toPay = App.diffDays(m.next, App.today());
    m.cash = m.last.a - m.billsLeft;                       // cash left once the bills still due are paid
    m.auto = autoSpend(c);
    m.target = c.daily_target > 0 ? c.daily_target : (m.auto ? Math.max(1, Math.round(m.auto.perDay)) : 0);
    m.topUp = Math.max(0, m.target * m.daysLeft + c.floor + m.billsLeft - m.last.a); // extra needed to hold the daily target to payday
    m.rate = m.auto ? m.auto.perDay : 0;                   // what you have actually been spending a day
    m.short = m.rate ? Math.max(0, m.rate * m.daysLeft + m.billsLeft + c.floor - m.last.a) : 0;   // extra needed to keep the floor at that rate
    m.spare = m.rate ? Math.max(0, m.last.a - m.billsLeft - c.floor - m.rate * m.daysLeft) : 0;   // left above the floor at that rate
    m.suggest = m.allow >= 0 ? m.allow : Math.max(0, m.cash / m.daysLeft);   // the most you can spend without taking anything more from savings
    m.above = m.last.a - o.a;                             // movement against the opening balance
    m.odd = m.above - m.fromSav > 1;                                  // higher than the opening balance: money came in, or an entry is off
    return m;
  }

  /* ---------- charts (plain SVG) ---------- */
  function pathFrom(pts) { var s = '', i; for (i = 0; i < pts.length; i++) s += (i ? 'L' : 'M') + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1); return s; }
  function paceChart(m) {
    var W = 560, H = 190, L = 8, R = 8, T = 10, B = 22, c = m.c, i, pts = [], ideal = [], lo, hi, o = m.open.a;
    var cur = [[0, o]], a = ofKind('current');
    for (i = 0; i < a.length; i++) if (a[i].d > m.start && a[i].d <= m.next) cur.push([App.diffDays(a[i].d, m.start), a[i].a]);
    cur.sort(function (x, y) { return x[0] - y[0]; });
    // pace: open balance falls by perDay, with a step down on each bill day
    for (i = 0; i <= m.len; i++) {
      var d = App.addDays(m.start, i);
      ideal.push([i, o - sum(billsBetween(m.start, d, c)) - m.perDay * i]);
    }
    lo = Math.min(c.floor, o); hi = o;
    for (i = 0; i < cur.length; i++) { if (cur[i][1] < lo) lo = cur[i][1]; if (cur[i][1] > hi) hi = cur[i][1]; }
    for (i = 0; i < ideal.length; i++) if (ideal[i][1] < lo) lo = ideal[i][1];
    if (hi - lo < 1) hi = lo + 1;
    function X(v) { return L + (W - L - R) * v / m.len; }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var ip = [], cp = [];
    for (i = 0; i < ideal.length; i++) ip.push([X(ideal[i][0]), Y(ideal[i][1])]);
    for (i = 0; i < cur.length; i++) cp.push([X(cur[i][0]), Y(cur[i][1])]);
    var todayX = X(Math.min(m.len, Math.max(0, App.diffDays(App.today(), m.start))));
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(c.floor).toFixed(1) + '" y2="' + Y(c.floor).toFixed(1) + '" stroke-dasharray="4 4"/>' +
      '<text x="' + (L + 2) + '" y="' + (Y(c.floor) - 4).toFixed(1) + '">safety floor</text>' +
      '<line class="grid" x1="' + todayX.toFixed(1) + '" x2="' + todayX.toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
      '<path class="ln" d="' + pathFrom(ip) + '" stroke="#8a8174" stroke-dasharray="5 4"/>' +
      '<path class="ln" d="' + pathFrom(cp) + '" stroke="' + (m.ok ? '#4f7a5a' : '#b8432b') + '"/>' +
      '<text x="' + L + '" y="' + (H - 6) + '">' + App.fmtDate(m.start) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + App.fmtDate(m.next) + '</text></svg>';
    return svg + '<div class="lgd"><i style="background:#8a8174"></i>Planned pace<i style="background:' + (m.ok ? '#4f7a5a' : '#b8432b') + '"></i>Your balance</div>';
  }
  function savingsSeries() {
    var r = ofKind('rent'), d = ofKind('deposit'), dates = {}, i, list = [];
    for (i = 0; i < r.length; i++) dates[r[i].d] = 1;
    for (i = 0; i < d.length; i++) dates[d[i].d] = 1;
    for (var k in dates) if (dates.hasOwnProperty(k)) list.push(k);
    list.sort();
    var vr = 0, vd = 0, out = [];
    for (i = 0; i < list.length; i++) {
      var x; for (x = 0; x < r.length; x++) if (r[x].d === list[i]) vr = r[x].a;
      for (x = 0; x < d.length; x++) if (d[x].d === list[i]) vd = d[x].a;
      out.push({ d: list[i], r: vr, p: vd });
    }
    return out;
  }
  function savingsChart(s) {
    if (s.length < 2) return '';
    var W = 560, H = 170, L = 8, R = 8, T = 10, B = 22, i, hi = 1, t0 = s[0].d, span = Math.max(1, App.diffDays(s[s.length - 1].d, t0));
    for (i = 0; i < s.length; i++) { if (s[i].r + s[i].p > hi) hi = s[i].r + s[i].p; }
    function X(d) { return L + (W - L - R) * App.diffDays(d, t0) / span; }
    function Y(v) { return T + (H - T - B) * (1 - v / hi); }
    var rp = [], dp = [], tp = [];
    for (i = 0; i < s.length; i++) { rp.push([X(s[i].d), Y(s[i].r)]); dp.push([X(s[i].d), Y(s[i].p)]); tp.push([X(s[i].d), Y(s[i].r + s[i].p)]); }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '"><path class="ln" d="' + pathFrom(tp) + '" stroke="#8a8174" stroke-dasharray="5 4"/>' +
      '<path class="ln" d="' + pathFrom(rp) + '" stroke="#2f4a6d"/><path class="ln" d="' + pathFrom(dp) + '" stroke="#4f7a5a"/>' +
      '<text x="' + L + '" y="' + (H - 6) + '">' + App.fmtDate(s[0].d) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + App.fmtDate(s[s.length - 1].d) + '</text></svg>' +
      '<div class="lgd"><i style="background:#2f4a6d"></i>Rent fund<i style="background:#4f7a5a"></i>Deposit<i style="background:#8a8174"></i>Total</div>';
  }

  /* ---------- Budget view ---------- */
  function bal(n) { return '<span id="balv" class="' + (revealed ? '' : 'blur') + '" data-b="reveal">' + money(n) + '</span>'; }
  function field(id, label, ph, val) {
    return '<div><div class="sethint" style="margin:0 0 3px">' + label + '</div><input class="setinput" id="' + id + '" type="number" step="0.01" inputmode="decimal" placeholder="' + (ph || '') + '" value="' + (val === undefined || val === null ? '' : val) + '"></div>';
  }
  function dateRow(id) { return '<div class="sethint" style="margin-top:8px">Date</div><input class="setinput" id="' + id + '" type="date" value="' + App.today() + '">'; }

  function reviewHTML(m) {
    var h = '<div class="tile full" id="revTile"><h3>Entries</h3>';
    if (!reviewOpen) return h + '<div class="rvsub">Check or fix the amounts you have entered, in case one is wrong.</div><div class="row"><span class="sp"></span><button class="btn" data-b="review">Review / edit entries</button></div></div>';
    if (!revealed) return h + '<div class="rvsub">Amounts are hidden. Show them to check and edit.</div><div class="row"><button class="btn" data-b="review">Close</button><span class="sp"></span><button class="btn primary" data-b="reveal">Show amounts</button></div></div>';
    var list = entries.slice(), i, bal = [], c = m.c;
    list.sort(function (x, y) { return x.d < y.d ? 1 : x.d > y.d ? -1 : KORDER.indexOf(x.k) - KORDER.indexOf(y.k); });
    for (i = 0; i < list.length; i++) if (list[i].k === 'open' || list[i].k === 'current') bal.push(list[i].a);
    var med = median(bal);
    h += '<div class="rvsub">Newest first. Change an amount and press Save, or remove an entry. To change a date, remove the entry and add it again.' + (m.pay ? ' This month runs from ' + App.fmtDate(m.pay.d) + ', using the opening balance and the latest current account entry.' : '') + '</div>';
    h += '<div style="max-height:380px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:6px"><table style="width:100%;border-collapse:collapse">';
    for (i = 0; i < list.length && i < 80; i++) {
      var e = list[i], inUse = (m.pay && m.pay.d === e.d && e.k === 'pay') || (m.open && m.open.d === e.d && e.k === 'open') || (m.last && m.last.d === e.d && e.k === m.last.k),
        odd = ((e.k === 'open' || e.k === 'current') && bal.length >= 3 && med > 0 && (e.a > 3 * med || e.a < med / 3)) || (e.k === 'pay' && c.income > 0 && e.a > 2 * c.income),
        id = 'ent_' + e.d + '_' + e.k;
      h += '<tr style="border-top:1px solid var(--rule)"><td style="padding:7px 6px 7px 0;font-size:13px;vertical-align:middle">' + App.fmtDate(e.d) + '<br><span style="opacity:.75">' + KIND[e.k] + '</span>' +
        (inUse ? '<br><span style="font-size:11px;opacity:.75">used this month</span>' : '') + (odd ? '<br><span style="font-size:11px;color:var(--alert)">looks unusual</span>' : '') + '</td>' +
        '<td style="vertical-align:middle"><input class="setinput" style="margin:0;width:100%;box-sizing:border-box" id="' + id + '" type="number" step="0.01" inputmode="decimal" value="' + e.a + '"></td>' +
        '<td style="white-space:nowrap;text-align:right;vertical-align:middle;padding-left:6px"><button class="btn sm" data-b="entSave" data-d="' + e.d + '" data-k="' + e.k + '">Save</button> <button class="sdel" data-b="entDel" data-d="' + e.d + '" data-k="' + e.k + '" aria-label="Remove">×</button></td></tr>';
    }
    h += '</table></div>' + (list.length > 80 ? '<div class="sethint">Showing the latest 80 of ' + list.length + '.</div>' : '');
    return h + '<div class="row"><span class="sp"></span><button class="btn" data-b="review">Close</button></div></div>';
  }

  function viewHTML() {
    if (err) return '<div class="tile full"><h3>Budget</h3><div class="rvsub">' + esc(err) + '</div><button class="btn sm" data-b="retry">Try again</button></div>';
    if (!loadedOnce) return '<p class="empty">Loading…</p>';
    var m = model(), c = m.c, h = '<div class="tiles">', s = savingsSeries();
    if (!m.pay) {
      h += '<div class="tile full"><h3>Get started</h3><div class="rvsub">When you are paid, enter the amount you received. Then, after moving money to your savings, enter your balances. That sets up the month.</div></div>';
    } else if (!m.open) {
      h += '<div class="tile full"><h3>Finish payday check-in</h3><div class="rvsub">Paid ' + money(m.pay.a) + ' on ' + App.fmtDate(m.pay.d) + '. Once you have moved money to your savings, enter your balances below.</div></div>';
    } else {
      var stat;
      if (m.odd) stat = '<span class="pill">Check entries</span><div class="ksub" style="margin-top:8px">Your balance is ' + money(m.above) + ' higher than the ' + money(m.open.a) + ' you started the month with, so I can\'t say how you are pacing. Did money come in, or is a balance entry off?</div>';
      else stat = '<span class="pill ' + (m.ok ? 'ok' : 'bad') + '">' + (m.ok ? 'On track' : 'Off track') + '</span><div class="ksub" style="margin-top:8px">' + (m.ok ? 'You are ' + money(Math.abs(m.gap)) + ' ahead of the plan.' : 'You are ' + money(Math.abs(m.gap)) + ' behind the plan.') + (m.fromSav > 0.5 ? ' That counts the ' + money(m.fromSav) + ' taken from your savings as spending.' : '') + '</div>';
      if (m.toPay < 0) stat = '<span class="pill">New month</span><div class="ksub" style="margin-top:8px">Payday (' + App.fmtDate(m.next) + ') has passed. Enter your payday check-in below to start the new month.</div>';
      if (!c.bills.length) stat += '<div class="ksub">No bills added yet, so the plan is rough. Add them in Settings → Budget.</div>';
      h += '<div class="tile"><h3>Status</h3>' + stat + '<div class="ksub">Payday ' + App.fmtDate(m.next) + ' · ' + m.toPay + (m.toPay === 1 ? ' day' : ' days') + '</div><div class="ksub"><button class="btn sm" data-b="review">Review entries</button></div></div>';
      var tgt = c.daily_target > 0 ? c.daily_target : 0, sp;
      if (m.allow < 0) sp = 'Below the floor once bills are counted. Cash left after bills: ' + money(Math.max(0, m.cash)) + '.';
      else sp = 'Keeps your ' + money(c.floor) + ' floor safe until payday.';
      if (tgt) sp += (m.allow >= tgt ? ' Your ' + money(tgt) + ' a day target fits.' : ' Your ' + money(tgt) + ' a day target needs ' + money(m.topUp) + ' more.');
      if (m.rate) sp += '</div><div class="ksub">At your current rate (' + money(Math.round(m.rate)) + ' a day, from the last ' + m.auto.days + ' days) ' + (m.short > 0.5 ? 'you would need about ' + money(m.short) + ' more before payday.' : 'you would finish about ' + money(m.spare) + ' above your floor.');
      var adv = m.cash < 0 ? 'Your bills alone are ' + money(-m.cash) + ' more than you have, so that much has to come from savings.' : (m.allow < 0 ? 'That uses part of your floor, but takes nothing more from savings.' : 'That keeps your floor and takes nothing from savings.');
      if (m.fromSav > 0.5) adv += ' ' + money(m.fromSav) + ' has already come out of savings this month, so put any money left at payday back there first.';
      sp += '</div><div class="ksub"><b>Suggested: ' + money(Math.floor(m.suggest)) + ' a day.</b> ' + adv;
      h += '<div class="tile"><h3>You can spend</h3><div class="kpi ' + (m.allow < 0 ? 'bad' : '') + '">' + money(Math.max(0, m.allow)) + '<small>a day</small></div><div class="ksub">' + sp + '</div></div>';
      h += '<div class="tile"><h3>Current account</h3><div class="kpi">' + bal(m.last.a) + '</div><div class="ksub">as of ' + App.fmtDate(m.last.d) + (revealed ? '' : ' · tap to show') + '</div>' +
        '<div class="ksub">Bills still due: ' + money(m.billsLeft) + '</div></div>';
      h += '<div class="tile full"><h3>This month</h3>' + paceChart(m) + '</div>';
    }
    h += comingHTML(c) + subsHTML(c);
    h += reviewHTML(m);
    // check-in forms
    h += '<div class="tile full"><h3>Daily balance</h3><div class="rvsub">Enter your current account balance whenever you check it.</div>' +
      '<div class="numrow"><input id="bCur" type="number" step="0.01" inputmode="decimal" placeholder="Balance"><button data-b="saveCur">Save</button></div></div>';
    h += '<div class="tile full"><h3>Payday check-in</h3><div class="rvsub">' + (c.income ? 'Usually ' + money(c.income) + ': ' + money(c.savings_target) + ' to savings, ' + money(c.income - c.savings_target) + ' left to live on.' : '') + '</div>' +
      dateRow('bPayDate') + '<div class="f2" style="margin-top:8px">' + field('bPay', 'Amount paid', '', '') + field('bOpen', 'Current account after transfers', '', '') + '</div>' +
      '<div class="f2" style="margin-top:8px">' + field('bRent', 'Rent fund balance', '', '') + field('bDep', 'Deposit balance', '', '') + '</div>' +
      '<div class="row"><span class="sp"></span><button class="btn primary" data-b="savePay">Save check-in</button></div></div>';
    // savings
    var lr = latest('rent'), ld = latest('deposit'), gr = c.goal_rent, gd = c.goal_deposit;
    h += '<div class="tile full"><h3>Savings</h3>';
    if (lr || ld) {
      h += '<div class="hbar"><span class="hl">Rent fund</span><span class="hb"><i style="width:' + Math.min(100, Math.round((lr ? lr.a : 0) * 100 / (gr || 1))) + '%"></i></span><span class="hv" style="width:auto">' + (revealed ? money(lr ? lr.a : 0) : '•••') + ' / ' + money(gr) + '</span></div>' +
        '<div class="hbar"><span class="hl">Deposit</span><span class="hb"><i style="width:' + Math.min(100, Math.round((ld ? ld.a : 0) * 100 / (gd || 1))) + '%"></i></span><span class="hv" style="width:auto">' + (revealed ? money(ld ? ld.a : 0) : '•••') + ' / ' + money(gd) + '</span></div>' +
        '<div class="sethint">' + (revealed ? '' : 'Tap the current account balance to reveal amounts. ') + 'Last updated ' + App.fmtDate((lr && ld ? (lr.d > ld.d ? lr.d : ld.d) : (lr || ld).d)) + '.</div>' + savingsChart(s);
    } else h += '<div class="rvsub">Add your savings balances in the payday check-in, or below, to start tracking them.</div>';
    h += dateRow('bSavDate') + '<div class="f2" style="margin-top:8px">' + field('bRent2', 'Rent fund balance', '', '') + field('bDep2', 'Deposit balance', '', '') + '</div>' +
      '<div class="row"><span class="sp"></span><button class="btn" data-b="saveSav">Update savings</button></div></div>';
    return h + '</div><div class="sethint" style="padding:0 6px">Bills, goals and the safety floor are in Settings → Budget.</div>';
  }

  function paint() { var el = $('budgetPane'); if (el) App.setHTML(el, viewHTML()); }

  function fetchAll(cb) {
    if (loading) return; loading = true;
    App.api('GET', '', null, function (s, d) {
      loading = false;
      if (s === 200 && d) { cfg = d.config || null; entries = d.entries || []; loadedOnce = true; err = ''; }
      else if (s === 409) err = 'The budget needs the database update. Run setup6.sql in Supabase, then try again.';
      else if (!loadedOnce) err = 'Could not load the budget, check your connection.';
      paint(); if (cb) cb();
    }, '/api/budget');
  }
  function saveEntry(d, k, a, cb) {
    App.api('POST', '', { entry: { d: d, k: k, a: a } }, function (s) { cb(s === 200); }, '/api/budget');
  }
  function upsert(d, k, a) {
    for (var i = 0; i < entries.length; i++) if (entries[i].d === d && entries[i].k === k) { entries[i].a = a; return; }
    entries.push({ d: d, k: k, a: a });
    entries.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : 0; });
  }
  function saveMany(list, done) { // list of [date, kind, amount]
    var i = 0, ok = true;
    (function next() {
      if (i >= list.length) { done(ok); return; }
      var e = list[i++];
      saveEntry(e[0], e[1], e[2], function (good) { if (good) upsert(e[0], e[1], e[2]); else ok = false; next(); });
    })();
  }
  function val(id) { var el = $(id); return el ? num(el.value) : null; }
  function dval(id) { var el = $(id); return el && /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : App.today(); }

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-b'))) el = el.parentNode;
    if (!el || el === document) return;
    var a = el.getAttribute('data-b');
    if (a === 'reveal') { revealed = !revealed; paint(); }
    else if (a === 'review') {
      reviewOpen = !reviewOpen; paint();
      if (reviewOpen) { var rt = $('revTile'); if (rt && rt.scrollIntoView) { try { rt.scrollIntoView(true); } catch (x) {} } }
    } else if (a === 'entSave') {
      var ed = el.getAttribute('data-d'), ek = el.getAttribute('data-k'), inp = $('ent_' + ed + '_' + ek), ev = inp ? num(inp.value) : null;
      if (ev === null) { App.toast('Enter an amount'); return; }
      saveMany([[ed, ek, ev]], function (ok) { App.toast(ok ? 'Saved' : 'Could not save, try again'); paint(); });
    } else if (a === 'entDel') {
      var dd2 = el.getAttribute('data-d'), dk = el.getAttribute('data-k');
      App.ask({ title: 'Remove this entry?', text: KIND[dk] + ' on ' + App.fmtDate(dd2) + '. This cannot be undone.', buttons: [{ label: 'Remove', alert: true }, { label: 'Cancel', primary: true }] }, function (bi) {
        if (bi !== 0) return;
        App.api('DELETE', '?d=' + dd2 + '&k=' + dk, null, function (s) {
          if (s === 200) { for (var q = entries.length - 1; q >= 0; q--) if (entries[q].d === dd2 && entries[q].k === dk) entries.splice(q, 1); App.toast('Removed'); }
          else App.toast('Could not remove, try again');
          paint();
        }, '/api/budget');
      });
    }
    else if (a === 'subs') {
      subsOpen = !subsOpen;
      if (subsOpen) { var cs = C(); cs.bills.sort(function (x, y) { return (+x.d || 0) - (+y.d || 0); }); cfg = cs; }
      paint();
      if (subsOpen) { var st2 = $('subTile'); if (st2 && st2.scrollIntoView) { try { st2.scrollIntoView(true); } catch (x2) {} } }
    } else if (a === 'subFilter') { subFilter = el.getAttribute('data-f') === 'cancel' ? 'cancel' : 'all'; paint(); }
    else if (a === 'subCancel') {
      var cc = C(), sb = cc.bills[+el.getAttribute('data-i')];
      if (sb) { if (sb.c) delete sb.c; else sb.c = 1; cfg = cc; paint(); saveCfg(true); }
    } else if (a === 'subDone' || a === 'subDel') {
      var si = +el.getAttribute('data-i'), sc = C(), sx = sc.bills[si], isDone = a === 'subDone';
      if (!sx) return;
      App.ask({ title: isDone ? 'Cancelled ' + sx.n + '?' : 'Remove ' + sx.n + '?', text: 'This removes it from your bills, so it stops counting in your budget and in reminders.', buttons: [{ label: 'Remove', alert: true }, { label: 'Keep it', primary: true }] }, function (bi) {
        if (bi !== 0) return;
        var c3 = C(); c3.bills.splice(si, 1); cfg = c3; paint(); saveCfg(true);
      });
    }
    else if (a === 'retry') { err = ''; fetchAll(); }
    else if (a === 'saveCur') {
      var v = val('bCur'); if (v === null) { App.toast('Enter a balance'); return; }
      saveMany([[App.today(), 'current', v]], function (ok) { App.toast(ok ? 'Saved' : 'Could not save, try again'); paint(); });
    } else if (a === 'savePay') {
      var d = dval('bPayDate'), list = [], pay = val('bPay'), open = val('bOpen'), r = val('bRent'), p = val('bDep');
      if (pay !== null) list.push([d, 'pay', pay]);
      if (open !== null) list.push([d, 'open', open]);
      if (r !== null) list.push([d, 'rent', r]);
      if (p !== null) list.push([d, 'deposit', p]);
      if (!list.length) { App.toast('Enter at least one amount'); return; }
      saveMany(list, function (ok) { App.toast(ok ? 'Check-in saved' : 'Could not save everything, try again'); loadedOnce = true; paint(); });
    } else if (a === 'saveSav') {
      var d2 = dval('bSavDate'), l2 = [], r2 = val('bRent2'), p2 = val('bDep2');
      if (r2 !== null) l2.push([d2, 'rent', r2]);
      if (p2 !== null) l2.push([d2, 'deposit', p2]);
      if (!l2.length) { App.toast('Enter a balance'); return; }
      saveMany(l2, function (ok) { App.toast(ok ? 'Savings updated' : 'Could not save, try again'); paint(); });
    } else if (a === 'addBill') {
      var c = C(), n = ($('bnName').value || '').replace(/^\s+|\s+$/g, ''), amt = num($('bnAmt').value), dd = parseInt($('bnDay').value, 10);
      if (!n || amt === null || isNaN(dd) || dd < 1 || dd > 31) { App.toast('Add a name, amount and day (1-31)'); return; }
      c.bills.push({ n: n.slice(0, 40), a: amt, d: dd });
      c.bills.sort(function (x, y) { return x.d - y.d; });
      cfg = c; saveCfg(); App.refreshTab();
    } else if (a === 'delBill') {
      var c2 = C(); c2.bills.splice(+el.getAttribute('data-i'), 1); cfg = c2; saveCfg(); App.refreshTab();
    }
  }, false);

  function saveCfg(quiet) {
    App.api('POST', '', { config: C() }, function (s) { if (s !== 200) App.toast('Could not save, try again'); else if (quiet !== true) paint(); }, '/api/budget');
  }
  document.addEventListener('change', function (e) {
    var t = e.target, sk = t && t.getAttribute && t.getAttribute('data-sub');
    if (sk) {
      var c4 = C(), bi2 = +t.getAttribute('data-i'), sb2 = c4.bills[bi2], v2, k2;
      if (sk === 'rall') {
        if (t.value === '') return;
        v2 = parseInt(t.value, 10);
        for (k2 = 0; k2 < c4.bills.length; k2++) { if (v2 < 0) delete c4.bills[k2].r; else c4.bills[k2].r = v2; }
        cfg = c4; paint(); saveCfg(true); return;
      }
      if (!sb2) return;
      if (sk === 'a') { v2 = num(t.value); if (v2 === null) { App.toast('Enter an amount'); return; } sb2.a = v2; }
      else if (sk === 'd') { v2 = parseInt(t.value, 10); if (isNaN(v2) || v2 < 1 || v2 > 31) { App.toast('Day must be 1 to 31'); return; } sb2.d = v2; }
      else if (sk === 'x') { v2 = (t.value || '').replace(/^\s+|\s+$/g, '').slice(0, 200); if (v2) sb2.x = v2; else delete sb2.x; }
      else if (sk === 'r') { v2 = parseInt(t.value, 10); if (v2 < 0 || isNaN(v2)) delete sb2.r; else sb2.r = v2; }
      cfg = c4; saveCfg(true); if (sk === 'r') paint(); return;
    }
    var id = e.target && e.target.getAttribute && e.target.getAttribute('data-cfg');
    if (!id) return;
    var v = num(e.target.value); if (v === null) return;
    var c = C(); c[id] = v; cfg = c; saveCfg();
  }, false);

  /* ---------- Settings tab ---------- */
  function cfgField(k, label, hint) {
    var c = C();
    return '<div class="lbl">' + label + '</div><input class="setinput" type="number" step="0.01" inputmode="decimal" data-cfg="' + k + '" value="' + c[k] + '">' + (hint ? '<div class="sethint">' + hint + '</div>' : '');
  }
  function tabHTML() {
    var c = C(), h = '', i, total = 0;
    h += '<div class="rvsub">Changes save as you go.</div>';
    h += cfgField('income', 'Usual monthly pay (£)', 'Only used for the payday hint. What you actually receive is entered at check-in.');
    h += cfgField('savings_target', 'Monthly savings target (£)');
    h += cfgField('split_rent', 'Of which to rent fund (£)') + cfgField('split_deposit', 'Of which to deposit (£)');
    h += cfgField('rent_cost', 'Storage unit cost each month (£)', 'Paid from the Rent account, so it is not counted against your current account.') + cfgField('daily_target', 'Daily spend target (£)', 'Leave at 0 to work it out from how your balance fell over the last 4 weeks (top-ups are ignored). Enter an amount to set your own.');
    h += cfgField('floor', 'Safety floor (£)', 'The balance you never want to dip below before payday.');
    h += cfgField('goal_rent', 'Rent fund goal (£)') + cfgField('goal_deposit', 'Deposit goal (£)');
    h += '<div class="lbl">Bills &amp; subscriptions</div>';
    for (i = 0; i < c.bills.length; i++) {
      total += +c.bills[i].a || 0;
      h += '<div class="billrow"><span class="bn">' + esc(c.bills[i].n) + '</span><span class="ba">' + money(+c.bills[i].a) + '</span><span class="bd">day ' + c.bills[i].d + '</span><button class="sdel" data-b="delBill" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }
    if (c.bills.length) h += '<div class="sethint">' + c.bills.length + ' bills · ' + money(total) + ' a month</div>';
    else h += '<div class="sethint">No bills yet. Add each one once and it is counted every month.</div>';
    h += '<div class="f2" style="margin-top:10px"><div><input class="setinput" id="bnName" type="text" placeholder="Name" maxlength="40" autocorrect="off"></div><div style="flex:0 0 28%"><input class="setinput" id="bnAmt" type="number" step="0.01" inputmode="decimal" placeholder="£"></div><div style="flex:0 0 20%"><input class="setinput" id="bnDay" type="number" inputmode="numeric" placeholder="Day"></div></div>';
    h += '<div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn primary" data-b="addBill">Add bill</button></div>';
    return h;
  }
  App.addTab('budget', 'Budget', function (el) {
    if (!loadedOnce) { el.innerHTML = '<p class="empty">Loading…</p>'; fetchAll(function () { App.refreshTab(); }); return; }
    el.innerHTML = tabHTML();
  });

  App.register('budget', {
    title: 'Budget',
    render: function () { paint(); },
    show: function () { revealed = false; fetchAll(); }
  });
})();
