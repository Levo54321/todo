"""Desktop "Install app" check (v1058). Standalone: python3 tests/t_install.py
Serves public/ on http://localhost (a secure context, which the mock harness's http://todo.test is not), then asks
Chromium itself whether the page is installable (CDP Page.getInstallabilityErrors / getAppManifest), that the
do-nothing service worker registers, and that it never answers or caches a request. /api calls 404 here on purpose."""
import os, sys, json, threading, struct
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PUB = os.path.join(REPO, 'public')
R = []
def chk(name, ok, info=''): R.append((name, bool(ok), info))

class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{'.webmanifest': 'application/manifest+json', '.js': 'application/javascript'})
    def __init__(self, *a, **k): super().__init__(*a, directory=PUB, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/api/'):
            self.send_response(404); self.end_headers(); return
        return super().do_GET()

def png_size(path):
    with open(path, 'rb') as f: b = f.read(24)
    return struct.unpack('>II', b[16:24])

# --- static checks (no browser) ---
man = json.load(open(os.path.join(PUB, 'manifest.webmanifest')))
chk('manifest: name, start_url, standalone', man.get('name') and man.get('start_url') == '/' and man.get('display') == 'standalone', man)
for ic in man['icons']:
    fp = os.path.join(PUB, ic['src'].lstrip('/'))
    w, h = png_size(fp)
    chk('icon %s is %s' % (ic['src'], ic['sizes']), '%dx%d' % (w, h) == ic['sizes'], (w, h))
sizes = [i['sizes'] for i in man['icons']]
chk('manifest has 192 and 512 icons plus a maskable one', '192x192' in sizes and '512x512' in sizes and any(i.get('purpose') == 'maskable' for i in man['icons']))
sw = '\n'.join(l for l in open(os.path.join(PUB, 'sw.js')).read().split('\n') if not l.strip().startswith('//'))  # code only, not comments
chk('sw.js never caches or answers requests', 'caches' not in sw and 'respondWith' not in sw)
vj = json.load(open(os.path.join(REPO, 'vercel.json')))
srcs = [h['source'] for h in vj['headers']]
chk('vercel.json: sw.js and manifest are no-cache', '/sw.js' in srcs and '/manifest.webmanifest' in srcs)
idx = open(os.path.join(PUB, 'index.html')).read()
chk('index.html links the manifest and registers the worker', 'rel="manifest" href="/manifest.webmanifest"' in idx and "register('/sw.js')" in idx)
chk('apple-touch-icon kept (iPad/iPhone)', 'rel="apple-touch-icon" href="/icon-180.png"' in idx)

# --- browser checks ---
srv = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = 'http://localhost:%d/' % srv.server_address[1]
with sync_playwright() as p:
    exe = os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
    import tempfile
    # a normal (non-incognito) profile: Chrome never offers install in incognito, which is Playwright's default
    kw = dict(args=['--no-sandbox'], viewport={'width': 1024, 'height': 768})
    if exe: kw['executable_path'] = exe
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), **kw)
    ctx.add_init_script("localStorage.setItem('todoToken','tok');")
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(1500)
    cdp = ctx.new_cdp_session(pg)
    m = cdp.send('Page.getAppManifest')
    chk('Chromium parsed the manifest without errors', not m.get('errors') and m.get('url', '').endswith('/manifest.webmanifest'), m.get('errors'))
    inst = cdp.send('Page.getInstallabilityErrors').get('installabilityErrors', [])
    chk('Chromium reports NO installability errors', inst == [], inst)
    reg = pg.evaluate("navigator.serviceWorker.ready.then(function(r){return r.scope})")
    chk('service worker registered at the site root', reg == url, reg)
    pg.reload(); pg.wait_for_timeout(800)
    ctl = pg.evaluate("!!navigator.serviceWorker.controller")
    chk('page is controlled by the worker after reload', ctl)
    body = pg.evaluate("fetch('/manifest.webmanifest',{cache:'no-store'}).then(function(r){return r.status+' '+r.headers.get('content-type')})")
    chk('requests pass straight through the worker', body.startswith('200 application/manifest+json'), body)
    keys = pg.evaluate("caches.keys().then(function(k){return k.length})")
    chk('nothing stored in Cache Storage', keys == 0, keys)
    chk('no page errors', not errs, errs)
    ctx.close()
srv.shutdown()
for name, ok, info in R: print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(info)))
print('ALL PASS' if all(r[1] for r in R) else 'SOMETHING FAILED')
sys.exit(0 if all(r[1] for r in R) else 1)
