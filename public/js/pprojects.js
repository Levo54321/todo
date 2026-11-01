/* My projects: Personal Projects (apps, home projects ...). Separate from Work projects (projects.js / board.js).
   Board: one column per status (Active, Paused, Not pursued, Shut down), project cards with logo, live/deploy dot,
   labelled progress, last activity and links. Project page: details (links, description, dates), tasks split into
   "In my list" and "Backlog" (ideas kept out of the Personal list, todos.pp_backlog), done tasks and an activity log.
   Tasks in a project that is not Active are "shelved" by core.js (out of Overdue and the counts). ES5 only (iPad 2, iOS 9). */
(function () {
  'use strict';
  var App = window.App; if (!App) return;
  var $ = App.$, esc = App.esc, store = App.store;
  var STAT = ['in_progress', 'live', 'paused', 'not_pursued', 'shut_down'];
  var LABEL = { in_progress: 'In progress', live: 'Live', paused: 'Paused', not_pursued: 'Not pursued', shut_down: 'Shut down' };
  var SHELF = { paused: 1, not_pursued: 1, shut_down: 1 }; // tasks of these projects are out of Overdue and the counts
  var LINKS = [['vercel', 'Vercel'], ['supabase', 'Supabase'], ['github', 'GitHub']];
  var DOT = { green: 'Live', orange: 'Deploying', red: 'Deploy failed', paused: 'Paused in Vercel', grey: 'Status unknown' };
  var draft = null, vseq = 0, vlist = { configured: null, projects: [], loading: false, at: 0 }, vfill = false, showAct = store.get('ppAct') === '1';
  var list = [], known = false, failed = false, tries = 0, busy = false, onView = false;
  var sel = store.get('ppSel') || '', editId = '', moveId = '', editing = false, showDone = false;
  var addTo = store.get('ppAddTo') === 'list' ? 'list' : 'backlog';
  var fold = { paused: true, not_pursued: true, shut_down: true }; // In progress and Live open by default
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
        for (var i = 0; i < d.projects.length; i++) if (!d.projects[i].meta || typeof d.projects[i].meta !== 'object') d.projects[i].meta = {};
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
  function cardHTML(p) {
    var pg = progress(p), m = p.meta || {}, h;
    h = '<div class="ppcard' + (SHELF[statusOf(p)] ? ' off' : '') + '" data-pp="open" data-id="' + esc(p.id) + '">' +
      '<div class="pphd">' + logoHTML(p) + '<div class="ppnm"><b>' + esc(p.name) + '</b>' + (m.desc ? '<div class="ppdesc">' + esc(m.desc) + '</div>' : '') + '</div>' + dotHTML(p) + '</div>' +
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
  function boardPage() {
    var h = '<div class="pptools"><form class="ppadd" id="ppNewForm" autocomplete="off"><input id="ppNew" type="text" maxlength="60" placeholder="New project, e.g. Holmlodge Hub" autocorrect="off" autocapitalize="words">' +
      '<button type="submit"' + (busy ? ' disabled' : '') + '>Add</button></form></div>';
    if (!known) return h + '<div class="ppsum">' + (failed ? 'Could not load your projects. Check your connection.' : 'Loading…') + '</div>';
    var i, s, anyV = false;
    var by = { in_progress: [], live: [], paused: [], not_pursued: [], shut_down: [] };
    for (i = 0; i < list.length; i++) { (by[statusOf(list[i])] || by.in_progress).push(list[i]); if (list[i].meta && list[i].meta.vercel) anyV = true; }
    for (s in by) if (by.hasOwnProperty(s)) by[s].sort(function (a, b) { return App.parseTS(b.last_at || b.created_at) - App.parseTS(a.last_at || a.created_at); });
    var sum = by.in_progress.length + ' in progress · ' + by.live.length + ' live · ' + by.paused.length + ' paused';
    if (anyV && dep.configured === false) sum += ' · add a VERCEL_TOKEN to show live deploy status';
    else if (anyV && dep.at) sum += ' · deploy status checked ' + ago(new Date(dep.at).toISOString());
    h += '<div class="ppsum">' + sum + '. Tap a card to open it; most recently active first.</div>';
    if (!list.length) return h + '<p class="empty">No projects yet. Add your first one above.</p>';
    h += '<div class="bdcols">';
    for (i = 0; i < STAT.length; i++) {
      s = STAT[i];
      var f = !!fold[s];
      h += '<section class="bdcol' + (f ? ' ppcolf' : '') + (SHELF[s] ? ' hold' : '') + '">' +
        '<button class="bdhead" data-pp="fold" data-val="' + s + '" aria-expanded="' + (f ? 'false' : 'true') + '"><span class="bdname">' + LABEL[s] + '</span><span class="bdn">' + by[s].length + '</span><span class="bdcaret">' + (f ? '▸' : '▾') + '</span></button>';
      if (!f) {
        h += '<div class="pplane" data-lane="' + s + '">';
        if (!by[s].length) h += '<div class="bdempty">' + (s === 'in_progress' ? 'Nothing in progress.' : s === 'live' ? 'Nothing live yet.' : 'None.') + '</div>';
        for (var j = 0; j < by[s].length; j++) h += cardHTML(by[s][j]);
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
    h += '<div class="ppsec"><div class="lbl">Status</div>';
    for (i = 0; i < STAT.length; i++) h += '<button class="chip' + (statusOf(p) === STAT[i] ? ' on' : '') + '" data-pp="stat" data-id="' + esc(p.id) + '" data-val="' + STAT[i] + '">' + LABEL[STAT[i]] + '</button>';
    if (SHELF[statusOf(p)]) h += '<div class="pphint">Its tasks are out of Overdue and your counts while it is ' + LABEL[statusOf(p)].toLowerCase() + '.</div>';
    else if (statusOf(p) === 'live') h += '<div class="pphint">Live: tasks you add still show up as normal.</div>';
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
  function setH(el, px) { if (el) el.style.height = px === '' ? '' : Math.max(px, 60) + 'px'; }
  function layout() { // size the scroll areas from the real window height
    var v = $('vPprojects'), pane = $('ppPane'); if (!v || !pane || !onView) return;
    var fix = fixedMode(), on = /(^|\s)ppfix(\s|$)/.test(v.className), cols = pane.querySelector('.bdcols'), wrap = pane.querySelector('.ppwrap'), i, ls, cs;
    if (fix !== on) v.className = fix ? v.className + ' ppfix' : v.className.replace(/\s*ppfix/g, '');
    if (!fix) { // phone: the page scrolls as usual
      if (cols) { cs = cols.querySelectorAll('.bdcol, .pplane'); for (i = 0; i < cs.length; i++) setH(cs[i], ''); setH(cols, ''); }
      if (wrap) { setH(wrap, ''); setH(pane.querySelector('.ppside'), ''); setH(pane.querySelector('.ppmain'), ''); }
      return;
    }
    if (pane.parentNode) pane.parentNode.scrollTop = 0;
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
      cols.scrollLeft = boardScroll.left;
      ls = cols.querySelectorAll('.pplane');
      for (i = 0; i < ls.length; i++) { k = ls[i].getAttribute('data-lane'); if (boardScroll.lanes.hasOwnProperty(k)) ls[i].scrollTop = boardScroll.lanes[k]; }
    }
    if (main && side && pageScroll && pageScroll.id === sel) { main.scrollTop = pageScroll.main; side.scrollTop = pageScroll.side; }
  }
  function relayout() { if (lt) clearTimeout(lt); lt = setTimeout(function () { lt = null; grabScroll(); layout(); putScroll(); }, 120); }
  window.addEventListener('resize', relayout, false);
  window.addEventListener('orientationchange', function () { relayout(); setTimeout(relayout, 500); }, false); // iOS 9 reports the new height late
  window.addEventListener('load', relayout, false);

  function paint() {
    if (!onView) return;
    var p = sel ? byId(sel) : null;
    if (sel && known && !p) { sel = ''; setStore('ppSel', ''); }
    App.setHTML($('viewTitle'), p ? 'My projects<small>' + esc(p.name) + '</small>' : 'My projects');
    var keep = {}, ids = ['ppNew', 'ppTask', 'ppEdit'], i;
    for (i = 0; i < ids.length; i++) if ($(ids[i])) keep[ids[i]] = $(ids[i]).value;
    var ae = document.activeElement, focusId = ae && ae.id ? ae.id : '', focusF = ae && ae.getAttribute ? ae.getAttribute('data-f') : null;
    if (p) watchEvents(p);
    grabScroll();
    $('ppPane').setAttribute('data-sel', p ? p.id : '');
    App.setHTML($('ppPane'), p ? detailPage(p) : boardPage());
    layout(); putScroll();
    for (i = 0; i < ids.length; i++) if ($(ids[i]) && keep[ids[i]] !== undefined) $(ids[i]).value = keep[ids[i]];
    if (focusId && $(focusId) && /^pp/.test(focusId)) $(focusId).focus();
    else if (focusF) { var fe = $('ppPane').querySelector('[data-f="' + focusF + '"]'); if (fe) fe.focus(); }
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
    var was = p.status; p.status = v; moveId = ''; App.setPProjects(list); paint();
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
    sel = id; editId = ''; editing = false; draft = null; showDone = false; moveId = ''; setStore('ppSel', id);
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
  }, false);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f) return;
    if (f.id === 'ppNewForm') { e.preventDefault(); create($('ppNew').value); }
    else if (f.id === 'ppTaskForm') { e.preventDefault(); addTask($('ppTask').value); }
    else if (f.id === 'ppDetForm') { e.preventDefault(); saveDetails(); }
  }, false);
  function onField(e) { // keep the details draft in step with what is typed (the form is redrawn from it)
    var el = e.target, f = el && el.getAttribute ? el.getAttribute('data-f') : null, m;
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
