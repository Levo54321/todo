import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_lib as L
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    h = L.rich(1); ctx = b.new_context(viewport={'width': 1024, 'height': 768}); ctx.add_init_script(L.INIT + "localStorage.setItem('saverTimeout','0');")
    L.make_route(h, ctx); pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(4000)
    boot = collections.Counter(c[0] + ' ' + c[1] + ('?' + ','.join(k for k in c[2] if k != '_') if [k for k in c[2] if k != '_'] else '') for c in h.calls)
    n = len(h.calls)
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('webkitvisibilitychange')); window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('focus'));")
    pg.wait_for_timeout(3000)
    res = collections.Counter(c[0] + ' ' + c[1] + ('?' + ','.join(k for k in c[2] if k != '_') if [k for k in c[2] if k != '_'] else '') for c in h.calls[n:])
    print(json.dumps({'boot_total': sum(boot.values()), 'boot': dict(boot), 'resume_total': sum(res.values()), 'resume': dict(res)}, indent=1))
    b.close()
