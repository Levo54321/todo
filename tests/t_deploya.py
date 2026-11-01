"""v1050 (Deploy A): late token still loads every module, one shared /api/projects fetch, Work board writes no scroll
on idle ticks, board error state with retry, Work header fits at 1024, project page title written once."""
import importlib.util, os, json, mimetypes
from urllib.parse import urlparse, parse_qs
D = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(D)
spec = importlib.util.spec_from_file_location('tp', os.path.join(D, 't_projects.py')); tp = importlib.util.module_from_spec(spec); spec.loader.exec_module(tp)

def fresh(h, token_js, w=1024, hh=768):
    b = h.page.context.browser
    ctx = b.new_context(viewport={'width': w, 'height': hh})
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
    pg.click('[data-act=nav][data-view=board]'); pg.wait_for_timeout(1200)
    pg.evaluate("""(function(){window.__w=0;var d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
      Object.defineProperty(Element.prototype,'scrollTop',{get:d.get,set:function(v){window.__w++;d.set.call(this,v);},configurable:true});
      var l=Object.getOwnPropertyDescriptor(Element.prototype,'scrollLeft');
      Object.defineProperty(Element.prototype,'scrollLeft',{get:l.get,set:function(v){window.__w++;l.set.call(this,v);},configurable:true});})()""")
    pg.evaluate('App.reload()'); pg.wait_for_timeout(1500)
    pg.evaluate('App.reload()'); pg.wait_for_timeout(1500)
    chk('Work board: no scroll writes when nothing changed', pg.evaluate('window.__w') == 0, pg.evaluate('window.__w'))
    ctx.close()

    # board error state + retry
    saved = h.extra.get('/api/projects'); h.extra['/api/projects'] = lambda hh, m, q, body: (500, {'error': 'x'})
    ctx = fresh(h, "localStorage.setItem('todoToken','tok');"); pg = ctx.new_page(); h.allow.append('500'); pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
    pg.click('[data-act=nav][data-view=board]'); pg.wait_for_timeout(1200)
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
    return R
