"""v1051 (Deploy B): Google sign-in starts by POST (token only in a header, never in the address) and #t= is cleared from the address bar.
v1050 (Deploy A): late token still loads every module, one shared /api/projects fetch, Work board writes no scroll
on idle ticks, board error state with retry, Work header fits at 1024, project page title written once."""
import importlib.util, os, json, mimetypes
from urllib.parse import urlparse, parse_qs
D = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(D)
spec = importlib.util.spec_from_file_location('tp', os.path.join(D, 't_projects.py')); tp = importlib.util.module_from_spec(spec); spec.loader.exec_module(tp)
spec = importlib.util.spec_from_file_location('ti', os.path.join(D, 't_import.py')); ti = importlib.util.module_from_spec(spec); spec.loader.exec_module(ti)

def fresh(h, token_js, w=1024, hh=768, tz=None):
    b = h.page.context.browser
    ctx = b.new_context(viewport={'width': w, 'height': hh}, timezone_id=tz) if tz else b.new_context(viewport={'width': w, 'height': hh})
    ctx.add_init_script("if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');" + token_js + "localStorage.setItem('railOpen','1');localStorage.setItem('pvSeen','2026-11-01');localStorage.setItem('weekSeen','2026-11-01');}")
    def route(r):
        u = urlparse(r.request.url)
        if u.hostname != 'todo.test': return r.abort()
        if u.path.startswith('/api/'):
            body = None
            try: body = json.loads(r.request.post_data or 'null')
            except Exception: pass
            st, data = h.api(r.request.method, u.path, parse_qs(u.query), body or {})
            if u.path == '/api/pprojects' and 'icon' in parse_qs(u.query):
                return r.fulfill(status=200, content_type='image/png', body=open(os.path.join(REPO, 'public/favicon-32.png'), 'rb').read())
            return r.fulfill(status=st, content_type='application/json', body=json.dumps(data))
        fp = os.path.join(REPO, 'public', (u.path.lstrip('/') or 'index.html'))
        if not os.path.isfile(fp): return r.fulfill(status=404, body='nf')
        r.fulfill(status=200, content_type=mimetypes.guess_type(fp)[0] or 'text/plain', body=open(fp, 'rb').read())
    ctx.route('**/*', route)
    return ctx

def run(h):
    R = tp.run(h)
    def chk(name, cond, info=''): R.append(('A: ' + name, bool(cond), info))
    h.errors[:] = [e for e in h.errors]  # keep earlier state
    for delay in (3000, 15000):
        n0 = len(h.calls)
        ctx = fresh(h, ''); pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(delay)
        chk('gate shown with no token (%ds)' % (delay // 1000), pg.is_visible('#gate'))
        pg.fill('#gateInput', 'tok'); pg.click('[data-act=gatesave]'); pg.wait_for_timeout(2500)
        paths = [c[1] for c in h.calls[n0:]]
        chk('late token (%ds): My projects loads' % (delay // 1000), pg.evaluate('App.pprojects().length') > 0, paths)
        chk('late token (%ds): Work projects load' % (delay // 1000), paths.count('/api/projects') >= 1)
        chk('late token (%ds): work calendar + calendar status asked' % (delay // 1000), '/api/gcal' in paths and '/api/cal' in paths, sorted(set(paths)))
        chk('late token (%ds): /api/projects fetched once at startup' % (delay // 1000), paths.count('/api/projects') == 1, paths.count('/api/projects'))
        ctx.close()

    # Work board: idle ticks write no scroll positions
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');"); pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
    pg.click('#nWork'); pg.click('#nProjects'); pg.wait_for_timeout(1200)
    pg.evaluate("""(function(){window.__w=0;var d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
      Object.defineProperty(Element.prototype,'scrollTop',{get:d.get,set:function(v){window.__w++;d.set.call(this,v);},configurable:true});
      var l=Object.getOwnPropertyDescriptor(Element.prototype,'scrollLeft');
      Object.defineProperty(Element.prototype,'scrollLeft',{get:l.get,set:function(v){window.__w++;l.set.call(this,v);},configurable:true});})()""")
    pg.evaluate('App.reload()'); pg.wait_for_timeout(1500)
    pg.evaluate('App.reload()'); pg.wait_for_timeout(1500)
    chk('Work board: no scroll writes when nothing changed', pg.evaluate('window.__w') == 0, pg.evaluate('window.__w'))
    # v1070: a task added from a column's Add box shows at once (box still focused); long titles wrap instead of sitting under the pill
    inp = pg.query_selector('#boardPane form.bdadd .bdin'); pid = inp.evaluate("e => e.form.getAttribute('data-pid')")
    inp.click(); inp.fill('Brand new board task v1070'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1200)
    chk('board: new task appears without switching page', 'Brand new board task v1070' in pg.inner_text('#boardPane'))
    chk('board: cursor back in that column Add box, now empty', pg.evaluate("(function(p){var a=document.activeElement;return !!a&&a.className==='bdin'&&a.value===''&&a.form.getAttribute('data-pid')===p;})(%s)" % json.dumps(pid)))
    ov = pg.evaluate("""(function(){var heads=document.querySelectorAll('#boardPane .bdhead'),bad=0,n=0,i,nm,pl;
      for(i=0;i<heads.length;i++){nm=heads[i].querySelector('.bdname');pl=heads[i].querySelector('.bdp');if(!nm||!pl)continue;n++;
        nm.textContent='A very long project name that must wrap onto lines';
        if(nm.getBoundingClientRect().right>pl.getBoundingClientRect().left+1)bad++;}
      return [n,bad];})()""")
    chk('board: long project titles never run under the priority pill', ov[0] > 0 and ov[1] == 0, ov)
    ctx.close()

    # board error state + retry
    saved = h.extra.get('/api/projects'); h.extra['/api/projects'] = lambda hh, m, q, body: (500, {'error': 'x'})
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');"); pg = ctx.new_page(); h.allow.append('500'); pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
    pg.click('#nWork'); pg.click('#nProjects'); pg.wait_for_timeout(1200)
    chk('board failure shows message and Try again', 'Could not load' in pg.inner_text('#boardPane') and pg.is_visible('[data-bd=retry]'), pg.inner_text('#boardPane')[:100])
    if saved: h.extra['/api/projects'] = saved
    else: del h.extra['/api/projects']
    pg.click('[data-bd=retry]'); pg.wait_for_timeout(1200)
    chk('retry recovers the board', 'Could not load' not in pg.inner_text('#boardPane') and pg.query_selector('.bdcols') is not None)
    ctx.close()

    # Work header fits at 1024 and 768 portrait, personal list too
    for w, hh in ((1024, 768), (768, 1024), (390, 844)):
        ctx = fresh(h, "localStorage.setItem('todoToken','tok');localStorage.setItem('list','work');", w, hh); pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
        for lst in ('personal', 'work'):
            sel = '[data-act=list][data-val=%s]' % lst
            if pg.query_selector(sel): pg.click(sel); pg.wait_for_timeout(500)
            info = pg.evaluate("""(function(){var o=[],els=document.querySelectorAll('.top .hd-right button,.top .hd-right .stats,.top .hd-mid');
              for(var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect();if(r.width&&(r.right>innerWidth+1||r.left<-1))o.push(els[i].className+' '+Math.round(r.right));}
              return {clipped:o, over:document.documentElement.scrollWidth-innerWidth};})()""")
            chk('header not clipped, no sideways scroll: %s %dx%d' % (lst, w, hh), not info['clipped'] and info['over'] <= 0, info)
        ctx.close()
    # Deploy B: Google sign-in start is a POST with the token in a header; #t= leaves the address bar
    seen = {}
    def gc(hh, m, q, body):
        if m == 'POST' and body and body.get('start'): seen['hit'] = True; return 200, {'url': 'http://todo.test/signed-in-ok'}
        return 200, {'configured': True, 'connected': False, 'events': []}
    prev = h.extra.get('/api/gcal'); h.extra['/api/gcal'] = gc
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');"); pg = ctx.new_page()
    reqs = []; pg.on('request', lambda r: reqs.append((r.method, r.url, r.headers.get('x-todo-token'))))
    pg.goto('http://todo.test/'); pg.wait_for_timeout(1200)
    pg.evaluate("var b=document.createElement('button');b.setAttribute('data-sv','gsign');b.id='gtest';b.textContent='g';document.body.appendChild(b)")
    pg.evaluate("document.getElementById('gtest').click()"); pg.wait_for_timeout(1000)
    chk('Google sign-in start is a POST with the token in a header', seen.get('hit') and any(m == 'POST' and u.endswith('/api/gcal') and t == 'tok' for m, u, t in reqs), [r for r in reqs if 'gcal' in r[1]])
    chk('no request carries the token in its address', not any('tok' in u.split('?', 1)[-1] for m, u, t in reqs if '?' in u and 'gcal' in u), [u for m, u, t in reqs if 'gcal' in u])
    chk('app followed the returned address', pg.url.endswith('/signed-in-ok'), pg.url)
    if prev: h.extra['/api/gcal'] = prev
    else: del h.extra['/api/gcal']
    ctx.close()
    ctx = fresh(h, ''); pg = ctx.new_page(); pg.goto('http://todo.test/#t=tok'); pg.wait_for_timeout(1200)
    chk('#t= link signs in and clears the token from the address bar', pg.url == 'http://todo.test/' and pg.evaluate("localStorage.getItem('todoToken')") == 'tok' and not pg.is_visible('#gate'), pg.url)
    ctx.close()
    deploy_d(h, chk)
    h.page.goto('http://todo.test/'); h.page.wait_for_timeout(600)  # v1059: CSV import runs last (it adds tasks)
    R += ti.run(h)
    return R

def deploy_d(h, chk):
    """v1052 (Deploy D, polling diet): the list is only downloaded when it changed ("same" replies), refresh every 30 s,
    idle still every 10 minutes, calendar sync every 5 minutes."""
    import uuid
    def gets(n0): return [c for c in h.calls[n0:] if c[0] == 'GET' and c[1] == '/api/todos']
    SPY = """(function(){window.__w={html:0,scroll:0};
      var d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
      Object.defineProperty(Element.prototype,'innerHTML',{get:d.get,set:function(v){window.__w.html++;d.set.call(this,v);},configurable:true});
      var s=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
      Object.defineProperty(Element.prototype,'scrollTop',{get:s.get,set:function(v){window.__w.scroll++;s.set.call(this,v);},configurable:true});})()"""
    FOCUS = "window.dispatchEvent(new Event('focus'))"
    h.page.evaluate('App.setIdle(true)')  # the suite's own page keeps polling on a real timer; quiet it so it cannot add calls to the counts below
    def extra(*pairs):  # set mock overrides, return what to restore
        saved = [(p, h.extra.get(p)) for p, _ in pairs]
        for p, f in pairs: h.extra[p] = f
        return saved
    def restore(saved):
        for p, f in saved:
            if f: h.extra[p] = f
            else: h.extra.pop(p, None)

    # 1. a "same" reply leaves the list in memory and the screen untouched
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');"); pg = ctx.new_page()
    n0 = len(h.calls); pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
    g = gets(n0)
    chk('D: first load sends no ?v= and gets the full list', g and 'v' not in g[0][2] and pg.evaluate('App.todos().length') == len(h.todos), [x[2] for x in g])
    pg.evaluate(SPY); pg.evaluate('window.__ref = App.todos()')
    n1, s1 = len(h.calls), h.same
    pg.evaluate(FOCUS); pg.wait_for_timeout(800)
    g = gets(n1)
    chk('D: next refresh sends ?v= and is answered "same"', len(g) == 1 and 'v' in g[0][2] and h.same == s1 + 1, ([x[2] for x in g], h.same - s1))
    chk('D: a "same" reply keeps the very same list in memory', pg.evaluate('App.todos() === window.__ref'))
    w = pg.evaluate('window.__w')
    chk('D: a "same" reply writes nothing to the page (no innerHTML, no scroll writes)', w['html'] == 0 and w['scroll'] == 0, w)

    # 2. a change made elsewhere comes back as the full list and shows up
    h.todos.append(dict(h.todos[2], id=str(uuid.uuid4()), title='Added on another device', due_date=None, done=False, list='personal', pproject_id=None, pp_backlog=False, paused=False, blocked=False))
    n2, s2 = len(h.calls), h.same
    pg.evaluate(FOCUS); pg.wait_for_timeout(800)
    g = gets(n2)
    chk('D: a change elsewhere gives the full list again (not "same") and shows on screen', len(g) == 1 and 'v' in g[0][2] and h.same == s2 and 'Added on another device' in pg.inner_text('body'), (h.same - s2, len(g)))
    n3, s3 = len(h.calls), h.same
    pg.evaluate(FOCUS); pg.wait_for_timeout(800)
    chk('D: ...and the refresh after that is "same" again', h.same == s3 + 1 and 'v' in gets(n3)[0][2])

    # 3. after an edit made here, the next refreshes ask for the full list until it has been taken in
    pg.evaluate('App.mutated()')
    n4 = len(h.calls); pg.evaluate(FOCUS); pg.wait_for_timeout(600)
    g1 = gets(n4)
    pg.wait_for_timeout(2600)
    n5 = len(h.calls); pg.evaluate(FOCUS); pg.wait_for_timeout(600)
    g2 = gets(n5)
    n6, s6 = len(h.calls), h.same; pg.evaluate(FOCUS); pg.wait_for_timeout(600)
    g3 = gets(n6)
    chk('D: right after a local edit the refresh asks for the full list (no ?v=)', len(g1) == 1 and 'v' not in g1[0][2], [x[2] for x in g1])
    chk('D: ...and again once the 2.5 s edit guard has passed, so the list is taken in', len(g2) == 1 and 'v' not in g2[0][2], [x[2] for x in g2])
    chk('D: ...then back to "same"', len(g3) == 1 and 'v' in g3[0][2] and h.same == s6 + 1, ([x[2] for x in g3], h.same - s6))
    ctx.close()

    # 4. a failed delete heals: the task comes back even though nothing was edited before (the "refresh and trust the server" paths)
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');"); pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
    tid = pg.evaluate("(function(){var a=App.todos();for(var i=0;i<a.length;i++)if(!a[i].done&&!a[i].recur&&!a[i].due_date&&a[i].list==='personal'&&!a[i].paused&&!a[i].pproject_id)return a[i].id+'|'+a[i].title;return ''})()")
    tid, ttitle = tid.split('|', 1)
    pg.evaluate(FOCUS); pg.wait_for_timeout(600)  # now holding a fingerprint, as a long-open page would
    h.fail_delete = True; h.allow.append('500')
    pg.locator('[data-act=edit][data-id="%s"]' % tid).first.click(position={'x': 12, 'y': 10}); pg.wait_for_timeout(400)  # the title, not a chip
    pg.click('#eMoreBtn'); pg.wait_for_timeout(200)  # Delete lives under "More options"
    pg.once('dialog', lambda dlg: dlg.accept())
    pg.click('[data-act=delete]'); pg.wait_for_timeout(1500)
    h.fail_delete = False
    chk('D: failed delete (server says 500): the task is back on screen after the refresh', pg.evaluate("App.find('%s') !== null" % tid) and ttitle in pg.inner_text('body'), ttitle)
    ctx.close()

    # 5. timers, on a fake clock: 30 s refresh, idle every 10 minutes, calendar sync every 5 minutes, clock-driven changes still redraw
    import datetime
    T0 = datetime.datetime(2026, 11, 1, 10, 0, tzinfo=datetime.timezone.utc)  # a datetime: a bare number is read as seconds
    saved = extra(('/api/glance', lambda hh, m, q, body: (200, {'calendar': True, 'events': [{'s': '09:00', 'e': '10:30', 'title': 'Standup', 'allDay': False}]})),
                  ('/api/settings', lambda hh, m, q, body: (200, {'settings': {'caldav': True}})),
                  ('/api/cal', lambda hh, m, q, body: (200, {'connected': True, 'changed': False})))
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');localStorage.setItem('saverTimeout','0');", tz='UTC'); pg = ctx.new_page()
    pg.clock.install(time=T0)
    pg.goto('http://todo.test/'); pg.wait_for_timeout(1500); pg.clock.run_for(3000); pg.wait_for_timeout(300)
    chk('D: calendar event shows and is not greyed at 10:00 (ends 10:30)', pg.query_selector('#glance .ev') is not None and pg.query_selector('#glance .ev.past') is None, pg.inner_html('#glance')[:120])
    n7 = len(h.calls)
    for i in range(10): pg.clock.run_for(30000); pg.wait_for_timeout(60)
    g = gets(n7)
    chk('D: foreground refresh runs every 30 s (about 10 in 5 minutes, was 20)', 9 <= len(g) <= 10, len(g))
    chk('D: ...and each one asks with ?v=', all('v' in x[2] for x in g), [x[2] for x in g][:3])
    for i in range(52): pg.clock.run_for(30000); pg.wait_for_timeout(40)  # on to 10:31
    chk('D: a "same" refresh still redraws as the clock moves on (calendar event greys out after 10:30)', pg.query_selector('#glance .ev.past') is not None, pg.inner_html('#glance')[:160])
    syncs = [c for c in h.calls[n7:] if c[0] == 'POST' and c[1] == '/api/cal']
    mins = 31
    chk('D: Apple calendar sync about every 5 minutes (%d syncs in %d minutes, was about every 2)' % (len(syncs), mins), mins // 6 <= len(syncs) <= mins // 5 + 1, len(syncs))
    pg.evaluate('App.setIdle(true)')
    n8 = len(h.calls); mine = []  # this page's own requests (h.calls also holds other open pages' polls)
    pg.on('request', lambda r: mine.append(r.url) if '/api/todos' in r.url and r.method == 'GET' else None)
    for i in range(10): pg.clock.run_for(30000); pg.wait_for_timeout(40)
    c5 = len(mine)
    for i in range(12): pg.clock.run_for(30000); pg.wait_for_timeout(40)
    c11 = len(mine)
    chk('D: idle slowdown unchanged: no refresh in the first 5 minutes, one by 11 minutes', c5 == 0 and c11 == 1, (c5, c11, 'all pages: %d' % len(gets(n8))))
    ctx.close(); restore(saved)
