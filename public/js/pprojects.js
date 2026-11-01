/* My projects: Personal Projects (apps, home projects ...). Separate from Work projects (projects.js / board.js).
   Board: one column per status (Idea, In progress, Live, Paused, Not pursued, Shut down), cards in a hand-made order
   (drag the ☰ handle; personal_projects.pos), with logo, live/deploy dot, reason, "still live on Vercel" warning,
   labelled progress, last activity and links. Project page: details (links, description, dates), tasks split into
   "In my list" and "Backlog" (ideas kept out of the Personal list, todos.pp_backlog), done tasks and an activity log.
   Tasks in a project that is not Active are "shelved" by core.js (out of Overdue and the counts). ES5 only (iPad 2, iOS 9). */
(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var STAT = ['idea', 'in_progress', 'live', 'paused', 'not_pursued', 'shut_down'];
  var LABEL = { idea: 'Idea', in_progress: 'In progress', live: 'Live', paused: 'Paused', not_pursued: 'Not pursued', shut_down: 'Shut down' };
  var SHELF = { idea: 1, paused: 1, not_pursued: 1, shut_down: 1 }; // tasks of these projects are out of Overdue and the counts
  var REASON = { idea: 1, paused: 1, not_pursued: 1, shut_down: 1 }; // statuses that show the optional Reason
  var NOTLIVE = { paused: 1, not_pursued: 1, shut_down: 1 }; // warn when one of these still has a live Vercel deploy
  var LINKS = [['vercel', 'Vercel'], ['supabase', 'Supabase'], ['github', 'GitHub']];
  var DOT = { green: 'Live', orange: 'Deploying', red: 'Deploy failed', paused: 'Paused in Vercel', grey: 'Status unknown' };
  var draft = null, vseq = 0, vlist = { configured: null, projects: [], loading: false, at: 0 }, vfill = false, showAct = store.get('ppAct') === '1';
  var list = [], known = false, failed = false, tries = 0, busy = false, onView = false;
  var sel = store.get('ppSel') || '', editId = '', moveId = '', editing = false, showDone = false;
  var addTo = store.get('ppAddTo') === 'list' ? 'list' : 'backlog';
  var fold = { idea: false, paused: true, not_pursued: true, shut_down: true }; // Idea, In progress and Live open by default
  var reasonId = '', reasonDraft = '', drag = null;
  var costEdit = '', costDraft = null, budgetNames = null, budgetAsked = false, SOON = 30; // costs: id being edited ('new' = adding)
  function statusOf(p) { return p.status === 'active' ? 'in_progress' : p.status; }
  try { var fs = JSON.parse(store.get('ppFold') || 'null'), fk; if (fs && typeof fs === 'object') for (fk in fs) if (fs.hasOwnProperty(fk) && fold.hasOwnProperty(fk)) fold[fk] = !!fs[fk]; } catch (e) {}
  var dep = { configured: null, status: {}, at: 0, loading: false };
  var events = {}, evSig = {}, evTimer = null;

  /* ---------- styles: the Work board's columns (work.css .bdcols/.bdcol/.bdhead) plus project cards ---------- */
  var css = '.ppadd{display:-webkit-flex;display:flex;margin-top:8px}.ppadd input{-webkit-flex:1;flex:1;min-width:0;padding:9px 12px;border:1px solid var(--rule);border-radius:10px 0 0 10px;background:var(--bg);color:var(--ink);font-size:16px;-webkit-appearance:none;outline:none}.ppadd button{padding:0 14px;border:1px solid var(--accent);border-radius:0 10px 10px 0;background:var(--accent);color:var(--onaccent);font-weight:600;font-size:15px;-webkit-appearance:none;outline:none}' +
    '.pptools{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center;margin:6px 0 4px}' +
    '.pptools .ppadd{-webkit-flex:1 1 280px;flex:1 1 280px;max-width:460px;margin:0 12px 8px 0}' +
    '.pptools .ppadd input,.pptools .ppadd button{min-height:44px}' +
    '.ppsum{color:var(--muted);font-size:13px;margin:0 0 8px}' +
    '.bdcol.ppcolf{width:auto;min-width:0}.bdcol.ppcolf .bdname{font-size:17px;white-space:nowrap;-webkit-flex:none;flex:none}.bdcol .bdname{white-space:nowrap}' +
    '.ppdot.paused{background:transparent;border:2px solid var(--muted);width:8px;height:8px}' +
    '.pplrow{display:-webkit-flex;display:flex;margin-bottom:6px}.pplrow .setinput{-webkit-flex:1;flex:1;min-width:0}.pplrow .setinput.lb{-webkit-flex:none;flex:none;width:96px;margin-right:6px}' +
    '.pplrow .rm{-webkit-flex:none;flex:none;width:44px;min-height:40px;margin-left:6px;border:1px solid var(--rule);border-radius:10px;background:var(--chip);color:var(--alert);font-size:20px;-webkit-appearance:none}' +
    '.ppform .addl{min-height:40px;margin:0 0 10px;padding:6px 12px;border:1px dashed var(--rule);border-radius:10px;background:none;color:var(--accent);font-size:14px;-webkit-appearance:none}' +
    '.ppform select.setinput{-webkit-appearance:none;appearance:none}' +
    '.ppform .fill{margin:8px 0 12px;padding:10px;border:1px solid var(--rule);border-radius:10px;background:var(--bg)}' +
    '.ppacth{border:0;background:none;padding:0;margin:22px 0 6px;font:italic 600 24px/1.2 var(--serif);color:var(--ink);-webkit-appearance:none;outline:none;min-height:44px}.ppacth small{font:13px/1 -apple-system,Helvetica,Arial,sans-serif;color:var(--muted);margin-left:8px;font-style:normal}' +
    '.ppcard{position:relative;display:block;margin:10px 0 0;padding:12px 12px 10px;border:1px solid var(--rule);border-radius:var(--r2);background:var(--bg);cursor:pointer}' +
    '.ppcard.off{opacity:.78}' +
    '.pphd{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center}' +
    '.pplogo{-webkit-flex:none;flex:none;position:relative;width:36px;height:36px;margin-right:10px;border-radius:9px;background:var(--chip);border:1px solid var(--rule);overflow:hidden;text-align:center;font:600 18px/34px var(--serif);color:var(--muted)}' +
    '.pplogo img{position:absolute;left:0;top:0;width:100%;height:100%;background:var(--paper)}' +
    '.pplogo.big{width:56px;height:56px;border-radius:13px;font-size:26px;line-height:54px;margin-right:14px}' +
    '.ppnm{-webkit-flex:1;flex:1;min-width:0}' +
    '.ppnm b{display:block;font:600 18px/1.25 var(--serif);color:var(--ink);word-wrap:break-word;overflow-wrap:break-word}' +
    '.ppdesc{font-size:13px;line-height:1.35;color:var(--muted);margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
    '.ppdot{-webkit-flex:none;flex:none;width:12px;height:12px;margin-left:8px;border-radius:6px;background:var(--muted)}' +
    '.ppdot.green{background:var(--ok)}.ppdot.orange{background:#d9a21b}.ppdot.red{background:var(--alert)}' +
    '.ppprog{margin:10px 0 2px}' +
    '.pprow{display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;font-size:12px;color:var(--muted)}' +
    '.pprow b{color:var(--ink);font-weight:600}' +
    '.ppbar{height:6px;border-radius:3px;background:var(--rule);overflow:hidden;margin-top:4px}' +
    '.ppbar i{display:block;height:100%;background:var(--accent)}' +
    '.ppfoot{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center;margin-top:8px;font-size:12px;color:var(--muted)}' +
    '.ppfoot .sp{-webkit-flex:1;flex:1}' +
    '.pplk{display:inline-block;margin:4px 6px 0 0;padding:3px 9px;border-radius:10px;border:1px solid var(--rule);background:var(--chip);color:var(--ink);font-size:12px;text-decoration:none}' +
    '.ppmv{margin:8px 0 0;padding:6px 12px;min-height:36px;border:1px solid var(--rule);border-radius:10px;background:var(--chip);color:var(--ink);font-size:13px;-webkit-appearance:none;outline:none}' +
    '.ppmvl{margin-top:8px}.ppmvl .chip{min-height:36px}' +
    '.ppempty{color:var(--muted);font-style:italic;font-size:14px;padding:12px 0 4px}' +
    /* project page */
    '.pptop{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;margin:6px 0 14px}' +
    '.pptop .sp{-webkit-flex:1;flex:1}' +
    '.ppback{margin:0;min-height:44px;font-weight:600}' +
    '.pptop .btn{min-height:44px}' +
    '.ppwrap{display:-webkit-flex;display:flex;-webkit-align-items:flex-start;align-items:flex-start}' +
    '.ppside{-webkit-flex:none;flex:none;width:330px;margin-right:22px;background:var(--paper);border:1px solid var(--rule);border-radius:var(--r2);padding:16px}' +
    '.ppmain{-webkit-flex:1;flex:1;min-width:0}' +
    '.ppmain h2:first-child{margin-top:4px}' +
    '.ppside .pphd{margin-bottom:12px}.ppside .ppnm b{font-size:22px}' +
    '.ppside .pbtn{width:44px;height:44px;border:0;background:none;color:var(--muted);font-size:20px;-webkit-appearance:none}' +
    '.ppsec{margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)}' +
    '.ppsec .lbl{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px}' +
    '.ppsec .chip{min-height:36px}' +
    '.ppline{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;font-size:14px;color:var(--ink)}' +
    '.ppline .ppdot{margin:0 8px 0 0}' +
    '.pplinkrow{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;min-height:44px;border-bottom:1px solid var(--rule);color:var(--ink);text-decoration:none;font-size:15px}' +
    '.pplinkrow:last-child{border-bottom:0}.pplinkrow span{-webkit-flex:1;flex:1}.pplinkrow small{color:var(--muted);font-size:12px;margin-left:8px;overflow:hidden;white-space:nowrap;max-width:150px;text-overflow:ellipsis}' +
    '.ppform .frow2{margin-bottom:10px}.ppform label{display:block;font-size:12px;color:var(--muted);margin-bottom:3px}' +
    '.ppform .setinput{padding:9px 11px;font-size:16px}' +
    '.ppform .btn{margin:6px 8px 0 0}' +
    '.ppaddrow{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center;margin:0 0 6px}' +
    '.ppaddrow .ppadd{-webkit-flex:1 1 260px;flex:1 1 260px;margin:0 10px 8px 0}' +
    '.ppaddrow .ppadd input,.ppaddrow .ppadd button{min-height:44px}' +
    '.ppaddrow .sg{margin-bottom:8px}.ppaddrow .sg button{min-height:44px}' +
    '.pphint{font-size:13px;color:var(--muted);margin:2px 0 6px}' +
    '.ppev{list-style:none;margin:6px 0 0;padding:0}' +
    '.ppev li{display:-webkit-flex;display:flex;padding:7px 0;border-top:1px solid var(--rule);font-size:14px}' +
    '.ppev li span{-webkit-flex:1;flex:1;min-width:0;word-wrap:break-word}.ppev li small{-webkit-flex:none;flex:none;margin-left:10px;color:var(--muted);font-size:12px}' +
    '.ppwhere{margin-top:6px}' +
    '.pjc{border-style:dashed}' +
    '.ppreason{margin-top:8px;padding:6px 9px;border-left:3px solid var(--rule);font-size:13px;line-height:1.35;color:var(--ink);word-wrap:break-word;overflow-wrap:break-word}.ppreason b{color:var(--muted);font-weight:600}' +
    '.ppwarn{margin-top:8px;padding:7px 10px;border-radius:10px;background:var(--alert);color:#fff;font-size:13px;font-weight:600;line-height:1.3}' +
    '.ppsec .ppwarn{margin:0 0 10px}' +
    '.ppsec textarea{display:block;width:100%;min-height:76px;padding:9px 11px;border:1px solid var(--rule);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit;font-size:16px;-webkit-appearance:none;outline:none;resize:vertical}' +
    '.ppsec .rbtns .btn{margin:8px 8px 0 0;min-height:44px}' +
    '.pplk.rs{border-style:dashed;color:var(--accent);min-height:36px;margin-top:8px}' +
    '.ppdue{margin-top:8px;padding:5px 9px;border-radius:10px;background:var(--chip);color:var(--ink);font-size:13px;font-weight:600}.ppdue.late{background:var(--alert);color:#fff}.ppdue span{font-weight:400;opacity:.8}' +
    '.ppcost{padding:8px 0;border-bottom:1px solid var(--rule)}.ppcost:last-of-type{border-bottom:0}' +
    '.ppcost .r1{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center}.ppcost .r1 b{-webkit-flex:none;flex:none;margin-left:8px;font-size:15px}' +
    '.ppcost .nm{-webkit-flex:1;flex:1;min-width:0;min-height:44px;padding:0;border:0;background:none;color:var(--ink);font-size:15px;text-align:left;word-wrap:break-word;-webkit-appearance:none;outline:none}' +
    '.ppcost .r2{font-size:12px;color:var(--muted);margin-top:2px;word-wrap:break-word;overflow-wrap:break-word}.ppcost .r2 a{color:var(--accent);text-decoration:none}' +
    '.ppcost .inb{color:var(--accent);font-weight:600}' +
    '.ppcform{margin:6px 0 10px;padding:10px;border:1px solid var(--rule);border-radius:10px;background:var(--bg)}' +
    '.ppcform .sg button{min-height:40px}.ppcform .btn.danger{color:var(--alert)}' +
    '.ppcrow{display:-webkit-flex;display:flex}.ppcrow .a{-webkit-flex:1;flex:1;min-width:0;margin-right:8px}.ppcrow .c{-webkit-flex:none;flex:none;width:96px}' +
    '.ppgrip{-webkit-flex:none;flex:none;width:44px;height:44px;margin:-6px -8px -6px 4px;line-height:44px;text-align:center;color:var(--muted);font-size:19px;cursor:-webkit-grab;cursor:grab;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}' +
    '.ppcard.dragging{box-shadow:0 8px 22px rgba(0,0,0,.28);opacity:.97;background:var(--paper)}' +
    '.ppcard.dropb{box-shadow:0 -3px 0 var(--accent)}.ppcard.dropa{box-shadow:0 3px 0 var(--accent)}' +
    /* tablet / desktop (wider than 760px): the page itself never scrolls. Heights are set in px from window.innerHeight by
       layout() (iPad Safari's vh is unreliable). Board: only the lanes strip scrolls sideways and each lane body scrolls on
       its own. Project page: the "All projects" bar stays put, the side panel is frozen, only the right side scrolls. */
    '#vPprojects.ppfix .scrollview{overflow:hidden}' +
    '#vPprojects.ppfix .pane{padding-bottom:0}' +
    '.ppfix .bdcols{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding-bottom:12px}' +
    '.ppfix .bdcol{overflow:hidden}' +
    '.ppfix .pplane{overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px}' +
    '.ppfix .pptop{margin:6px 0 10px}' +
    '.ppfix .ppwrap{-webkit-align-items:stretch;align-items:stretch}' +
    '.ppfix .ppside{overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
    '.ppfix .ppmain{overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 6px 24px 0}' +
    '@media (max-width:760px){#ppPane .bdcols{white-space:normal;overflow:visible;margin:0;padding:0 0 12px}#ppPane .bdcol{display:block;width:auto;margin:0 0 12px}' +
    '.ppwrap{-webkit-flex-direction:column;flex-direction:column;-webkit-align-items:stretch;align-items:stretch}.ppmain{-webkit-order:1;order:1}.ppside{-webkit-order:2;order:2;width:auto;margin:20px 0 0}}';
  var st = document.createElement('style'); st.type = 'text/css';
  if (st.styleSheet) st.styleSheet.cssText = css; else st.appendChild(document.createTextNode(css));
  document.getElementsByTagName('head')[0].appendChild(st);

  /* ---------- data ---------- */
  function load(cb) {
    if (!App.token()) { if (tries++ < 8) setTimeout(function () { load(cb); }, 1500); return; }
    App.api('GET', '', null, function (s, d) {
      if (s === 200 && d && d.projects) {
        for (var i = 0; i < d.projects.length; i++) {
          if (!d.projects[i].meta || typeof d.projects[i].meta !== 'object') d.projects[i].meta = {};
          if (!d.projects[i].costs || !d.projects[i].costs.push) d.projects[i].costs = [];
        }
        list = d.projects; known = true; failed = false; App.setPProjects(list);
      } else if (!known) failed = true;
      if (cb) cb();
    }, '/api/pprojects');
  }
  function loadDeploy(force) {
    if (dep.loading || (!force && Date.now() - dep.at < 5 * 60000)) return;
    var any = false, i;
    for (i = 0; i < list.length; i++) if (list[i].meta && list[i].meta.vercel) any = true;
    if (!any) return;
    dep.loading = true;
    App.api('GET', '?deploy=1', null, function (s, d) {
      dep.loading = false; dep.at = Date.now();
      if (s === 200 && d) { dep.configured = !!d.configured; dep.status = d.status || {}; }
      paint();
    }, '/api/pprojects');
  }
  function loadEvents(id) {
    App.api('GET', '?events=' + encodeURIComponent(id), null, function (s, d) {
      if (s === 200 && d && d.events) { events[id] = d.events; if (sel === id) paint(); }
    }, '/api/pprojects');
  }
  setTimeout(function () { load(function () { if (onView) { paint(); loadDeploy(); } }); }, 700);
  document.addEventListener('visibilitychange', function () { if (!App.hidden()) load(function () { if (onView) { paint(); loadDeploy(); } }); }, false);

  function byId(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function tasksOf(id) { // this project's Personal tasks the app has loaded (open ones, plus those finished in the last 7 days)
    var all = App.todos(), out = { mine: [], back: [], done: [] }, i, t;
    for (i = 0; i < all.length; i++) {
      t = all[i];
      if (t.pproject_id !== id || (t.list || 'personal') !== 'personal') continue;
      if (t.done) out.done.push(t); else if (t.pp_backlog) out.back.push(t); else out.mine.push(t);
    }
    var byDue = function (a, b) {
      if ((a.due_date || '') !== (b.due_date || '')) { if (!a.due_date) return 1; if (!b.due_date) return -1; return a.due_date < b.due_date ? -1 : 1; }
      return App.parseTS(a.created_at) - App.parseTS(b.created_at);
    };
    out.mine.sort(byDue);
    out.back.sort(function (a, b) { return App.parseTS(b.created_at) - App.parseTS(a.created_at); });
    out.done.sort(function (a, b) { return App.parseTS(b.done_at) - App.parseTS(a.done_at); });
    return out;
  }
  function progress(p) { // done = finished more than a week ago (from the server) + finished recently (live)
    var t = tasksOf(p.id), done = (p.done_old || 0) + t.done.length, open = t.mine.length + t.back.length, all = done + open;
    return { done: done, open: open, back: t.back.length, all: all, pct: all ? Math.round(done * 100 / all) : 0 };
  }
  function setStore(k, v) { if (v) store.set(k, v); else store.del(k); }
  function ago(ts) {
    var ms = App.nowMs() - App.parseTS(ts), m = Math.floor(ms / 60000);
    if (!ts || isNaN(ms)) return '';
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.floor(m / 60) + 'h ago';
    var d = Math.floor(m / 1440);
    if (d < 14) return d + 'd ago';
    var dt = new Date(App.parseTS(ts));
    return dt.getDate() + ' ' + App.MONS[dt.getMonth()];
  }
  function fmtD(iso) { var p = (iso || '').split('-'); return p.length === 3 ? (+p[2]) + ' ' + App.MONS[+p[1] - 1] + ' ' + p[0] : ''; }
  function host(u) { var m = /^https?:\/\/([^\/?#]+)(\/[^?#]*)?/i.exec(u || ''); return m ? m[1].replace(/^www\./, '') + (m[2] && m[2] !== '/' ? m[2].replace(/\/$/, '') : '') : u; }
  function touch(p) { if (p) p.last_at = new Date(App.nowMs()).toISOString(); }

  /* ---------- pieces ---------- */
  /* ---------- subscriptions and costs ---------- */
  var SYM = { GBP: '£', EUR: '€', USD: '$' }, FREQL = { monthly: 'a month', yearly: 'a year', one_off: 'one-off' };
  function money(a, cur) {
    var n = (+a || 0).toFixed(2).replace(/\.00$/, ''), sy = SYM[cur || 'GBP'];
    return sy ? sy + n : n + ' ' + (cur || '');
  }
  function addMonthsISO(iso, n, day) { // keeps the original day of the month where it fits (31st -> 30th/28th)
    var p = iso.split('-'), y = +p[0], m = +p[1] - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), d = Math.min(day, dim);
    return y + '-' + App.pad(m + 1) + '-' + App.pad(d);
  }
  function dueOf(c) { // next date it is due (monthly/yearly roll forward past today); one-offs keep their date
    if (!c.next_due) return null;
    var base = String(c.next_due).slice(0, 10), d = base, today = App.today(), day = +base.split('-')[2], k = 0, step = c.freq === 'yearly' ? 12 : 1;
    if (c.freq === 'one_off') return d;
    while (d < today && k < 600) { k++; d = addMonthsISO(base, step * k, day); } // always counted from the stored date, so the 31st stays the 31st
    return d;
  }
  function inDays(iso) { return App.diffDays(iso, App.today()); }
  function whenText(iso) {
    var n = inDays(iso);
    return n < 0 ? (-n === 1 ? 'yesterday' : -n + ' days ago') : n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days';
  }
  function dueSoon(p) { // costs due within 30 days (or a one-off that has passed), soonest first
    var out = [], cs = p.costs || [], i, d;
    for (i = 0; i < cs.length; i++) { d = dueOf(cs[i]); if (d && inDays(d) <= SOON && (inDays(d) >= 0 || cs[i].freq === 'one_off')) out.push({ c: cs[i], d: d }); }
    out.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return out;
  }
  function dueHTML(p) {
    var ds = dueSoon(p); if (!ds.length) return '';
    var x = ds[0], late = inDays(x.d) < 0;
    return '<div class="ppdue' + (late ? ' late' : '') + '">' + (late ? 'Overdue' : 'Due ' + whenText(x.d)) + ': ' + esc(x.c.name) + ' · ' + money(x.c.amount, x.c.currency) +
      (ds.length > 1 ? ' <span>+' + (ds.length - 1) + ' more</span>' : '') + '</div>';
  }
  function totalsText(cs) { // recurring costs per currency as "£25 a month · £300 a year", plus one-offs
    var by = {}, order = [], i, c, k, parts = [];
    for (i = 0; i < cs.length; i++) {
      c = cs[i]; k = c.currency || 'GBP';
      if (!by[k]) { by[k] = { m: 0, one: 0 }; order.push(k); }
      if (c.freq === 'monthly') by[k].m += +c.amount; else if (c.freq === 'yearly') by[k].m += c.amount / 12; else by[k].one += +c.amount;
    }
    for (i = 0; i < order.length; i++) {
      k = order[i];
      if (by[k].m) parts.push(money(by[k].m, k) + ' a month · ' + money(by[k].m * 12, k) + ' a year');
      if (by[k].one) parts.push(money(by[k].one, k) + ' one-off');
    }
    return parts.join(' · ');
  }
  function inBudget(name) { // a Budget bill with a similar name (so the same thing is not tracked twice by accident)
    if (!budgetNames) return false;
    var n = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, ''), i, b;
    if (n.length < 3) return false;
    for (i = 0; i < budgetNames.length; i++) { b = budgetNames[i]; if (b.length >= 3 && (b === n || b.indexOf(n) >= 0 || n.indexOf(b) >= 0)) return true; }
    return false;
  }
  function loadBudgetNames() { // read-only look at Budget's bills, once per visit
    if (budgetAsked) return; budgetAsked = true;
    App.api('GET', '', null, function (s, d) {
      var bs = s === 200 && d && d.config && d.config.bills, out = [], i;
      if (bs && bs.length) for (i = 0; i < bs.length; i++) if (bs[i] && bs[i].n) out.push(String(bs[i].n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, ''));
      budgetNames = out; paint();
    }, '/api/budget');
  }
  function costsHTML(p) {
    var cs = p.costs || [], h = '<div class="ppsec ppcosts"><div class="lbl">Subscriptions and costs</div>', i, c, d, tt;
    if (cs.length && !budgetAsked) loadBudgetNames();
    for (i = 0; i < cs.length; i++) {
      c = cs[i];
      if (costEdit === c.id) { h += costForm(c); continue; }
      d = dueOf(c);
      h += '<div class="ppcost"><div class="r1"><button class="nm" data-pp="cedit" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button><b>' + money(c.amount, c.currency) + '</b></div>' +
        '<div class="r2">' + FREQL[c.freq] + (d ? ' · ' + (c.freq === 'one_off' ? 'due ' : 'next ') + fmtD(d) + ' (' + whenText(d) + ')' : '') +
        (inBudget(c.name) ? ' · <span class="inb">also in Budget</span>' : '') + '</div>' +
        ((c.link || c.email) ? '<div class="r2">' + (c.link ? '<a href="' + esc(c.link) + '" target="_blank" rel="noopener">' + esc(host(c.link)) + ' ↗</a>' : '') +
          (c.link && c.email ? ' · ' : '') + (c.email ? esc(c.email) : '') + '</div>' : '') + '</div>';
    }
    if (costEdit === 'new') h += costForm(null);
    else h += '<button class="pplk rs" data-pp="cadd">+ Add a cost</button>';
    tt = totalsText(cs);
    if (tt) h += '<div class="pphint">' + tt + '</div>';
    return h + '</div>';
  }
  function costForm(c) {
    var d = costDraft, curs = ['GBP', 'EUR', 'USD'], i, h = '<form class="ppform ppcform" id="ppCostForm" autocomplete="off">';
    if (curs.indexOf(d.currency) < 0) curs.push(d.currency);
    h += '<div class="frow2"><label>Name</label><input class="setinput" id="ppCname" type="text" maxlength="60" placeholder="e.g. Domain renewal, Vercel Pro" value="' + esc(d.name) + '"></div>';
    h += '<div class="frow2 ppcrow"><div class="a"><label>Amount</label><input class="setinput" id="ppCamt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + esc(d.amount) + '"></div>' +
      '<div class="c"><label>Currency</label><select class="setinput" id="ppCcur">';
    for (i = 0; i < curs.length; i++) h += '<option value="' + curs[i] + '"' + (d.currency === curs[i] ? ' selected' : '') + '>' + curs[i] + '</option>';
    h += '</select></div></div>';
    h += '<div class="frow2"><label>How often</label><span class="sg">';
    var fq = [['monthly', 'Monthly'], ['yearly', 'Yearly'], ['one_off', 'One-off']];
    for (i = 0; i < fq.length; i++) h += '<button type="button" class="' + (d.freq === fq[i][0] ? 'on' : '') + '" data-pp="cfreq" data-val="' + fq[i][0] + '">' + fq[i][1] + '</button>';
    h += '</span></div>';
    h += '<div class="frow2"><label>' + (d.freq === 'one_off' ? 'Due date' : 'Next due date') + '</label><input class="setinput" id="ppCdue" type="date" value="' + esc(d.next_due) + '"></div>';
    h += '<div class="frow2"><label>Link (optional)</label><input class="setinput" id="ppClink" type="url" autocapitalize="off" autocorrect="off" placeholder="https://…" value="' + esc(d.link) + '"></div>';
    h += '<div class="frow2"><label>Email on the account (optional)</label><input class="setinput" id="ppCemail" type="email" autocapitalize="off" autocorrect="off" placeholder="you@example.com" value="' + esc(d.email) + '"></div>';
    h += '<button class="btn primary" type="submit"' + (busy ? ' disabled' : '') + '>' + (c ? 'Save' : 'Add cost') + '</button><button class="btn" type="button" data-pp="cx">Cancel</button>' +
      (c ? '<button class="btn danger" type="button" data-pp="cdel" data-id="' + esc(c.id) + '">Delete</button>' : '');
    return h + '</form>';
  }
  function startCost(c) {
    costEdit = c ? c.id : 'new';
    costDraft = { name: c ? c.name : '', amount: c ? String(c.amount) : '', currency: c ? c.currency : 'GBP', freq: c ? c.freq : 'monthly',
      next_due: c && c.next_due ? String(c.next_due).slice(0, 10) : '', link: c && c.link ? c.link : '', email: c && c.email ? c.email : '' };
  }
  var CF = { ppCname: 'name', ppCamt: 'amount', ppCcur: 'currency', ppCdue: 'next_due', ppClink: 'link', ppCemail: 'email' };
  function saveCost() {
    var p = byId(sel), d = costDraft; if (!p || !d || busy) return;
    var t = function (v) { return (v || '').replace(/^\s+|\s+$/g, ''); };
    if (!t(d.name)) { App.toast('Give the cost a name'); return; }
    if (t(d.amount) === '' || isNaN(+t(d.amount)) || +t(d.amount) < 0) { App.toast('Enter the amount, e.g. 12.99'); return; }
    var body = { name: t(d.name), amount: +t(d.amount), currency: d.currency, freq: d.freq, next_due: t(d.next_due), link: t(d.link), email: t(d.email) };
    var isNew = costEdit === 'new', cid = costEdit;
    if (isNew) body.project_id = p.id;
    busy = true; paint();
    App.api(isNew ? 'POST' : 'PATCH', isNew ? '?cost=1' : '?cost=' + encodeURIComponent(cid), body, function (s, r) {
      busy = false;
      if ((s === 200 || s === 201) && r && r.cost) {
        var cs = p.costs || (p.costs = []), i, done = false;
        for (i = 0; i < cs.length; i++) if (cs[i].id === r.cost.id) { cs[i] = r.cost; done = true; }
        if (!done) cs.push(r.cost);
        costEdit = ''; costDraft = null; touch(p); App.toast(isNew ? 'Cost added' : 'Cost saved'); loadEvents(p.id);
      } else App.toast(errText(s, r));
      paint();
    }, '/api/pprojects');
  }
  function deleteCost(id) {
    var p = byId(sel); if (!p || busy) return;
    if (!window.confirm('Delete this cost?')) return;
    busy = true; paint();
    App.api('DELETE', '?cost=' + encodeURIComponent(id), null, function (s, r) {
      busy = false;
      if (s === 200) {
        p.costs = (p.costs || []).filter(function (c) { return c.id !== id; });
        costEdit = ''; costDraft = null; touch(p); App.toast('Cost deleted'); loadEvents(p.id);
      } else App.toast(errText(s, r));
      paint();
    }, '/api/pprojects');
  }
  function logoHTML(p, big) {
    var m = p.meta || {}, letter = esc((p.name || '?').charAt(0).toUpperCase());
    return '<span class="pplogo' + (big ? ' big' : '') + '">' + letter +
      (m.icon ? '<img src="' + esc(m.icon) + '" alt="" onerror="this.parentNode.removeChild(this)">' : '') + '</span>';
  }
  function depOf(p) {
    if (!p.meta || !p.meta.vercel) return null;
    if (dep.configured === false) return null;
    return dep.status[p.id] || null;
  }
  function dotHTML(p) {
    var d = depOf(p); if (!d) return '';
    return '<span class="ppdot ' + esc(d.color || 'grey') + '" title="' + esc(DOT[d.color] || DOT.grey) + '" aria-label="' + esc(DOT[d.color] || DOT.grey) + '"></span>';
  }
  function sitesOf(m) { return (m.sites && m.sites.length) ? m.sites : (m.site ? [m.site] : []); }
  function linksOf(m) { return (m.links && m.links.length) ? m.links : (m.claude ? [{ l: 'Claude', u: m.claude }] : []); }
  function allLinks(p, chips) { // [label, url, small text] in display order; chips: label several websites by domain
    var m = p.meta || {}, out = [], i, ss = sitesOf(m), ls = linksOf(m);
    for (i = 0; i < ss.length; i++) out.push([chips && ss.length > 1 ? host(ss[i]).split('/')[0] : 'Website', ss[i], host(ss[i])]);
    for (i = 0; i < LINKS.length; i++) if (m[LINKS[i][0]]) out.push([LINKS[i][1], m[LINKS[i][0]], host(m[LINKS[i][0]])]);
    for (i = 0; i < ls.length; i++) out.push([ls[i].l || 'Link', ls[i].u, host(ls[i].u)]);
    return out;
  }
  function linkChips(p) {
    var a = allLinks(p, true), h = '', i;
    for (i = 0; i < a.length && i < 6; i++) h += '<a class="pplk" href="' + esc(a[i][1]) + '" target="_blank" rel="noopener">' + esc(a[i][0]) + ' ↗</a>';
    if (a.length > 6) h += '<span class="pplk">+' + (a.length - 6) + ' more</span>';
    return h;
  }
  function progHTML(pg, bare) {
    if (!pg.all) return '';
    return '<div class="ppprog"><div class="pprow"><span>' + (bare ? '' : 'Progress · ') + pg.pct + '%</span><b>' + pg.done + ' of ' + pg.all + ' done</b></div>' +
      '<div class="ppbar" role="img" aria-label="' + pg.pct + ' percent done"><i style="width:' + pg.pct + '%"></i></div></div>';
  }
  function stillLive(p) { var d = depOf(p); return !!(NOTLIVE[statusOf(p)] && d && d.color === 'green'); } // shelved but Vercel serves a live production deploy
  function warnHTML(p) { return stillLive(p) ? '<div class="ppwarn" role="alert">⚠ Marked ' + LABEL[statusOf(p)].toLowerCase() + ' but still live on Vercel</div>' : ''; }
  function reasonOf(p) { return REASON[statusOf(p)] && p.meta && p.meta.reason ? p.meta.reason : ''; }
  function cardHTML(p, grip) {
    var pg = progress(p), m = p.meta || {}, h, rs = reasonOf(p);
    h = '<div class="ppcard' + (NOTLIVE[statusOf(p)] ? ' off' : '') + '" data-pp="open" data-id="' + esc(p.id) + '">' +
      '<div class="pphd">' + logoHTML(p) + '<div class="ppnm"><b>' + esc(p.name) + '</b>' + (m.desc ? '<div class="ppdesc">' + esc(m.desc) + '</div>' : '') + '</div>' + dotHTML(p) +
      (grip ? '<div class="ppgrip" data-pp="grip" data-id="' + esc(p.id) + '" aria-label="Drag to reorder">☰</div>' : '') + '</div>' +
      warnHTML(p) + (rs ? '<div class="ppreason"><b>Why:</b> ' + esc(rs) + '</div>' : '') + dueHTML(p) +
      (pg.all ? progHTML(pg) : '<div class="ppempty">No tasks yet</div>') +
      '<div class="ppfoot"><span>' + (pg.back ? pg.back + ' in backlog · ' : '') + 'Active ' + ago(p.last_at || p.created_at) + '</span><span class="sp"></span></div>' +
      (linkChips(p) ? '<div>' + linkChips(p) + '</div>' : '');
    if (moveId === p.id) {
      h += '<div class="ppmvl">';
      for (var i = 0; i < STAT.length; i++) if (STAT[i] !== statusOf(p)) h += '<button class="chip" data-pp="stat" data-id="' + esc(p.id) + '" data-val="' + STAT[i] + '">' + LABEL[STAT[i]] + '</button>';
      h += '<button class="chip" data-pp="mvx">Cancel</button></div>';
    } else h += '<button class="ppmv" data-pp="mv" data-id="' + esc(p.id) + '">Move to…</button>';
    return h + '</div>';
  }
  function byPos(a, b) { // hand-made order (pos); new projects without one yet go first
    var x = typeof a.pos === 'number' ? a.pos : -1e9, y = typeof b.pos === 'number' ? b.pos : -1e9;
    if (x !== y) return x - y;
    return App.parseTS(b.created_at) - App.parseTS(a.created_at);
  }
  function lanes() {
    var by = {}, i;
    for (i = 0; i < STAT.length; i++) by[STAT[i]] = [];
    for (i = 0; i < list.length; i++) (by[statusOf(list[i])] || by.in_progress).push(list[i]);
    for (i = 0; i < STAT.length; i++) by[STAT[i]].sort(byPos);
    return by;
  }
  function boardPage() {
    var h = '<div class="pptools"><form class="ppadd" id="ppNewForm" autocomplete="off"><input id="ppNew" type="text" maxlength="60" placeholder="New project, e.g. Holmlodge Hub" autocorrect="off" autocapitalize="words">' +
      '<button type="submit"' + (busy ? ' disabled' : '') + '>Add</button></form></div>';
    if (!known) return h + '<div class="ppsum">' + (failed ? 'Could not load your projects. Check your connection.' : 'Loading…') + '</div>';
    var i, s, anyV = false;
    var by = lanes(), warn = 0;
    for (i = 0; i < list.length; i++) { if (list[i].meta && list[i].meta.vercel) anyV = true; if (stillLive(list[i])) warn++; }
    var sum = (by.idea.length ? by.idea.length + (by.idea.length === 1 ? ' idea · ' : ' ideas · ') : '') + by.in_progress.length + ' in progress · ' + by.live.length + ' live · ' + by.paused.length + ' paused';
    if (warn) sum += ' · ' + warn + ' still live on Vercel';
    if (anyV && dep.configured === false) sum += ' · add a VERCEL_TOKEN to show live deploy status';
    else if (anyV && dep.at) sum += ' · deploy status checked ' + ago(new Date(dep.at).toISOString());
    h += '<div class="ppsum">' + sum + '. Tap a card to open it; drag ☰ to change the order.</div>';
    if (!list.length) return h + '<p class="empty">No projects yet. Add your first one above.</p>';
    h += '<div class="bdcols">';
    for (i = 0; i < STAT.length; i++) {
      s = STAT[i];
      if (s === 'idea' && !by.idea.length) continue; // the Idea lane only shows when it holds a project
      var f = !!fold[s];
      h += '<section class="bdcol' + (f ? ' ppcolf' : '') + (NOTLIVE[s] ? ' hold' : '') + '">' +
        '<button class="bdhead" data-pp="fold" data-val="' + s + '" aria-expanded="' + (f ? 'false' : 'true') + '"><span class="bdname">' + LABEL[s] + '</span><span class="bdn">' + by[s].length + '</span><span class="bdcaret">' + (f ? '▸' : '▾') + '</span></button>';
      if (!f) {
        h += '<div class="pplane" data-lane="' + s + '">';
        if (!by[s].length) h += '<div class="bdempty">' + (s === 'in_progress' ? 'Nothing in progress.' : s === 'live' ? 'Nothing live yet.' : 'None.') + '</div>';
        for (var j = 0; j < by[s].length; j++) h += cardHTML(by[s][j], by[s].length > 1);
        h += '</div>';
      }
      h += '</section>';
    }
    return h + '</div>';
  }
  function startDraft(p) {
    var m = p.meta || {}, ls = linksOf(m), i;
    draft = { desc: m.desc || '', sites: sitesOf(m).slice(0), links: [], vercel: m.vercel || '', supabase: m.supabase || '', github: m.github || '', started: m.started || '', target: m.target || '' };
    for (i = 0; i < ls.length; i++) draft.links.push({ l: ls[i].l || '', u: ls[i].u || '' });
    if (!draft.sites.length) draft.sites.push('');
    if (!draft.links.length) draft.links.push({ l: '', u: '' });
    draft.vsites = {}; draft.vgh = ''; // websites / GitHub link that came from the Vercel picker (replaced when the pick changes)
    if (vlist.configured !== false && !vlist.at) loadVercelList();
    var pv = /^https:\/\/vercel\.com\/([^\/?#]+)\/([^\/?#]+)/i.exec(draft.vercel);
    if (pv && vlist.configured !== false) { // already linked: find out which of the saved websites are that project's domains
      var dr = draft, seq = ++vseq;
      App.api('GET', '?vercel=' + encodeURIComponent(pv[1]) + '/' + encodeURIComponent(pv[2]), null, function (s, d) {
        if (draft !== dr || seq !== vseq || s !== 200 || !d) return;
        var j, ours = {};
        for (j = 0; j < (d.sites || []).length; j++) ours[normU(d.sites[j])] = 1;
        for (j = 0; j < dr.sites.length; j++) if (dr.sites[j] && ours[normU(dr.sites[j])]) dr.vsites[normU(dr.sites[j])] = 1;
        if (d.github && normU(dr.github) === normU(d.github)) dr.vgh = dr.github;
      }, '/api/pprojects');
    }
  }
  function normU(u) { return (u || '').replace(/^\s+|\s+$/g, '').replace(/\/+$/, '').toLowerCase(); }
  function loadVercelList() {
    if (vlist.loading) return;
    vlist.loading = true;
    App.api('GET', '?vercel=1', null, function (s, d) {
      vlist.loading = false; vlist.at = Date.now();
      if (s === 200 && d) { vlist.configured = !!d.configured; vlist.projects = d.projects || []; }
      if (editing) paint();
    }, '/api/pprojects');
  }
  function inp(f, val, type, ph, extra) {
    return '<input class="setinput' + (extra || '') + '" data-f="' + f + '" type="' + type + '" value="' + esc(val || '') + '" placeholder="' + esc(ph) + '" autocorrect="off" autocapitalize="off" spellcheck="false">';
  }
  function editForm(p) {
    var d = draft, h = '<form class="ppform" id="ppDetForm" autocomplete="off">', i, cur = '';
    var pv = /^https:\/\/vercel\.com\/([^\/?#]+)\/([^\/?#]+)/i.exec(d.vercel || '');
    if (pv) cur = pv[1] + '/' + pv[2];
    h += '<div class="frow2"><label>One-line description</label>' + inp('desc', d.desc, 'text', 'What is it?') + '</div>';
    h += '<div class="frow2"><label>Vercel project</label>';
    if (vlist.configured === false) h += inp('vercel', d.vercel, 'url', 'https://vercel.com/teamevo/my-app') + '<div class="pphint">Add VERCEL_TOKEN to pick from a list.</div>';
    else {
      h += '<select class="setinput" id="ppVsel"><option value="">' + (vlist.loading && !vlist.at ? 'Loading your Vercel projects…' : 'None') + '</option>';
      var found = false;
      for (i = 0; i < vlist.projects.length; i++) {
        var key = vlist.projects[i].team + '/' + vlist.projects[i].name, on = key.toLowerCase() === cur.toLowerCase();
        if (on) found = true;
        h += '<option value="' + esc(key) + '"' + (on ? ' selected' : '') + '>' + esc(vlist.projects[i].name) + (vlist.projects[i].paused ? ' (paused)' : '') + '</option>';
      }
      if (cur && !found) h += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
      h += '</select>';
      h += '<div class="pphint">' + (vfill ? 'Filling in from Vercel…' : 'Picking a project fills in its websites and GitHub repo.') + '</div>';
    }
    h += '</div>';
    h += '<div class="frow2"><label>Websites</label>';
    for (i = 0; i < d.sites.length; i++) h += '<div class="pplrow">' + inp('site:' + i, d.sites[i], 'url', 'https://my-app.vercel.app') + '<button class="rm" type="button" data-pp="rmsite" data-val="' + i + '" aria-label="Remove website">×</button></div>';
    h += '<button class="addl" type="button" data-pp="addsite">+ Add website</button></div>';
    h += '<div class="frow2"><label>Supabase project</label>' + inp('supabase', d.supabase, 'url', 'https://supabase.com/dashboard/project/…') + '</div>';
    h += '<div class="frow2"><label>GitHub repo</label>' + inp('github', d.github, 'url', 'https://github.com/Levo54321/…') + '</div>';
    h += '<div class="frow2"><label>Other links (Claude projects, sessions, docs…)</label>';
    for (i = 0; i < d.links.length; i++) h += '<div class="pplrow">' + inp('ll:' + i, d.links[i].l, 'text', 'Label', ' lb') + inp('lu:' + i, d.links[i].u, 'url', 'https://claude.ai/project/…') +
      '<button class="rm" type="button" data-pp="rmlink" data-val="' + i + '" aria-label="Remove link">×</button></div>';
    h += '<button class="addl" type="button" data-pp="addlink">+ Add link</button></div>';
    h += '<div class="frow2"><label>Started</label>' + inp('started', d.started, 'date', '') + '</div>';
    h += '<div class="frow2"><label>Target date</label>' + inp('target', d.target, 'date', '') + '</div>';
    h += '<div class="pphint">Leave anything blank to hide it. Links must start with https.</div>' +
      '<button class="btn primary" type="submit"' + (busy ? ' disabled' : '') + '>Save details</button><button class="btn" type="button" data-pp="detx">Cancel</button></form>';
    return h;
  }
  function fillFromVercel(key) { // replace the websites / GitHub link the picker filled in before; keep what was typed by hand
    if (!draft) return;
    var dr = draft, seq = ++vseq;
    function swap(sites, gh) {
      var keep = [], i, have = {}, added = 0;
      for (i = 0; i < dr.sites.length; i++) if (dr.sites[i] && !dr.vsites[normU(dr.sites[i])]) { keep.push(dr.sites[i]); have[normU(dr.sites[i])] = 1; }
      dr.vsites = {};
      for (i = 0; i < sites.length; i++) if (!have[normU(sites[i])] && keep.length < 8) { keep.push(sites[i]); have[normU(sites[i])] = 1; dr.vsites[normU(sites[i])] = 1; added++; }
      dr.sites = keep.length ? keep : [''];
      var ghMine = !dr.github || (dr.vgh && normU(dr.github) === normU(dr.vgh)); // empty, or still what the picker put there
      if (ghMine) { dr.github = gh || ''; dr.vgh = gh || ''; if (gh) added++; }
      return added;
    }
    if (!key) { dr.vercel = ''; swap([], ''); paint(); return; }
    var m = /^([^\/]+)\/(.+)$/.exec(key); if (!m) return;
    dr.vercel = 'https://vercel.com/' + m[1] + '/' + m[2];
    vfill = true; paint();
    App.api('GET', '?vercel=' + encodeURIComponent(m[1]) + '/' + encodeURIComponent(m[2]), null, function (s, d) {
      if (seq !== vseq) return; // a newer pick is on its way
      vfill = false;
      if (draft !== dr) return;
      if (s === 200 && d) {
        if (d.vercel) dr.vercel = d.vercel;
        App.toast(swap(d.sites || [], d.github || '') ? 'Filled in from Vercel' : 'Nothing new to fill in');
      } else App.toast(d && d.error ? d.error : 'Could not reach Vercel');
      paint();
    }, '/api/pprojects');
  }
  function sideHTML(p, pg) {
    var m = p.meta || {}, h = '', i, d = depOf(p);
    if (editId === p.id) h += '<ul class="plist"><li class="prow editing"><input class="setinput" id="ppEdit" type="text" maxlength="60" autocomplete="off" autocorrect="off" value="' + esc(p.name) + '">' +
      '<button class="btn sm primary" data-pp="save" data-id="' + esc(p.id) + '">Save</button><button class="btn sm" data-pp="cancel">Cancel</button></li></ul>';
    else h += '<div class="pphd">' + logoHTML(p, true) + '<div class="ppnm"><b>' + esc(p.name) + '</b>' + (m.desc ? '<div class="ppdesc" style="-webkit-line-clamp:4">' + esc(m.desc) + '</div>' : '') + '</div>' +
      '<button class="pbtn" data-pp="edit" data-id="' + esc(p.id) + '" aria-label="Rename project">✎</button></div>';
    if (editing) return h + editForm(p);
    var so = statusOf(p);
    h += '<div class="ppsec"><div class="lbl">Status</div>' + warnHTML(p);
    for (i = 0; i < STAT.length; i++) h += '<button class="chip' + (so === STAT[i] ? ' on' : '') + '" data-pp="stat" data-id="' + esc(p.id) + '" data-val="' + STAT[i] + '">' + LABEL[STAT[i]] + '</button>';
    if (so === 'idea') h += '<div class="pphint">Idea: not started yet. Its tasks stay out of Overdue and your counts, and new ones go to the Backlog.</div>';
    else if (SHELF[so]) h += '<div class="pphint">Its tasks are out of Overdue and your counts while it is ' + LABEL[so].toLowerCase() + '.</div>';
    else if (so === 'live') h += '<div class="pphint">Live: tasks you add still show up as normal.</div>';
    if (REASON[so]) {
      if (reasonId === p.id) h += '<div class="lbl" style="margin-top:12px">Reason</div><textarea id="ppReason" maxlength="300" placeholder="Why is it ' + LABEL[so].toLowerCase() + '? What is needed or planned to move it on?">' + esc(reasonDraft) + '</textarea>' +
        '<div class="rbtns"><button class="btn primary" data-pp="rsave" data-id="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + '>Save reason</button><button class="btn" data-pp="rx">Cancel</button></div>';
      else if (m.reason) h += '<div class="ppreason"><b>Why:</b> ' + esc(m.reason) + '</div><button class="pplk rs" data-pp="redit" data-id="' + esc(p.id) + '">Edit reason</button>';
      else h += '<button class="pplk rs" data-pp="redit" data-id="' + esc(p.id) + '">+ Add a reason</button>';
    }
    h += '</div>';
    h += '<div class="ppsec"><div class="lbl">Progress</div>' + (pg.all ? progHTML(pg, true) : '<div class="pphint">No tasks yet.</div>') +
      '<div class="pphint">' + pg.open + ' open (' + pg.back + ' in backlog) · last activity ' + ago(p.last_at || p.created_at) + '</div></div>';
    if (m.vercel) {
      h += '<div class="ppsec"><div class="lbl">Deploy</div>';
      if (dep.configured === false) h += '<div class="pphint">Add a VERCEL_TOKEN to luc-todo to see live status here.</div>';
      else if (!d) h += '<div class="pphint">' + (dep.loading ? 'Checking…' : 'Not checked yet.') + '</div>';
      else h += '<div class="ppline"><span class="ppdot ' + esc(d.color || 'grey') + '"></span>' + esc(DOT[d.color] || DOT.grey) +
        (d.state && d.state !== 'UNKNOWN' ? ' · ' + esc(d.state.toLowerCase()) : '') + (d.at ? ' · ' + ago(new Date(d.at).toISOString()) : '') + (d.error ? ' · ' + esc(d.error) : '') + '</div>';
      h += '</div>';
    }
    var lk = '', al = allLinks(p);
    for (i = 0; i < al.length; i++) lk += '<a class="pplinkrow" href="' + esc(al[i][1]) + '" target="_blank" rel="noopener"><span>' + esc(al[i][0]) + ' ↗</span><small>' + esc(al[i][2]) + '</small></a>';
    if (lk) h += '<div class="ppsec"><div class="lbl">Links</div>' + lk + '</div>';
    h += costsHTML(p);
    if (m.started || m.target) h += '<div class="ppsec"><div class="lbl">Dates</div><div class="ppline">' +
      (m.started ? 'Started ' + fmtD(m.started) : '') + (m.started && m.target ? ' · ' : '') + (m.target ? 'Target ' + fmtD(m.target) : '') + '</div></div>';
    return h;
  }
  function evText(e) {
    var t = e.t ? esc(e.t) : '';
    switch (e.k) {
      case 'created': return 'Project created';
      case 'status': return 'Status: ' + t;
      case 'renamed': return 'Renamed: ' + t;
      case 'details': return 'Details updated';
      case 'reason': return t ? 'Reason: ' + t : 'Reason cleared';
      case 'cost_added': return 'Cost added: ' + t;
      case 'cost_changed': return 'Cost changed: ' + t;
      case 'cost_removed': return 'Cost removed: ' + t;
      case 'task_added': return 'Added <b>' + t + '</b>';
      case 'task_done': return 'Done <b>' + t + '</b>';
      case 'task_reopened': return 'Reopened <b>' + t + '</b>';
      case 'to_list': return 'Moved to your list: <b>' + t + '</b>';
      case 'to_backlog': return 'Back to backlog: <b>' + t + '</b>';
      default: return t || esc(e.k);
    }
  }
  function detailPage(p) {
    var t = tasksOf(p.id), pg = progress(p), h, i, ev = events[p.id];
    h = '<div class="pptop"><button class="btn ppback" data-pp="back">‹ All projects</button><span class="sp"></span>' +
      (editing ? '' : '<button class="btn" data-pp="det">Edit details</button>') + '</div>';
    h += '<div class="ppwrap"><aside class="ppside">' + sideHTML(p, pg) + '</aside><div class="ppmain">';
    h += '<div class="ppaddrow"><form class="ppadd" id="ppTaskForm" autocomplete="off"><input id="ppTask" type="text" maxlength="500" placeholder="Add an idea or task…" autocorrect="off" autocapitalize="sentences">' +
      '<button type="submit">Add</button></form>' +
      '<span class="sg sm"><button class="' + (addTo === 'backlog' ? 'on' : '') + '" data-pp="to" data-val="backlog">Backlog</button><button class="' + (addTo === 'list' ? 'on' : '') + '" data-pp="to" data-val="list">My list</button></span></div>' +
      '<div class="pphint">' + (addTo === 'backlog' ? 'New items go to the Backlog: they stay here and out of your Personal list.' : 'New items also appear in your Personal list.') + '</div>';
    h += '<h2>In my list<span class="count">' + t.mine.length + '</span></h2>';
    h += t.mine.length ? App.listHTML(t.mine) : '<p class="empty">Nothing from this project in your Personal list.</p>';
    h += '<h2>Backlog<span class="count">' + t.back.length + '</span></h2>';
    h += t.back.length ? App.listHTML(t.back) : '<p class="empty">No ideas parked here yet.</p>';
    if (t.done.length) {
      h += '<button class="donebtn" data-pp="done">' + (showDone ? '▾' : '▸') + ' Done this week (' + t.done.length + ')</button>';
      if (showDone) h += App.listHTML(t.done);
    }
    if (p.done_old) h += '<div class="pphint">Plus ' + p.done_old + ' finished earlier.</div>';
    h += '<button class="ppacth" data-pp="act" aria-expanded="' + (showAct ? 'true' : 'false') + '">' + (showAct ? '▾' : '▸') + ' Activity' + (ev ? '<small>' + ev.length + (ev.length >= 40 ? '+' : '') + ' entries' + (ev.length ? ' · latest ' + ago(ev[0].at) : '') + '</small>' : '') + '</button>';
    if (!showAct) {}
    else if (!ev) h += '<div class="pphint">Loading…</div>';
    else if (!ev.length) h += '<div class="pphint">Nothing yet.</div>';
    else {
      h += '<ul class="ppev">';
      for (i = 0; i < ev.length && i < 30; i++) h += '<li><span>' + evText(ev[i]) + '</span><small>' + ago(ev[i].at) + '</small></li>';
      h += '</ul>';
    }
    return h + '</div></div>';
  }
  function watchEvents(p) { // refetch the activity log shortly after this project's tasks change
    var t = tasksOf(p.id), all = t.mine.concat(t.back, t.done), sig = '', i;
    for (i = 0; i < all.length; i++) sig += all[i].id + (all[i].done ? 'd' : '') + (all[i].pp_backlog ? 'b' : '') + ',';
    if (evSig[p.id] === undefined) { evSig[p.id] = sig; return; }
    if (evSig[p.id] === sig) return;
    evSig[p.id] = sig; touch(p);
    if (evTimer) clearTimeout(evTimer);
    evTimer = setTimeout(function () { evTimer = null; loadEvents(p.id); }, 1500);
  }
  /* ---------- fixed-height layout (wider than 760px) ---------- */
  var boardScroll = null, pageScroll = null, lt = null;
  function fixedMode() { return !(window.matchMedia && window.matchMedia('(max-width:760px)').matches); }
  // Every write below is skipped when the value is already right: on iOS 9 writing a height or scrollTop on a
  // touch-scrolling area repaints it (visible flicker), and the background refresh redraws every 15 seconds.
  function setH(el, px) { if (!el) return; var v = px === '' ? '' : Math.round(Math.max(px, 60)) + 'px'; if (el.style.height !== v) el.style.height = v; }
  function setTop(el, v) { if (el && el.scrollTop !== v) el.scrollTop = v; }
  function layout() { // size the scroll areas from the real window height
    var v = $('vPprojects'), pane = $('ppPane'); if (!v || !pane || !onView) return;
    var fix = fixedMode(), on = /(^|\s)ppfix(\s|$)/.test(v.className), cols = pane.querySelector('.bdcols'), wrap = pane.querySelector('.ppwrap'), i, ls, cs;
    if (fix !== on) v.className = fix ? v.className + ' ppfix' : v.className.replace(/\s*ppfix/g, '');
    if (!fix) { // phone: the page scrolls as usual
      if (cols) { cs = cols.querySelectorAll('.bdcol, .pplane'); for (i = 0; i < cs.length; i++) setH(cs[i], ''); setH(cols, ''); }
      if (wrap) { setH(wrap, ''); setH(pane.querySelector('.ppside'), ''); setH(pane.querySelector('.ppmain'), ''); }
      return;
    }
    setTop(pane.parentNode, 0);
    var H = window.innerHeight || document.documentElement.clientHeight, GAP = 10;
    if (cols) {
      setH(cols, H - cols.getBoundingClientRect().top - GAP);
      var inner = cols.clientHeight - 14; // .bdcols padding: 2px top, 12px bottom
      cs = cols.querySelectorAll('.bdcol');
      for (i = 0; i < cs.length; i++) setH(cs[i], /ppcolf/.test(cs[i].className) ? '' : inner);
      ls = cols.querySelectorAll('.pplane');
      for (i = 0; i < ls.length; i++) { // lane body = from its top to the lane's bottom padding (12px) and border (1px)
        var col = ls[i].parentNode;
        setH(ls[i], col.getBoundingClientRect().bottom - 13 - ls[i].getBoundingClientRect().top);
      }
    }
    if (wrap) {
      var wh = H - wrap.getBoundingClientRect().top - GAP;
      setH(wrap, wh); setH(pane.querySelector('.ppside'), wh); setH(pane.querySelector('.ppmain'), wh);
    }
  }
  function grabScroll() { // remember where each scroll area is before the pane is redrawn
    var pane = $('ppPane'); if (!pane) return;
    var cols = pane.querySelector('.bdcols'), main = pane.querySelector('.ppmain'), side = pane.querySelector('.ppside'), ls, i;
    if (cols) {
      boardScroll = { left: cols.scrollLeft, lanes: {} };
      ls = cols.querySelectorAll('.pplane');
      for (i = 0; i < ls.length; i++) boardScroll.lanes[ls[i].getAttribute('data-lane')] = ls[i].scrollTop;
    }
    if (main && side && pane.getAttribute('data-sel')) pageScroll = { id: pane.getAttribute('data-sel'), main: main.scrollTop, side: side.scrollTop };
  }
  function putScroll() {
    var pane = $('ppPane'); if (!pane || !fixedMode()) return;
    var cols = pane.querySelector('.bdcols'), main = pane.querySelector('.ppmain'), side = pane.querySelector('.ppside'), ls, i, k;
    if (cols && boardScroll) {
      if (cols.scrollLeft !== boardScroll.left) cols.scrollLeft = boardScroll.left;
      ls = cols.querySelectorAll('.pplane');
      for (i = 0; i < ls.length; i++) { k = ls[i].getAttribute('data-lane'); if (boardScroll.lanes.hasOwnProperty(k)) setTop(ls[i], boardScroll.lanes[k]); }
    }
    if (main && side && pageScroll && pageScroll.id === sel) { setTop(main, pageScroll.main); setTop(side, pageScroll.side); }
  }
  function relayout() { if (lt) clearTimeout(lt); lt = setTimeout(function () { lt = null; grabScroll(); layout(); putScroll(); }, 120); }
  window.addEventListener('resize', relayout, false);
  window.addEventListener('orientationchange', function () { relayout(); setTimeout(relayout, 500); }, false); // iOS 9 reports the new height late
  window.addEventListener('load', relayout, false);

  function paint() {
    if (!onView || drag) return; // never redraw under a finger that is dragging a card
    var p = sel ? byId(sel) : null;
    if (sel && known && !p) { sel = ''; setStore('ppSel', ''); }
    App.setHTML($('viewTitle'), p ? 'My projects<small>' + esc(p.name) + '</small>' : 'My projects');
    var keep = {}, ids = ['ppNew', 'ppTask', 'ppEdit'], i;
    for (i = 0; i < ids.length; i++) if ($(ids[i])) keep[ids[i]] = $(ids[i]).value;
    var ae = document.activeElement, focusId = ae && ae.id ? ae.id : '', focusF = ae && ae.getAttribute ? ae.getAttribute('data-f') : null, s0 = null, s1 = null;
    try { if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) { s0 = ae.selectionStart; s1 = ae.selectionEnd; } } catch (e) {} // date inputs throw
    if (p) watchEvents(p);
    grabScroll();
    var pane = $('ppPane'), sid = p ? p.id : '';
    if (pane.getAttribute('data-sel') !== sid) pane.setAttribute('data-sel', sid);
    var changed = App.setHTML(pane, p ? detailPage(p) : boardPage());
    layout(); // writes nothing when the sizes are already right
    if (!changed) return; // nothing new to show: leave the fields, focus and scroll exactly as they are
    putScroll();
    for (i = 0; i < ids.length; i++) if ($(ids[i]) && keep[ids[i]] !== undefined && $(ids[i]).value !== keep[ids[i]]) $(ids[i]).value = keep[ids[i]];
    var fe = focusId && /^pp/.test(focusId) ? $(focusId) : (focusF ? pane.querySelector('[data-f="' + focusF + '"]') : null);
    if (fe && fe !== ae) { // the field was redrawn: focus it again and put the cursor back where it was
      fe.focus();
      if (s0 !== null) try { fe.setSelectionRange(s0, s1); } catch (e2) {}
    }
  }

  /* ---------- actions ---------- */
  function errText(s, d) { return (s === 409 || s === 400) && d && d.error ? d.error.charAt(0).toUpperCase() + d.error.slice(1) : 'Could not save, try again'; }
  function create(name) {
    name = (name || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!name) { App.toast('Give the project a name'); return; }
    if (busy) return; busy = true; paint();
    App.api('POST', '', { name: name }, function (s, d) {
      busy = false;
      if ((s === 201 || s === 200) && d && d.project) {
        d.project.open = 0; d.project.done = 0; d.project.done_old = 0; d.project.meta = d.project.meta || {}; d.project.last_at = d.project.created_at;
        if (typeof d.project.pos !== 'number') { var mn = 1; for (var k = 0; k < list.length; k++) if (typeof list[k].pos === 'number' && list[k].pos < mn) mn = list[k].pos; d.project.pos = mn - 1; } // new projects go first
        list.push(d.project); App.setPProjects(list);
        if ($('ppNew')) $('ppNew').value = '';
      } else App.toast(errText(s, d));
      paint();
    }, '/api/pprojects');
  }
  function patch(id, body, undo, done) {
    App.api('PATCH', '?id=' + encodeURIComponent(id), body, function (s, d) {
      var p = byId(id);
      if (s === 200 && d && d.project) { if (p) { p.name = d.project.name; p.status = d.project.status; if (d.project.meta) p.meta = d.project.meta; touch(p); } if (done) done(true); }
      else { if (p && undo) undo(p); App.toast(errText(s, d)); if (done) done(false); }
      App.setPProjects(list); paint();
      if (sel === id) loadEvents(id);
    }, '/api/pprojects');
  }
  function setStatus(id, v) {
    var p = byId(id); if (!p || p.status === v || STAT.indexOf(v) < 0) return;
    var was = p.status; p.status = v; moveId = '';
    if (sel === id && REASON[v] && !(p.meta && p.meta.reason)) { reasonId = id; reasonDraft = ''; } // prompt for the why on the project page
    else if (!REASON[v]) reasonId = '';
    App.setPProjects(list); paint();
    patch(id, { status: v }, function (q) { q.status = was; });
  }
  function rename(id) {
    var p = byId(id), el = $('ppEdit'); if (!p || !el) return;
    var v = el.value.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!v) { App.toast('Give the project a name'); return; }
    editId = '';
    if (v === p.name) { paint(); return; }
    var was = p.name; p.name = v; App.setPProjects(list); paint();
    patch(id, { name: v }, function (q) { q.name = was; });
  }
  function saveDetails() {
    var p = byId(sel); if (!p || busy || !draft) return;
    var d = draft, m = {}, i, t = function (v) { return (v || '').replace(/^\s+|\s+$/g, ''); };
    ['desc', 'vercel', 'supabase', 'github', 'started', 'target'].forEach(function (k) { if (t(d[k])) m[k] = t(d[k]); });
    m.sites = []; m.links = [];
    for (i = 0; i < d.sites.length; i++) if (t(d.sites[i])) m.sites.push(t(d.sites[i]));
    for (i = 0; i < d.links.length; i++) if (t(d.links[i].u)) m.links.push({ l: t(d.links[i].l), u: t(d.links[i].u) });
    if (m.started && m.target && m.target < m.started) { App.toast('The target date is before the start'); return; }
    busy = true; paint();
    patch(p.id, { meta: m }, null, function (ok) {
      busy = false;
      if (ok) { editing = false; draft = null; dep.at = 0; loadDeploy(true); App.toast('Details saved'); }
      paint();
    });
  }
  function saveReason(id) {
    var p = byId(id); if (!p || busy) return;
    var v = reasonDraft.replace(/^\s+|\s+$/g, '').slice(0, 300), m = {}, k, om = p.meta || {};
    if ((om.reason || '') === v) { reasonId = ''; paint(); return; }
    for (k in om) if (om.hasOwnProperty(k) && k !== 'reason') m[k] = om[k];
    if (v) m.reason = v;
    busy = true; paint();
    patch(id, { meta: m }, null, function (ok) {
      busy = false;
      if (ok) { reasonId = ''; App.toast(v ? 'Reason saved' : 'Reason cleared'); }
      paint();
    });
  }
  function reorder(ids) { // optimistic: the lane's projects swap among the positions they hold, then the server agrees
    var ps = [], poss = [], was = {}, i, p;
    for (i = 0; i < ids.length; i++) { p = byId(ids[i]); if (!p) return; ps.push(p); poss.push(typeof p.pos === 'number' ? p.pos : 0); was[p.id] = p.pos; }
    poss.sort(function (a, b) { return a - b; });
    for (i = 0; i < ps.length; i++) ps[i].pos = poss[i];
    paint();
    App.api('PATCH', '?order=1', { ids: ids }, function (s, d) {
      var k, q;
      if (s === 200 && d && d.pos) { for (k in d.pos) if (d.pos.hasOwnProperty(k) && (q = byId(k))) q.pos = d.pos[k]; }
      else { for (k in was) if (was.hasOwnProperty(k) && (q = byId(k))) q.pos = was[k]; App.toast('Could not save the new order'); }
      paint();
    }, '/api/pprojects');
  }
  function addTask(title) {
    var p = byId(sel); title = (title || '').replace(/^\s+|\s+$/g, '');
    if (!p || !title) return;
    if ($('ppTask')) $('ppTask').value = '';
    var bl = addTo === 'backlog';
    App.api('POST', '', { title: title, list: 'personal', pproject_id: p.id, pp_backlog: bl }, function (s, d) {
      if ((s === 201 || s === 200) && d && d.todo) {
        App.todos().push(d.todo); App.mutated(); App.render();
        if (d.todo.pproject_id !== p.id) App.toast('Added, but not linked to the project. Try again from the task editor.');
      } else { App.toast('Could not add, try again'); if ($('ppTask') && !$('ppTask').value) $('ppTask').value = title; }
    }, '/api/todos');
  }
  function openProject(id) {
    sel = id; editId = ''; editing = false; draft = null; showDone = false; moveId = ''; reasonId = ''; costEdit = ''; costDraft = null; setStore('ppSel', id);
    var op = byId(id); if (op && statusOf(op) === 'idea') addTo = 'backlog'; // ideas: new tasks default to the Backlog
    pageScroll = null; paint(); window.scrollTo(0, 0); loadEvents(id);
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-pp'))) {
      if (el.tagName === 'A' || (el.getAttribute && el.getAttribute('data-act'))) return; // links open normally; task rows belong to core
      el = el.parentNode;
    }
    if (!el || el === document) return;
    var a = el.getAttribute('data-pp'), id = el.getAttribute('data-id'), v = el.getAttribute('data-val');
    e.preventDefault();
    if (a === 'open') openProject(id);
    else if (a === 'back') { sel = ''; editId = ''; editing = false; draft = null; setStore('ppSel', ''); paint(); window.scrollTo(0, 0); }
    else if (a === 'stat') setStatus(id, v);
    else if (a === 'mv') { moveId = id; paint(); }
    else if (a === 'mvx') { moveId = ''; paint(); }
    else if (a === 'fold') { fold[v] = !fold[v]; store.set('ppFold', JSON.stringify(fold)); paint(); }
    else if (a === 'edit') { editId = id; editing = false; paint(); if ($('ppEdit')) $('ppEdit').focus(); }
    else if (a === 'cancel') { editId = ''; paint(); }
    else if (a === 'save') rename(id);
    else if (a === 'det') { var dp = byId(sel); if (!dp) return; startDraft(dp); editing = true; editId = ''; paint(); window.scrollTo(0, 0); var sd = $('ppPane').querySelector('.ppside'); if (sd) sd.scrollTop = 0; }
    else if (a === 'detx') { editing = false; draft = null; paint(); }
    else if (a === 'addsite' && draft) { if (draft.sites.length < 8) draft.sites.push(''); paint(); }
    else if (a === 'rmsite' && draft) { draft.sites.splice(+v, 1); if (!draft.sites.length) draft.sites.push(''); paint(); }
    else if (a === 'addlink' && draft) { if (draft.links.length < 12) draft.links.push({ l: '', u: '' }); paint(); }
    else if (a === 'rmlink' && draft) { draft.links.splice(+v, 1); if (!draft.links.length) draft.links.push({ l: '', u: '' }); paint(); }
    else if (a === 'act') { showAct = !showAct; store.set('ppAct', showAct ? '1' : '0'); paint(); }
    else if (a === 'to') { addTo = v === 'list' ? 'list' : 'backlog'; store.set('ppAddTo', addTo); paint(); }
    else if (a === 'done') { showDone = !showDone; paint(); }
    else if (a === 'redit') { var rp = byId(id); reasonId = id; reasonDraft = (rp && rp.meta && rp.meta.reason) || ''; paint(); if ($('ppReason')) $('ppReason').focus(); }
    else if (a === 'rx') { reasonId = ''; paint(); }
    else if (a === 'rsave') saveReason(id);
    else if (a === 'cadd') { startCost(null); paint(); if ($('ppCname')) $('ppCname').focus(); }
    else if (a === 'cedit') { var cp = byId(sel), ci; if (cp) for (ci = 0; ci < (cp.costs || []).length; ci++) if (cp.costs[ci].id === id) startCost(cp.costs[ci]); paint(); }
    else if (a === 'cx') { costEdit = ''; costDraft = null; paint(); }
    else if (a === 'cfreq' && costDraft) { costDraft.freq = v; paint(); }
    else if (a === 'cdel') deleteCost(id);
  }, false);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f) return;
    if (f.id === 'ppNewForm') { e.preventDefault(); create($('ppNew').value); }
    else if (f.id === 'ppTaskForm') { e.preventDefault(); addTask($('ppTask').value); }
    else if (f.id === 'ppDetForm') { e.preventDefault(); saveDetails(); }
    else if (f.id === 'ppCostForm') { e.preventDefault(); saveCost(); }
  }, false);
  function onField(e) { // keep the details draft in step with what is typed (the form is redrawn from it)
    var el = e.target, f = el && el.getAttribute ? el.getAttribute('data-f') : null, m;
    if (el && el.id === 'ppReason') { reasonDraft = el.value; return; }
    if (el && costDraft && CF[el.id]) { costDraft[CF[el.id]] = el.value; return; }
    if (!f || !draft) return;
    if ((m = /^site:(\d+)$/.exec(f))) draft.sites[+m[1]] = el.value;
    else if ((m = /^ll:(\d+)$/.exec(f))) draft.links[+m[1]].l = el.value;
    else if ((m = /^lu:(\d+)$/.exec(f))) draft.links[+m[1]].u = el.value;
    else if (draft.hasOwnProperty(f)) draft[f] = el.value;
  }
  document.addEventListener('input', onField, false);
  document.addEventListener('change', function (e) {
    onField(e);
    if (e.target && e.target.id === 'ppVsel') fillFromVercel(e.target.value);
  }, false);
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.id === 'ppEdit' && (e.keyCode === 13 || e.keyCode === 27)) { e.preventDefault(); if (e.keyCode === 13) rename(editId); else { editId = ''; paint(); } }
  }, false);

  /* ---------- drag a card by its ☰ handle to reorder its lane (touch and mouse; no HTML5 drag-and-drop on iOS 9).
     Adapted from board.js. Wide screens scroll the lane itself; phones scroll the page. ---------- */
  function scrollerOf(lane) {
    if (fixedMode()) return lane;
    var sv = $('vPprojects') && $('vPprojects').querySelector('.scrollview');
    return sv && sv.scrollHeight > sv.clientHeight + 1 ? sv : null; // null = the window
  }
  function scTop(sc) { return sc ? sc.scrollTop : (window.pageYOffset || document.documentElement.scrollTop || 0); }
  function scBy(sc, dy) { if (sc) sc.scrollTop += dy; else window.scrollBy(0, dy); }
  function cardOf(el) { while (el && el.className !== undefined && !/(^| )ppcard( |$)/.test(el.className)) el = el.parentNode; return el && el.className !== undefined ? el : null; }
  function startDrag(grip, y) {
    var card = cardOf(grip), lane = card && card.parentNode, cs, from = -1, i;
    if (!lane || !lane.getAttribute('data-lane')) return false;
    cs = lane.querySelectorAll('.ppcard');
    for (i = 0; i < cs.length; i++) if (cs[i] === card) from = i;
    if (from < 0 || cs.length < 2) return false;
    var sc = scrollerOf(lane);
    drag = { lane: lane, card: card, from: from, to: from, y0: y, sc: sc, s0: scTop(sc) };
    card.className += ' dragging'; card.style.position = 'relative'; card.style.zIndex = 5;
    return true;
  }
  function moveDrag(y) {
    var d = drag, cs = d.lane.querySelectorAll('.ppcard'), r = d.sc ? d.sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }, s = 0, i, b, tr;
    if (y < r.top + 50) scBy(d.sc, -12); else if (y > r.bottom - 50) scBy(d.sc, 12);
    tr = 'translateY(' + (y - d.y0 + (scTop(d.sc) - d.s0)) + 'px)';
    d.card.style.webkitTransform = tr; d.card.style.transform = tr;
    for (i = 0; i < cs.length; i++) {
      if (i === d.from) continue;
      b = cs[i].getBoundingClientRect();
      if (b.top + (b.bottom - b.top) / 2 < y) s++;
      cs[i].className = cs[i].className.replace(/ drop[ab]/g, '');
    }
    d.to = s;
    if (s !== d.from && cs[s]) cs[s].className += s < d.from ? ' dropb' : ' dropa';
  }
  function endDrag() {
    var d = drag; if (!d) return;
    var cs = d.lane.querySelectorAll('.ppcard'), ids = [], i;
    for (i = 0; i < cs.length; i++) { ids.push(cs[i].getAttribute('data-id')); cs[i].className = cs[i].className.replace(/ drop[ab]| dragging/g, ''); }
    d.card.style.webkitTransform = ''; d.card.style.transform = ''; d.card.style.position = ''; d.card.style.zIndex = '';
    drag = null;
    if (d.to !== d.from) { var mv = ids.splice(d.from, 1)[0]; ids.splice(d.to, 0, mv); reorder(ids); }
    else paint();
  }
  function gripOf(el, root) {
    while (el && el !== root) { if (el.getAttribute && el.getAttribute('data-pp') === 'grip') return el; el = el.parentNode; }
    return null;
  }
  (function wireDrag() {
    var pane = $('ppPane'); if (!pane) return;
    pane.addEventListener('touchstart', function (e) {
      var g = gripOf(e.target, pane);
      if (!g || drag || !e.touches || e.touches.length !== 1 || !startDrag(g, e.touches[0].clientY)) return;
      e.preventDefault();
      var mv = function (ev) { ev.preventDefault(); if (drag) moveDrag(ev.touches[0].clientY); };
      var up = function () { g.removeEventListener('touchmove', mv, false); g.removeEventListener('touchend', up, false); g.removeEventListener('touchcancel', up, false); endDrag(); };
      g.addEventListener('touchmove', mv, false); g.addEventListener('touchend', up, false); g.addEventListener('touchcancel', up, false);
    }, false);
    pane.addEventListener('mousedown', function (e) {
      var g = gripOf(e.target, pane);
      if (!g || drag || !startDrag(g, e.clientY)) return;
      e.preventDefault();
      var mv = function (ev) { if (drag) moveDrag(ev.clientY); };
      var up = function () { document.removeEventListener('mousemove', mv, false); document.removeEventListener('mouseup', up, false); endDrag(); };
      document.addEventListener('mousemove', mv, false); document.addEventListener('mouseup', up, false);
    }, false);
  })();

  App.register('pprojects', {
    title: 'My projects',
    render: function () { onView = true; paint(); },
    show: function () { onView = true; paint(); load(function () { paint(); loadDeploy(); }); if (sel) loadEvents(sel); }
  });
  // core only calls render() for the visible view; note when we leave it so background loads don't repaint
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
    if (el && el !== document && el.getAttribute('data-act') === 'nav' && el.getAttribute('data-view') !== 'pprojects') onView = false;
  }, true);
})();
