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
        self.vault = {'configured': True, 'pw': None, 'pass': None, 'n': 0, 'fails': 0, 'entries': {}, 'gets': 0}
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
        if path == '/api/pprojects' and 'vault' in q:  # mirrors api/_vault.js (crypto itself is tested in tests/vault_node.js)
            V = self.vault; a = body.get('action')
            if not V['configured']: return 200, {'configured': False}
            if a == 'reset':
                if body.get('confirm') != 'DELETE ALL': return 400, {'error': 'type DELETE ALL to confirm'}
                n = len(V['entries']); V['entries'] = {}; V['pw'] = None; return 200, {'ok': True, 'deleted': n}
            if a == 'setup':
                if V['pw']: return 409, {'error': 'the vault already has a password'}
                if len(body.get('password') or '') < 10: return 400, {'error': 'use at least 10 characters'}
                V['pw'] = body['password']; V['n'] += 1; V['pass'] = 'pass-%d' % V['n']; return 200, {'pass': V['pass']}
            if a == 'unlock':
                if V['fails'] >= 5: return 429, {'error': 'too many wrong tries, wait a few minutes'}
                if body.get('password') != V['pw']: V['fails'] += 1; return 403, {'error': 'wrong password'}
                V['fails'] = 0; V['n'] += 1; V['pass'] = 'pass-%d' % V['n']; return 200, {'pass': V['pass']}
            ok = V['pw'] and body.get('pass') and body.get('pass') == V['pass']
            if ok: V['n'] += 1; V['pass'] = 'pass-%d' % V['n']
            if a == 'state':
                rows = [(k, e) for k, e in V['entries'].items() if e['project'] == body.get('project_id')]
                out = {'configured': True, 'set': bool(V['pw']), 'locked': not ok, 'count': len(rows)}
                if ok: out['entries'] = [{'id': k, 'name': e['name']} for k, e in rows]; out['pass'] = V['pass']
                return 200, out
            if not ok: return 401, {'locked': True, 'error': 'the vault is locked'}
            if a == 'get': V['gets'] += 1; return 200, {'value': V['entries'][body['id']]['value'], 'pass': V['pass']}
            if a == 'save':
                i = body.get('id') or str(uuid.uuid4()); V['entries'][i] = {'project': body['project_id'], 'name': body['name'], 'value': body['value']}
                return 200, {'entry': {'id': i, 'name': body['name']}, 'pass': V['pass']}
            if a == 'delete': V['entries'].pop(body['id'], None); return 200, {'ok': True, 'pass': V['pass']}
            return 400, {'error': 'unknown action'}
        if path == '/api/pprojects':
            if 'icon' in q:  # stored / custom icons
                pj = [x for x in self.pprojects if x['id'] == q['icon'][0]][0]
                if method == 'DELETE':
                    pj['icon_kind'] = 'none'; pj['icon_at'] = 1793500000000 + len(self.calls); self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'icon', 't': 'removed'})
                    return 200, {'stored': True, 'kind': 'none', 'at': pj['icon_at']}
                if body.get('from') == 'site':
                    if not pj['meta'].get('sites'): return 422, {'error': 'add a website first'}
                    if 'paused' in pj['meta']['sites'][0]: return 422, {'error': 'could not get an icon from the website (it may be paused or down)'}
                    pj['icon_kind'] = 'site'; pj['icon_at'] = 1793500000000 + len(self.calls); return 200, {'stored': True, 'kind': 'site', 'at': pj['icon_at']}
                if body.get('mime') not in ('image/png', 'image/jpeg') or not body.get('data'): return 400, {'error': 'send a PNG or JPEG'}
                self.last_icon = body
                pj['icon_kind'] = 'upload'; pj['icon_at'] = 1793500000000 + len(self.calls); self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'icon', 't': 'uploaded'})
                return 200, {'stored': True, 'kind': 'upload', 'at': pj['icon_at']}
            if 'cost' in q:  # subscriptions / costs
                if method == 'DELETE':
                    for pj in self.pprojects:
                        for c in list(pj.get('costs', [])):
                            if c['id'] == q['cost'][0]: pj['costs'].remove(c); self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'cost_removed', 't': c['name']})
                    return 200, {'ok': True}
                if not body.get('name'): return 400, {'error': 'name required'}
                c = {k: body.get(k) or None for k in ('name', 'currency', 'freq', 'next_due', 'link', 'email')}
                c['amount'] = round(float(body['amount']), 2); c['currency'] = c['currency'] or 'GBP'; c['freq'] = c['freq'] or 'monthly'
                if method == 'POST':
                    pj = [x for x in self.pprojects if x['id'] == body['project_id']][0]
                    c['id'] = str(uuid.uuid4()); pj.setdefault('costs', []).append(c)
                    self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'cost_added', 't': '%s (£%.2f %s)' % (c['name'], c['amount'], c['freq'])})
                    return 201, {'cost': c}
                for pj in self.pprojects:
                    for i, old in enumerate(pj.get('costs', [])):
                        if old['id'] == q['cost'][0]:
                            c['id'] = old['id']; pj['costs'][i] = c
                            self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'cost_changed', 't': c['name']}); return 200, {'cost': c}
                return 404, {'error': 'not found'}
            if method == 'GET':
                if 'events' in q: return 200, {'events': [e for e in self.pevents if e['pid'] == q['events'][0]][::-1]}
                if 'vercel' in q:
                    if q['vercel'][0] == '1': return 200, {'configured': True, 'projects': [{'team': 'teamevo', 'name': 'holmlodge-hub', 'paused': False}, {'team': 'teamevo', 'name': 'old-app', 'paused': True}]}
                    if q['vercel'][0] == 'teamevo/old-app':
                        return 200, {'vercel': 'https://vercel.com/teamevo/old-app', 'sites': ['https://old-app.vercel.app'], 'github': 'https://github.com/Levo54321/old', 'paused': True}
                    return 200, {'vercel': 'https://vercel.com/' + q['vercel'][0], 'sites': ['https://hub.example.com', 'https://holmlodge-hub.vercel.app'], 'github': 'https://github.com/Levo54321/hub', 'paused': False}
                if 'deploy' in q:
                    st = {}
                    for pj in self.pprojects:
                        if pj['meta'].get('vercel'): st[pj['id']] = {'state': 'PAUSED', 'color': 'paused'} if 'old-app' in pj['meta']['vercel'] else {'state': 'READY', 'color': 'green', 'at': 1793490000000}
                    return 200, {'configured': True, 'status': st}
                out = []
                for pj in sorted(self.pprojects, key=lambda x: x.get('pos', 0)):
                    o = dict(pj); o['open'] = len([t for t in self.todos if t.get('pproject_id') == pj['id'] and not t['done']]); o['costs'] = [dict(c) for c in pj.get('costs', [])]; out.append(o)
                return 200, {'projects': out}
            if method == 'POST':
                if any(p['name'].lower() == body['name'].lower() for p in self.pprojects): return 409, {'error': 'a project with that name already exists'}
                pj = {'id': str(uuid.uuid4()), 'name': body['name'], 'status': body.get('status', 'in_progress'), 'created_at': NOW, 'last_at': NOW, 'done_old': 0, 'meta': {},
                      'pos': min([x.get('pos', 0) for x in self.pprojects] + [1]) - 1}
                self.pprojects.append(pj); self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'created', 't': pj['name']}); return 201, {'project': pj}
            if method == 'PATCH' and 'order' in q:
                ids = body.get('ids') or []
                ps = [x for x in self.pprojects if x['id'] in ids]
                if len(ps) != len(ids) or not ids: return 400, {'error': 'bad order'}
                poss = sorted(x.get('pos', 0) for x in ps)
                for i, pid in enumerate(ids): [x for x in ps if x['id'] == pid][0]['pos'] = poss[i]
                return 200, {'pos': {x['id']: x['pos'] for x in ps}}
            pj = [x for x in self.pprojects if x['id'] == q['id'][0]][0]
            if method == 'PATCH':
                if 'name' in body and any(p['name'].lower() == body['name'].lower() and p is not pj for p in self.pprojects): return 409, {'error': 'a project with that name already exists'}
                if 'status' in body: self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'status', 't': pj['status'] + ' -> ' + body['status']})
                for k in ('name', 'status'):
                    if k in body: pj[k] = body[k]
                if 'meta' in body:
                    if (body['meta'].get('reason') or None) != (pj['meta'].get('reason') or None):
                        self.pevents.append({'pid': pj['id'], 'at': NOW, 'k': 'reason', 't': body['meta'].get('reason')})
                    oldicon = pj['meta'].get('icon')
                    pj['meta'] = dict(body['meta'])
                    if oldicon: pj['meta']['icon'] = oldicon
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
        if path == '/api/budget': return 200, {'config': {'bills': [{'n': 'Vercel Pro', 'a': 16, 'd': 3}]}, 'entries': []}
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
                if (u.path == '/api/saver' and 'id' in parse_qs(u.query)) or (u.path == '/api/pprojects' and 'icon' in parse_qs(u.query) and r.request.method == 'GET'):
                    return r.fulfill(status=200, content_type='image/png', body=open(os.path.join(REPO, 'public/favicon-32.png'), 'rb').read())
                return r.fulfill(status=st, content_type='application/json', body=json.dumps(data))
            fp = os.path.join(REPO, 'public', (u.path.lstrip('/') or 'index.html'))
            if not os.path.isfile(fp): return r.fulfill(status=404, body='nf')
            r.fulfill(status=200, content_type=mimetypes.guess_type(fp)[0] or 'text/plain', body=open(fp, 'rb').read())
        ctx.route('**/*', route)
        page = ctx.new_page()
        page.on('pageerror', lambda e: h.errors.append(str(e) + ' @ ' + (e.stack or '')[:300]))
        h.allow = []  # console errors a test causes on purpose (e.g. an expected 422), as substrings
        page.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in h.allow) and h.errors.append('console: ' + m.text))
        page.goto('http://todo.test/'); page.wait_for_timeout(800)
        h.page = page
        results = mod.run(h)
        b.close()
    ok = all(r[1] for r in results)
    for name, passed, info in results: print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else '  -> ' + str(info)))
    print('page errors:', h.errors); print('external requests:', h.external)
    print('ALL PASS' if ok and not h.errors else 'SOMETHING FAILED')

main()
