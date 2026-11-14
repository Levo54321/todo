"""Playwright mock harness for luc-todo. Serves public/ and mocks /api/* with an in-memory store.
Usage (from the repo root): python3 tests/harness.py . tests/t_projects.py   (a test module exposes run(h))
Needs: pip install playwright (Chromium: set CHROME=/path/to/chrome or run python3 -m playwright install chromium)."""
import json, os, sys, uuid, datetime, importlib.util, mimetypes, re, hashlib
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
        self.same = 0  # how many GET /api/todos?v= were answered "same" (unchanged)
        self.imports = []  # CSV import history (todo_imports)
        self.scan = None  # a scanned photo waiting for review: {id, csv, n, created_at, status}
        self.proj_posts = []  # names POSTed to /api/projects (import creating new projects)
        self.fail_bulk = False  # make the real (non-dry) CSV import answer 500
        self.fail_delete = False  # make DELETE /api/todos answer 500 (the task stays on the server)
        self.errors = []
        self.extra = {}
        self.jstages = None  # Jobs tab: pipeline stages (created on first GET like the database does)
        self.jjobs = []
        self.jevents = {}
        self.feedcfg = {'keywords': ['AI ops'], 'skills': ['RLHF', 'LLM'], 'last_run': None, 'last_added': 0, 'last_err': ''}; self.feed_added = []  # Reed feed mock
        self.cvprof = {'name': {'first': 'Test', 'last': 'Person'}, 'title': 'Program Manager', 'contact': {'address': 'London'}, 'profile': 'Runs programs.', 'highlights': ['One win'],
                       'experience': [{'type': 'role', 'title': 'Lead', 'company': 'Acme', 'start': 'May 2025', 'end': 'Present', 'location': 'London', 'bullets': ['Did a', 'Did b']}, {'type': 'role', 'title': 'Analyst', 'company': 'Beta', 'start': 'Jan 2020', 'end': 'May 2025', 'location': 'Cardiff', 'bullets': ['Did c']}],
                       'core_skills': ['SQL'], 'software': [{'name': 'Excel', 'level': 85}], 'qualifications': [], 'additional_experience': [], 'domains': ['AI'], 'references': []}
        self.jleads = []  # Jobs Discover: [{id, source, role, company, location, mode, url, created_at}]
        self.fail_jobs = False  # make GET /api/pprojects?jobs answer 500
        self.vault = {'configured': True, 'pw': None, 'pass': None, 'n': 0, 'fails': 0, 'entries': {}, 'gets': 0}
    def find(self, i):
        for t in self.todos:
            if t['id'] == i: return t
    def api(self, method, path, q, body):
        self.calls.append((method, path, q, body))
        if path in self.extra: return self.extra[path](self, method, q, body)
        if path == '/api/todos':
            if method == 'GET' and 'scan' in q:  # newest scan still waiting for review (todo_scan_latest)
                return 200, {'scan': ({'id': self.scan['id'], 'csv': self.scan['csv'], 'n': self.scan['n'], 'created_at': self.scan['created_at'], 'done': self.scan.get('done') or {}} if self.scan and self.scan.get('status') != 'done' else None)}
            if method == 'POST' and 'scan_done' in q:
                if self.scan and self.scan['id'] == q['scan_done'][0]: self.scan['status'] = 'done'
                return 200, {'ok': True}
            if method == 'GET' and 'import_csv' in q:
                b = [x for x in self.imports if x['id'] == q['import_csv'][0]]
                return (200, {'name': b[0]['name'], 'csv': b[0]['csv']}) if b and b[0].get('csv') else (404, {'error': 'no copy saved'})
            if method == 'GET' and 'imports' in q:
                ids = {t['id'] for t in self.todos}
                return 200, {'imports': [{'id': x['id'], 'name': x['name'], 'n': x['n'], 'created_at': x['created_at'], 'undone_at': x['undone_at'], 'undone_n': x['undone_n'], 'has_csv': bool(x.get('csv')), 'alive': len([i for i in x['ids'] if i in ids])} for x in reversed(self.imports)]}
            if method == 'POST' and 'import_undo' in q:  # mirrors todo_import_undo
                b = [x for x in self.imports if x['id'] == q['import_undo'][0]]
                if not b: return 404, {'error': 'not found'}
                if b[0]['undone_at']: return 409, {'error': 'already undone'}
                before = len(self.todos); self.todos = [t for t in self.todos if t['id'] not in b[0]['ids']]
                b[0]['undone_at'] = NOW; b[0]['undone_n'] = before - len(self.todos)
                return 200, {'ok': True, 'removed': b[0]['undone_n'], 'added': b[0]['n'], 'cal': None}
            if method == 'GET':
                v = hashlib.sha1(json.dumps(self.todos, sort_keys=True).encode()).hexdigest()[:20]  # like api/todos.js: fingerprint of the list, not of `now`
                if q.get('v', [None])[0] == v: self.same += 1; return 200, {'same': True, 'today': TODAY, 'now': NOW}
                return 200, {'today': TODAY, 'now': NOW, 'v': v, 'todos': self.todos}
            if method == 'POST' and 'bulk' in q:  # CSV import: the REAL api/_bulk.js judges the rows (node), the mock only stores them
                import subprocess
                js = "var b=require('./api/_bulk.js'),i=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(i.rows.map(function(r,k){var v=b.validateRow(r,i.today);return {row:typeof r.row==='number'?r.row:k+2,errors:v.errors,value:v.value}})))"
                out = json.loads(subprocess.run(['node', '-e', js], input=json.dumps({'rows': body.get('rows') or [], 'today': TODAY}), capture_output=True, text=True, cwd=REPO).stdout)
                for o in out:
                    if o['value'].get('id') and not self.find(o['value']['id']): o['errors'].append('no task with that id (was it deleted?)')
                errs = [{'row': o['row'], 'messages': o['errors']} for o in out if o['errors']]
                prev = [{'row': o['row'], 'errors': o['errors'], 'value': o['value']} for o in out]
                if errs: return 400, {'ok': False, 'dry': body.get('dry') is True, 'count': len(out), 'errors': errs, 'added': 0, 'preview': prev}
                if body.get('dry') is True: return 200, {'ok': True, 'dry': True, 'count': len(out), 'errors': [], 'added': 0, 'preview': prev}
                if self.fail_bulk: return 500, {'ok': False, 'error': 'stopped', 'added': 0}
                new_ids = []; upd = 0
                M = {'title': 'title', 'list': 'list', 'category': 'category', 'due_date': 'due_date', 'remind_time': 'remind_time', 'repeat': 'recur', 'priority': 'prio', 'quick': 'quick', 'must_today': 'must', 'notes': 'notes', 'subtasks': 'items'}
                for o in out:
                    v = o['value']
                    if v.get('id'):  # mirrors bulkImport: update only the columns present in the row
                        tt = self.find(v['id'])
                        for c in v['present']: tt[M[c]] = v['subtasks'] if c == 'subtasks' else v[M[c]]
                        upd += 1; continue
                    t = task(v['title'], list=v['list'], category=v['category'], due_date=v['due_date'], remind_time=v['remind_time'], recur=v['recur'], prio=v['prio'], quick=v['quick'], must=v['must'], notes=v['notes'] or None, items=v['subtasks'])
                    self.todos.append(t); new_ids.append(t['id'])
                if body.get('batch'):  # mirrors todo_import_log: same batch id extends the same import
                    b = [x for x in self.imports if x['id'] == body['batch']]
                    if not new_ids: pass
                    elif b: b[0]['ids'] += new_ids; b[0]['n'] += len(new_ids)
                    else: self.imports.append({'id': body['batch'], 'name': body.get('name') or '', 'n': len(new_ids), 'ids': list(new_ids), 'created_at': NOW, 'undone_at': None, 'undone_n': None, 'csv': body.get('csv')})
                return 201, {'ok': True, 'dry': False, 'count': len(out), 'errors': [], 'added': len(out) - upd, 'updated': upd, 'cal': None, 'logged': True}
            if method == 'POST':
                title = body.get('text') or body.get('title')
                t = task(title, list='work' if (re.search(r'\swork$', title or '') or body.get('list') == 'work') else 'personal')
                if body.get('pproject_id') and t['list'] == 'personal': t['pproject_id'] = body['pproject_id']; t['pp_backlog'] = body.get('pp_backlog') is True
                if body.get('category'): t['category'] = body['category']
                self.todos.append(t); return (201 if body.get('title') else 200), {'todo': t}  # real server: 201 (board add sends title+category)
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
                if self.fail_delete: return 500, {'error': 'upstream error'}
                self.todos = [t for t in self.todos if t['id'] != q['id'][0]]; return 200, {'ok': True}
        if path == '/api/pprojects' and 'jobs' in q:  # mirrors api/_jobs.js + db/setup26.sql (the SQL itself was tested in the database)
            if self.jstages is None:
                self.jstages = [{'id': 'st%d' % i, 'name': n, 'color': c, 'kind': k, 'follow_days': f, 'pos': i} for i, (n, c, k, f) in enumerate([('Saved', 'sand', 'active', None), ('Applied', 'clay', 'active', 7), ('Screening', 'ochre', 'active', None), ('Interview', 'sage', 'active', None), ('Offer', 'moss', 'won', None), ('Closed', 'stone', 'lost', None)])]
            what = q['jobs'][0]
            def order(): return sorted(self.jjobs, key=lambda j: (j['pos'], j['updated_at']), reverse=False)
            def put(job, src):
                jid = job.get('id')
                if jid:
                    j = [x for x in self.jjobs if x['id'] == jid][0]
                    for k, v in job.items():
                        if k in ('id', 'stage_id'): continue
                        j[k] = v if v != '' or k not in ('next_on', 'applied_on') else None
                    if job.get('stage_id') and job['stage_id'] != j['stage_id']:
                        j['stage_id'] = job['stage_id']; j['pos'] = min([x['pos'] for x in self.jjobs if x['stage_id'] == j['stage_id']] + [1]) - 1
                        if j['applied_on'] is None and job['stage_id'] != self.jstages[0]['id']: j['applied_on'] = '2026-11-14'
                        self.jevents.setdefault(jid, []).insert(0, {'at': '2026-11-14T10:00:00Z', 'kind': 'stage', 'text': [x for x in self.jstages if x['id'] == job['stage_id']][0]['name']})
                    return j
                sid = job.get('stage_id') or self.jstages[0]['id']
                j = {'id': 'job%d' % (len(self.jjobs) + 1), 'company': '', 'role': '', 'location': '', 'mode': '', 'salary': '', 'url': '', 'source': src, 'stage_id': sid, 'contact': '', 'cv_variant': '', 'notes': '', 'next_step': '', 'next_on': None, 'next_at': '', 'applied_on': None,
                     'pos': min([x['pos'] for x in self.jjobs if x['stage_id'] == sid] + [1]) - 1, 'created_at': '2026-11-14T09:00:00Z', 'updated_at': '2026-11-14T09:00:00Z'}
                for k, v in job.items():
                    if k in j and k != 'stage_id': j[k] = v if v != '' or k not in ('next_on', 'applied_on') else None
                self.jjobs.append(j); self.jevents[j['id']] = [{'at': '2026-11-14T09:00:00Z', 'kind': 'added', 'text': [x for x in self.jstages if x['id'] == sid][0]['name'] + ' \u00b7 ' + src}]
                return j
            if what == 'stages':
                new = []
                for i, st in enumerate(body['stages']):
                    sid = st.get('id') or 'st_new%d_%d' % (i, len(self.calls))
                    new.append({'id': sid, 'name': st['name'], 'color': st['color'], 'kind': st['kind'], 'follow_days': st['follow_days'], 'pos': i})
                keep = [x['id'] for x in new]
                for j in self.jjobs:
                    if j['stage_id'] not in keep: j['stage_id'] = keep[0]
                self.jstages = new; return 200, {'stages': new, 'jobs': order()}
            if what == 'enrich':
                j = [x for x in self.jjobs if x['id'] == body.get('id')][0]; self.enrich_calls = getattr(self, 'enrich_calls', 0) + 1
                j.setdefault('details', {})['ai'] = {'summary': 'Runs research ops.', 'requirements': ['5 years in ops', 'SQL'], 'nice_to_have': ['RLHF'], 'skills': ['SQL', 'Python']}
                return 200, {'details': j['details']}
            if what == 'profile':
                if method == 'POST':
                    if not isinstance(body.get('profile'), dict): return 400, {'error': 'profile must be an object'}
                    self.cvprof = body['profile']
                return 200, {'profile': self.cvprof, 'updated_at': '2026-11-14T10:00:00Z'}
            if what == 'feedcfg':
                if method == 'POST': self.feedcfg = dict(self.feedcfg, keywords=body['keywords'], skills=body['skills'])
                return 200, {'cfg': self.feedcfg}
            if what == 'feed':
                self.feedcfg['last_run'] = '2026-11-14T09:00:00Z'
                if body.get('force') is not True and self.feedcfg.get('fresh'): return 200, {'skipped': True}
                self.jleads += self.feed_added; n = len(self.feed_added); self.feed_added = []
                return 200, {'added': n, 'skipped': 0, 'failed': 0}
            if what == 'quick':
                return 201, {'job': put({'role': body.get('text', 'Saved job'), 'url': body.get('url', '')}, 'share')}
            if method == 'GET' and what not in ('stats', 'leads', 'lead', 'feedcfg', 'feed', 'profile'):
                if self.fail_jobs: return 500, {'error': 'upstream error'}
                if 'id' in q:
                    j = [x for x in self.jjobs if x['id'] == q['id'][0]][0]; return 200, {'job': j, 'events': self.jevents.get(j['id'], [])}
                return 200, {'stages': self.jstages, 'jobs': order(), 'new_leads': len(self.jleads)}
            if what == 'lead':
                l = [x for x in self.jleads if x['id'] == q['id'][0]][0]
                return 200, {'lead': dict(l, details=dict(l.get('meta', {}), description=l.get('desc', 'Full advert text'))), 'detail_error': ''}
            if what == 'leads':
                if method == 'GET': return 200, {'leads': list(self.jleads)}
                if body.get('action') == 'like':
                    [x for x in self.jleads if x['id'] == body.get('id')][0]['vote'] = 1; return 200, {'ok': True, 'lead_id': body.get('id'), 'vote': 1}
                l = [x for x in self.jleads if x['id'] == body.get('id')][0]; self.jleads = [x for x in self.jleads if x is not l]
                if body.get('action') == 'dismiss': return 200, {'ok': True, 'lead_id': l['id']}
                return 200, {'job': put({'role': l['role'], 'company': l['company'], 'location': l['location'], 'url': l['url']}, l['source']), 'lead_id': l['id'], 'tasks': {}}
            if what == 'stats':  # shape of api/_jobs.js computeStats (the maths is tested in tests/jobs_links_node.js)
                n = len(self.jjobs); ap = len([j for j in self.jjobs if j.get('applied_on')])
                return 200, {'stats': {'summary': {'total': n, 'applied': ap, 'heard': 1 if ap else 0, 'rate': 50 if ap else None, 'offers': 0, 'closed': 0, 'active': ap},
                    'funnel': [{'name': 'Saved', 'color': 'sand', 'kind': 'active', 'count': n}, {'name': 'Applied', 'color': 'clay', 'kind': 'active', 'count': ap}, {'name': 'Screening', 'color': 'ochre', 'kind': 'active', 'count': 1 if ap else 0}],
                    'weeks': [{'start': '2026-%02d-%02d' % (9 + i // 4, 7 + (i % 4) * 7), 'n': i % 3} for i in range(8)],
                    'time': [{'name': 'Saved', 'color': 'sand', 'days': 3.5, 'n': n}, {'name': 'Applied', 'color': 'clay', 'days': 8.1, 'n': ap}],
                    'sources': [{'source': 'manual', 'total': n, 'applied': ap, 'heard': 1 if ap else 0, 'rate': 50 if ap else None}], 'lost': 0, 'today': '2026-11-14'}}
            def tk(b):  # the real API makes/updates a to-do when a next step has a date
                return {'next': 'created'} if b.get('next_on') else {}
            if method == 'POST': return 201, {'job': put(body, 'manual'), 'tasks': tk(body)}
            if method == 'PATCH': b = dict(body); b['id'] = q['id'][0]; return 200, {'job': put(b, 'manual'), 'tasks': tk(b)}
            if method == 'DELETE': self.jjobs = [x for x in self.jjobs if x['id'] != q['id'][0]]; return 200, {'ok': True}
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
            if method == 'POST' and body.get('name'): self.proj_posts.append(body['name'])
            return 200, {'projects': [{'id': 'p1', 'name': 'Alpha', 'prio': 2, 'status': 'active'}, {'id': 'p2', 'name': 'Beta', 'prio': 1, 'status': 'active'}] + [{'id': 'px%d' % i, 'name': n, 'prio': 0, 'status': 'active'} for i, n in enumerate(self.proj_posts)]}
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
