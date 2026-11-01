"""First load with no token: do the feature modules still load after the token is typed in late?"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_lib as L
from playwright.sync_api import sync_playwright
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    for delay in (3000, 15000):
        h = L.rich(1)
        ctx = b.new_context(viewport={'width': 1024, 'height': 768})
        ctx.add_init_script("if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');localStorage.setItem('railOpen','1');localStorage.setItem('pvSeen','2026-11-01');localStorage.setItem('weekSeen','2026-11-01');}")
        L.make_route(h, ctx)
        pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(delay)
        gate = pg.is_visible('#gate')
        pg.fill('#gateInput', 'tok'); pg.click('[data-act=gatesave]'); pg.wait_for_timeout(4000)
        paths = sorted(set(c[1] for c in h.calls))
        out['token typed after %ds' % (delay // 1000)] = {'gate_shown': gate, 'my_projects_loaded': pg.evaluate('App.pprojects().length'), 'endpoints_called': paths,
            'my_projects_tab_visible': pg.is_visible('#nPprojects')}
        ctx.close()
    b.close()
print(json.dumps(out, indent=1))
