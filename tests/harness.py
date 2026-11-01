"""Playwright mock harness for luc-todo. Serves public/ and mocks /api/* with an in-memory store.
Usage (from the repo root): python3 tests/harness.py . tests/t_projects.py   (a test module exposes run(h))
Needs: pip install playwright (Chromium: set CHROME=/path/to/chrome or run python3 -m playwright install chromium)."""
import json, os, sys, uuid, datetime, importlib.util, mimetypes, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

REPO = sys.argv[1]
TODAY = '2026-11-01'
def d(off):
    return (datetime.date(2026, 11, 1) + datetime.timedelta(days=off)).isoformat()
NOW = '2026-11-01T10:00:00Z'

def task(title, **kw):
    t = dict(id=str(uuid.uuid4()), title=title, done=False, done_at=None, due_date=None, category=None, list='personal',
             recur=None, recur_until=None, series_id=None, successor_id=None, remind_time=None, focus_date=None,
             plan_date=None, plan_order=None, is_session=False, items=[], notes=None, low=False, prio=0, quick=False,
             must=False, blocked=False, blocked_at=None, unblock_action=None, pp_backlog=False, paused=False, paused_at=None,
             paused_secs=0, paused_on=None, reviewed_at=None, created_at='2026-10-30T09:00:00Z',
             updated_at='2026-10-30T09:00:00Z', pproject_id=None)
    t.update(kw); return t

class H:
    def __init__(self):
        self.todos = [
            task('Call dentist', due_date=d(-2), category='home'),
            task('Water plants', due_date=d(0), recur='weekly', category='home'),
            task('Read book'),
            task('Ship report', list='work', due_date=d(-1), category='Alpha', prio=2),
            task('Review deck', list='work', due_date=d(0), category='Beta', quick=True),
            task('Waiting on legal', list='work', due_date=d(-3), category='Alpha', paused=True, paused_at='2026-10-29T09:00:00Z', paused_on='Legal'),
            task('Blocked thing', list='work', due_date=d(-4), category='Beta', blocked=True, blocked_at='2026-10-28T09:00:00Z', unblock_action='Get access'),
        ]
        self.pprojects = []
        self.pevents = []
        self.calls = []
        self.errors = []
        self.extra = {}
    def find(self, i):
        for t in self.todos:
            if t['id'] == i: return t
    def api(self, method, path, q, body):
        self.calls.append((method, path, q, body))
        if path in self.extra: return self.extra[path](self, method, q, body)
        if path == '/api/todos':
            if method == 'GET': return 200, {'today': TODAY, 'now': NOW, 'todos': self.todos}
            if method == 'POST':
                title = body.get('text') or body.get('title')
                t = task(title, list='work' if (re.search(r'\swork$', title or '') or body.get('list') == 'work') else 'personal')
                if body.get('pproject_id') and t['list'] == 'personal': t['pproject_id'] = body['pproject_id']; t['pp_backlog'] = body.get('pp_backlog') is True
                self.todos.append(t); return 200, {'todo': t}
            if method == 'PATCH':
                t = self.find(q['id'][0]);
                if not t: return 404, {'error': 'not found'}
                nxt = None
                for k, v in body.items():
                    if k == 'done':
                        t['done'] = bool(v); t['done_at'] = NOW if v else None
                        if v and t['recur'] and not t['successor_id']:
                            nxt = task(t['title'], due_date=d(7), recur=t['recur'], list=t['list'], category=t['category'], pproject_id=t.get('pproject_id'))
                            t['successor_id'] = nxt['id']; self.todos.append(nxt)
                    elif k in t: t[k] = v
                return 200, {'todo': t, 'next': nxt}
            if method == 'DELETE':
                self.todos = [t for t in self.todos if t['id'] != q['id'][0]]; return 200, {'ok': True}
        if path == '/api/pprojects':
            if method == 'GET':
                if 'events' in q: return 200, {'events': [e for e in self.pevents if e['pid'] == q['events'][0]][::-1]}
                if 'vercel' in q:
                    if q['vercel'][0] == '1': return 200, {'configured': True, 'projects': [{'team': 'teamevo', 'name': 'holmlodge-hub', 'paused': False}, {'team': 'teamevo', 'name': 'old-app', 'paused': True}]}
                    return 200, {'vercel': 'https://vercel.com/' + q['vercel'][0], 'sites': ['https://hub.example.com', 'https://holmlodge-hub.vercel.app'], 'github': 'https://github.com/Levo54321/hub', 'paused': False}
                if 'deploy' in q:
                    st = {}
                    for pj in self.pprojects:
                        if pj['meta'].get('vercel'): st[pj['id']] = {'state': 'PAUSED', 'color': 'paused'} if 'old-app' in pj['meta']['vercel'] else {'state': 'READY', 'color': 'green', 'at': 1793490000000}
                    return 200, {'configured': True, 'status': st}
                out = []
                for pj in self.pprojects:
                    o = dict(pj); o['open'] = len([t for t in self.todos if t.get('pproject_id') == pj['id'] and not t['done']]); out.append(o)
                return 200, {'projects': out}
            if method == 'POST':
                if any(p['name'].lower() == body['name'].lower() for p in self.pprojects): return 409, {'error': 'a project with that name already exists'}
                pj = {'id': str(uuid.uuid4()), 'name': body['name'], 'status': body.get('status', 'in_progress'), 'created_at': NOW, 'last_at': NOW, 'done_old': 0, 'meta': {}}
                self.pprojects.append(pj); self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'created', 't': pj['name']}); return 201, {'project': pj}
            pj = [x for x in self.pprojects if x['id'] == q['id'][0]][0]
            if method == 'PATCH':
                if 'name' in body and any(p['name'].lower() == body['name'].lower() and p is not pj for p in self.pprojects): return 409, {'error': 'a project with that name already exists'}
                if 'status' in body: self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'status', 't': pj['status'] + ' -> ' + body['status']})
                for k in ('name', 'status'):
                    if k in body: pj[k] = body[k]
                if 'meta' in body:
                    pj['meta'] = dict(body['meta'])
                    if pj['meta'].get('sites'): pj['meta']['icon'] = 'http://todo.test/icon-180.png'
                    self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'details', 't': None})
                return 200, {'project': pj}
        if path == '/api/pause':
            t = self.find(q['id'][0]); t['paused'] = bool(body.get('paused'));
            t['paused_at'] = NOW if t['paused'] else None; return 200, {'todo': t}
        if path == '/api/projects':
            return 200, {'projects': [{'id': 'p1', 'name': 'Alpha', 'prio': 2, 'status': 'active'}, {'id': 'p2', 'name': 'Beta', 'prio': 1, 'status': 'active'}]}
        if path == '/api/settings': return 200, {'settings': {}}
        if path == '/api/history': return 200, {'history': [{'c': '2026-10-20T09:00:00Z', 'd': '2026-10-25T09:00:00Z', 'cat': 'home', 'l': 'personal', 't': 'Old'}]}
        if path == '/api/budget': return 200, {'config': {}, 'entries': []}
        if path == '/api/saver':
            if 'id' in q: return 200, None
            return 200, {'images': [{'id': 'img1', 'w': 10, 'h': 10, 'kb': 1}]}
        if path == '/api/gcal': return 200, {'configured': False, 'connected': False, 'events': []}
        if path == '/api/cal': return 200, {'connected': False}
        if path == '/api/glance': return 200, {}
        return 404, {'error': 'unmocked ' + path}

def main():
    spec = importlib.util.spec_from_file_location('t', sys.argv[2]); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    h = H()
    with sync_playwright() as p:
        exe = os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
        b = p.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else p.chromium.launch(args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1024, 'height': 768})
        ctx.add_init_script("localStorage.setItem('todoToken','tok');localStorage.setItem('railOpen','1');localStorage.setItem('pvSeen','2026-11-01');")
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
                if u.path == '/api/saver' and 'id' in parse_qs(u.query):
                    return r.fulfill(status=200, content_type='image/png', body=open(os.path.join(REPO, 'public/favicon-32.png'), 'rb').read())
                return r.fulfill(status=st, content_type='application/json', body=json.dumps(data))
            fp = os.path.join(REPO, 'public', (u.path.lstrip('/') or 'index.html'))
            if not os.path.isfile(fp): return r.fulfill(status=404, body='nf')
            r.fulfill(status=200, content_type=mimetypes.guess_type(fp)[0] or 'text/plain', body=open(fp, 'rb').read())
        ctx.route('**/*', route)
        page = ctx.new_page()
        page.on('pageerror', lambda e: h.errors.append(str(e) + ' @ ' + (e.stack or '')[:300]))
        page.on('console', lambda m: m.type == 'error' and h.errors.append('console: ' + m.text))
        page.goto('http://todo.test/'); page.wait_for_timeout(800)
        h.page = page
        results = mod.run(h)
        b.close()
    ok = all(r[1] for r in results)
    for name, passed, info in results: print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else '  -> ' + str(info)))
    print('page errors:', h.errors); print('external requests:', h.external)
    print('ALL PASS' if ok and not h.errors else 'SOMETHING FAILED')

main()
