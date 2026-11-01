"""API calls and response bytes per simulated hour with Playwright's fake clock (timers fire on the fake clock, responses come from the mock).
Bytes are the size of each mock reply as JSON (headers not counted); 'todos_bytes' is the part that is GET /api/todos.
Note: Playwright reads a bare number given to clock.install(time=...) as SECONDS; the 1793527200000 below is therefore far in the future (year 58804),
which is harmless for counting calls. Use a datetime when the page's own date matters (see tests/t_deploya.py)."""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_lib as L
from playwright.sync_api import sync_playwright

def scenario(b, name, view, caldav=False, saver=None):
    h = L.rich(1)
    sizes = []
    orig = h.api
    def counting(m, path, q, body):
        st, data = orig(m, path, q, body)
        sizes.append((m + ' ' + path, len(json.dumps(data))))
        return st, data
    h.api = counting
    if caldav: h.extra['/api/settings'] = lambda h, m, q, body: (200, {'settings': {'caldav': True}})
    h.extra['/api/cal'] = lambda h, m, q, body: (200, {'connected': caldav, 'changed': False})
    ctx = b.new_context(viewport={'width': 1024, 'height': 768})
    init = L.INIT + ("localStorage.setItem('saverTimeout','%s');localStorage.setItem('saverMode','%s');" % (saver[0], saver[1]) if saver else "localStorage.setItem('saverTimeout','0');")
    ctx.add_init_script(init)
    L.make_route(h, ctx)
    pg = ctx.new_page()
    pg.clock.install(time=1793527200000)  # 2026-11-01 10:00 UTC
    pg.goto('http://todo.test/'); pg.wait_for_timeout(1500)
    pg.clock.run_for(3000); pg.wait_for_timeout(500)
    if view: pg.click('[data-act=nav][data-view=%s]' % view); pg.wait_for_timeout(500)
    if view == 'pprojects': pass
    start = len(h.calls); sstart = len(sizes)
    for i in range(240):  # one hour in 15 s steps
        pg.clock.run_for(15000); pg.wait_for_timeout(40)
    c = collections.Counter()
    for m, path, q, body in h.calls[start:]:
        k = path + ('?' + ','.join(sorted(k for k in q if k != '_')) if [k for k in q if k != '_'] else '')
        c[m + ' ' + k] += 1
    ctx.close()
    nb = sum(n for k, n in sizes[sstart:]); tb = sum(n for k, n in sizes[sstart:] if k == 'GET /api/todos')
    return {'scenario': name, 'total': sum(c.values()), 'bytes': nb, 'todos_bytes': tb, 'by': dict(c.most_common())}

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    res = [scenario(b, 'Personal list, Apple calendar off', 'personal')]
    res += [
           scenario(b, 'Personal list, Apple calendar on', 'personal', caldav=True),
           scenario(b, 'My projects board', 'pprojects'),
           scenario(b, 'Screensaver (plugged, starts after 1 min)', 'personal', saver=('1', 'plugged')),
           scenario(b, 'Screensaver (battery, starts after 1 min)', 'personal', saver=('1', 'battery'))]
    b.close()
print(json.dumps(res, indent=1))
