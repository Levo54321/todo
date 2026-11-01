"""Shared setup for the 2026-11 audit: loads tests/harness.py's mock (without running main) and builds a rich dataset."""
import os, sys, json, uuid, random, re, mimetypes
from urllib.parse import urlparse, parse_qs
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
src = open(os.path.join(REPO, 'tests/harness.py')).read()
src = src[:src.rindex('\nmain()')]
sys.argv = ['harness', REPO]
G = {'__name__': 'harness_lib'}
exec(compile(src, 'harness.py', 'exec'), G)
H, task, d, NOW = G['H'], G['task'], G['d'], G['NOW']

STATUSES = ['idea', 'in_progress', 'live', 'paused', 'not_pursued', 'shut_down']

def rich(scale=1):
    """~109 rows like the live table today (55 open, 54 done in the last 7 days), times `scale`."""
    random.seed(7)
    h = H()
    pps = []
    names = ['Holmlodge Hub', 'Edge Keeper', 'EvoSync', 'Print Gallery', 'Fettlr', 'Kestera', 'RangeIQ', 'May portfolio',
             'Drive cleanup', 'Notion sorter', 'iCloud tidy', 'Gmail cleanup', 'Pixel & Pine', 'Still Motion', 'Old blog', 'Password app']
    for i, n in enumerate(names):
        st = STATUSES[i % 6]
        meta = {'desc': 'A personal project about ' + n.lower(), 'sites': ['https://%s.vercel.app' % n.lower().replace(' ', '-').replace('&', 'and')]}
        if i % 2 == 0: meta['vercel'] = 'https://vercel.com/teamevo/' + n.lower().replace(' ', '-').replace('&', 'and')
        if st in ('idea', 'paused', 'not_pursued', 'shut_down'): meta['reason'] = 'Parked until the hub ships'
        pj = {'id': str(uuid.uuid4()), 'name': n, 'status': st, 'created_at': NOW, 'last_at': NOW, 'done_old': 2, 'meta': meta,
              'pos': i, 'costs': ([{'id': str(uuid.uuid4()), 'name': 'Vercel Pro', 'amount': 16, 'currency': 'GBP', 'freq': 'monthly', 'next_due': d(5), 'link': None, 'email': None}] if i % 3 == 0 else [])}
        pps.append(pj)
    h.pprojects = pps
    work_cats = ['Alpha', 'Beta', 'Gamma', 'Delta']
    pers_cats = ['Home', 'Admin', 'Money', 'Errands', 'Health', 'Social', None]
    rows = []
    for k in range(scale):
        for i in range(55):  # open
            work = i % 2 == 0
            kw = dict(list='work' if work else 'personal', category=random.choice(work_cats) if work else random.choice(pers_cats),
                      created_at='2026-10-%02dT09:00:00Z' % (1 + i % 28))
            r = i % 11
            if r == 0: kw['due_date'] = d(-3)
            elif r == 1: kw['due_date'] = d(0)
            elif r == 2: kw['due_date'] = d(2); kw['remind_time'] = '14:30:00'
            elif r == 3 and work: kw.update(paused=True, paused_at='2026-10-28T09:00:00Z', paused_on='Legal', due_date=d(-1))
            elif r == 4 and work: kw.update(blocked=True, blocked_at='2026-10-27T09:00:00Z', unblock_action='Get access', due_date=d(-2))
            elif r == 5: kw['recur'] = 'weekly'; kw['due_date'] = d(1)
            elif r == 6: kw['low'] = True
            if work: kw['prio'] = i % 4; kw['quick'] = i % 5 == 0
            if not work and i % 4 == 1: kw['pproject_id'] = pps[i % 16]['id']; kw['pp_backlog'] = i % 8 == 1
            rows.append(task('Task %d %s with a realistic sort of title length' % (i + k * 100, 'work' if work else 'home'), **kw))
        for i in range(54):  # done this week
            rows.append(task('Done %d' % (i + k * 100), done=True, done_at='2026-10-%02dT12:00:00Z' % (26 + i % 6),
                             list='work' if i % 2 else 'personal', category='Alpha' if i % 2 else 'Home'))
    h.todos = rows
    return h

def make_route(h, ctx):
    h.external = []
    def route(r):
        u = urlparse(r.request.url)
        if u.hostname != 'todo.test':
            h.external.append(r.request.url); return r.abort()
        if u.path.startswith('/api/'):
            body = None
            try: body = json.loads(r.request.post_data or 'null')
            except Exception: pass
            st, data = h.api(r.request.method, u.path, parse_qs(u.query), body or {})
            if (u.path == '/api/saver' and 'id' in parse_qs(u.query)) or (u.path == '/api/pprojects' and 'icon' in parse_qs(u.query) and r.request.method == 'GET'):
                return r.fulfill(status=200, content_type='image/png', body=open(os.path.join(REPO, 'public/favicon-32.png'), 'rb').read())
            return r.fulfill(status=st, content_type='application/json', body=json.dumps(data))
        fp = os.path.join(REPO, 'public', (u.path.lstrip('/') or 'index.html'))
        if not os.path.isfile(fp): return r.fulfill(status=404, body='nf')
        r.fulfill(status=200, content_type=mimetypes.guess_type(fp)[0] or 'text/plain', body=open(fp, 'rb').read())
    ctx.route('**/*', route)

INIT = "localStorage.setItem('todoToken','tok');localStorage.setItem('railOpen','1');localStorage.setItem('pvSeen','2026-11-01');localStorage.setItem('weekSeen','2026-11-01');"

# Count DOM writes: innerHTML sets, value sets, scrollTop sets, style.height sets.
SPY = r"""
(function(){
  window.__w = {html:0, htmlBytes:0, value:0, scroll:0, height:0, byId:{}};
  function key(el){ var e=el; while(e && !e.id) e=e.parentNode; return e && e.id ? e.id : '?'; }
  var d = Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  Object.defineProperty(Element.prototype,'innerHTML',{get:d.get,set:function(v){window.__w.html++;window.__w.htmlBytes+=String(v).length;var k=key(this);window.__w.byId[k]=(window.__w.byId[k]||0)+1;return d.set.call(this,v);},configurable:true});
  var dv = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  Object.defineProperty(HTMLInputElement.prototype,'value',{get:dv.get,set:function(v){window.__w.value++;return dv.set.call(this,v);},configurable:true});
  var ds = Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
  Object.defineProperty(Element.prototype,'scrollTop',{get:ds.get,set:function(v){window.__w.scroll++;return ds.set.call(this,v);},configurable:true});
})();
"""
