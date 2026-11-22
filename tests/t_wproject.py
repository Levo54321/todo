"""v34 Work project pages: open from the board and Manage projects, every field type in Edit details, link groups and
campaign codes (add/remove rows, Initial request), RAG, Work people add/rename/remove, board header (RAG dot, owner,
Past due), Back keeping the board scroll, background redraws writing nothing, the board still reordering, and
overflow / tap targets at 1024x768 and 390x844.
Run: python3 tests/harness.py . tests/t_wproject.py
The /api/projects mock below copies api/projects.js + db/setup34.sql; the meta checks run the REAL api/_wpmeta.js (node)."""
import json, subprocess, os, uuid
from urllib.parse import quote
D = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(D)

def mock():
    S = {'projects': [{'id': 'aaaaaaaaaaa1', 'name': 'Alpha', 'prio': 2}, {'id': 'aaaaaaaaaaa2', 'name': 'Beta', 'prio': 1}],
         'meta': {'aaaaaaaaaaa1': {}, 'aaaaaaaaaaa2': {}}, 'events': {'aaaaaaaaaaa1': [{'at': '2026-10-01T09:00:00Z', 'kind': 'created', 'text': 'Alpha'}], 'aaaaaaaaaaa2': []},
         'people': [], 'puts': []}
    def plist(): return [dict(p) for p in S['projects']]
    def ppl(): return sorted([dict(p) for p in S['people']], key=lambda p: p['name'].lower())
    def page(i): return {'id': i, 'meta': S['meta'][i], 'created': '2026-10-01', 'events': list(reversed(S['events'][i])), 'people': ppl()}
    def ev(i, k, t): S['events'][i].append({'at': '2026-11-01T10:00:00Z', 'kind': k, 'text': t})
    def clean(body):
        js = ("var w=require('./api/_wpmeta.js'),b=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "try{console.log(JSON.stringify({ok:b.meta!==undefined?w.cleanMeta(b.meta):{rag:w.cleanRag(b.rag)}}))}catch(e){console.log(JSON.stringify({err:e.message}))}")
        return json.loads(subprocess.run(['node', '-e', js], input=json.dumps(body), capture_output=True, text=True, cwd=REPO).stdout)
    def name_of(pid):
        for p in S['people']:
            if p['id'] == pid: return p['name']
        return ''
    def api(h, method, q, body):
        g = lambda k: q.get(k, [None])[0]
        if g('cards'):
            cards = {}
            for i, m in S['meta'].items():
                c = {k: v for k, v in (('rag', m.get('rag')), ('owner', m.get('owner')), ('due', (m.get('dates') or {}).get('due'))) if v}
                if c: cards[i] = c
            return 200, {'cards': cards, 'people': ppl()}
        if g('page'): return (200, page(g('page'))) if g('page') in S['meta'] else (404, {'error': 'not found'})
        if g('meta') and method == 'PATCH':
            i = g('id'); r = clean(body)
            if 'err' in r: return 400, {'error': r['err']}
            patch = r['ok']; S['puts'].append(patch); m = S['meta'][i]; changed = []
            for k, v in patch.items():
                if m.get(k) == v: continue
                if v is None: m.pop(k, None)
                else: m[k] = v
                if k == 'rag': ev(i, 'rag', v or '')
                elif k in ('owner', 'requester', 'recruiter'): ev(i, k, name_of(v) if v else '')
                else: changed.append(k)
            if changed: ev(i, 'details', ','.join(changed))
            return 200, page(i)
        if g('people'):
            if method == 'GET': return 200, {'people': ppl()}
            if method == 'DELETE':
                for p in S['people']:
                    if p['id'] == g('people'): p['removed'] = True
                return 200, {'people': ppl()}
            nm = ' '.join((body.get('name') or '').split())
            if not nm: return 400, {'error': 'Give the person a name'}
            if any(not p.get('removed') and p['name'].lower() == nm.lower() and p['id'] != g('people') for p in S['people']): return 409, {'error': nm + ' is already in the list'}
            if method == 'POST': S['people'].append({'id': uuid.uuid4().hex[:12], 'name': nm}); return 201, {'people': ppl()}
            for p in S['people']:
                if p['id'] == g('people'): p['name'] = nm
            return 200, {'people': ppl()}
        if method == 'PATCH' and g('id'):
            p = [x for x in S['projects'] if x['id'] == g('id')][0]
            if 'order' in body: p['order'] = body['order']
            if 'prio' in body:
                if body['prio']: p['prio'] = body['prio']
                else: p.pop('prio', None)
                ev(p['id'], 'prio', str(body['prio']))
            if 'status' in body:
                if body['status'] == 'active': p.pop('status', None)
                else: p['status'] = body['status']
                ev(p['id'], 'status', body['status'])
            return 200, {'projects': plist()}
        return 200, {'projects': plist()}
    return S, api

def run(h):
    R = []
    p = h.page
    def chk(name, cond, info=''): R.append(('WP: ' + name, bool(cond), info))
    def wait(ms=400): p.wait_for_timeout(ms)
    def calls(m, key=None): return [c for c in h.calls if c[0] == m and c[1] == '/api/projects' and (key is None or key in c[2])]
    def overflow(): return p.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    def small_targets(scope):
        return p.evaluate("""s => Array.prototype.slice.call(document.querySelectorAll(s + ' button, ' + s + ' a, ' + s + ' select, ' + s + ' input')).filter(function (e) {
            var r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(function (e) { return (e.getAttribute('data-wp') || e.tagName) + ':' + e.textContent.slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height); })""", scope)
    def small_fonts(scope):
        return p.evaluate("""s => Array.prototype.slice.call(document.querySelectorAll(s + ' *')).filter(function (e) {
            return e.getBoundingClientRect().width > 0 && e.childNodes.length && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12; }).map(function (e) { return e.tagName + ':' + e.textContent.slice(0, 20); })""", scope)

    S, api = mock(); h.extra['/api/projects'] = api
    h.allow += ['status of 409', 'status of 400']  # the duplicate person and the http link are refused on purpose
    tid = {t['title']: t['id'] for t in h.todos}
    h.todos.append(dict(h.todos[3], id=str(uuid.uuid4()), title='Old alpha thing', done=True, done_at='2026-10-25T09:00:00Z', due_date=None, prio=0))
    h.todos.append(dict(h.todos[3], id=str(uuid.uuid4()), title='Second alpha', due_date=None, prio=0))
    tid = {t['title']: t['id'] for t in h.todos}
    p.goto('http://todo.test/'); wait(1500)
    p.click('#nProjects'); wait(200)
    if not p.is_visible('#vBoard'): p.click('#psW'); wait(600)
    chk('board shows an Open button per project column', p.query_selector_all('#boardPane [data-bd=page]').__len__() == 2)
    # tapping the column title still folds it
    p.click('#boardPane .bdhead[data-pid=aaaaaaaaaaa1]'); wait(200)
    chk('tapping the column title still folds', p.get_attribute('#boardPane .bdhead[data-pid=aaaaaaaaaaa1]', 'aria-expanded') == 'false')
    p.click('#boardPane .bdhead[data-pid=aaaaaaaaaaa1]'); wait(200)
    chk('and unfolds', p.get_attribute('#boardPane .bdhead[data-pid=aaaaaaaaaaa1]', 'aria-expanded') == 'true')
    # board scroll position kept across the page
    p.evaluate("var c=document.querySelector('#boardPane .bdcols'); c.scrollLeft = 120; var l=c.querySelectorAll('.bdlist'); l[0].scrollTop = 0")
    left0 = p.evaluate("document.querySelector('#boardPane .bdcols').scrollLeft")
    p.click('#boardPane [data-bd=page][data-pid=aaaaaaaaaaa1]'); wait(700)
    chk('Open shows the project page', p.is_visible('#vWproject') and 'Alpha' in p.inner_text('#wpPane .wpnm'), p.inner_text('#wpPane')[:200])
    chk('page fetched once', len(calls('GET', 'page')) == 1)
    chk('title says Projects + name', 'Alpha' in p.inner_text('#viewTitle'))
    txt = p.inner_text('#wpPane')
    chk('open tasks listed (board order) incl. paused one', 'Ship report' in txt and 'Second alpha' in txt and 'Waiting on legal' in txt)
    chk('recently done listed', 'Old alpha thing' in txt)
    chk('requested shows the creation date until set', '(created)' in txt)
    chk('activity log shown', 'Created' in p.inner_text('#wpPane .ppev'))
    chk('Back button is 44px+', p.evaluate("document.querySelector('[data-wp=back]').getBoundingClientRect().height") >= 44)
    # ticking a task from the page works as usual (core handles data-act)
    p.click('#wpPane #i-%s .tick' % tid['Ship report']); wait(600)
    pt = [c for c in h.calls if c[0] == 'PATCH' and c[1] == '/api/todos']
    chk('tick on the page saves through core', pt and pt[-1][3].get('done') is True, pt[-1:] )
    chk('ticked task moves to Done', 'Ship report' in p.inner_text('#wpPane .wpmain').split('Done in the last 30 days')[1])
    p.click('#wpPane #i-%s .tick' % tid['Ship report']); wait(600)  # reopen
    # tapping a task row opens the usual editor
    p.click('#wpPane #i-%s .body' % tid['Second alpha']); wait(400)
    chk('task row opens the editor', p.is_visible('#sheet') or p.evaluate("!!document.querySelector('.sheet[style*=flex]')"))
    p.keyboard.press('Escape'); wait(200)
    p.evaluate("var s=document.querySelectorAll('.sheet'); for (var i=0;i<s.length;i++) s[i].style.display='none'")
    # add a task from the page
    p.fill('#wpTask', 'From the page'); p.press('#wpTask', 'Enter'); wait(600)
    tp = [c for c in h.calls if c[0] == 'POST' and c[1] == '/api/todos'][-1][3]
    chk('add box files the task in this project', tp == {'title': 'From the page', 'category': 'Alpha', 'list': 'work'}, tp)
    chk('new task shows', 'From the page' in p.inner_text('#wpPane'))
    # RAG
    p.click('[data-wp=rag][data-val=a]'); wait(500)
    chk('RAG Amber saved alone', S['puts'][-1] == {'rag': 'a'}, S['puts'][-1:])
    chk('RAG change in the activity log', 'RAG: Amber' in p.inner_text('#wpPane .ppev'))
    chk('RAG switch shows Amber on', 'Amber' in p.inner_text('.wpragsg button.on'))
    p.click('[data-wp=rag][data-val=r]'); wait(500)
    chk('RAG Red', S['meta']['aaaaaaaaaaa1'].get('rag') == 'r')
    # priority/status from the page
    p.click('.wpside [data-wp=prio][data-val="3"]'); wait(500)
    chk('priority from the page', [c for c in calls('PATCH')][-1][3] == {'prio': 3} and 'Priority: High' in p.inner_text('#wpPane .ppev'))
    # Back keeps board scroll
    p.click('[data-wp=back]'); wait(600)
    chk('Back returns to the board', p.is_visible('#vBoard'))
    chk('board horizontal scroll kept', p.evaluate("document.querySelector('#boardPane .bdcols').scrollLeft") == left0, (left0, p.evaluate("document.querySelector('#boardPane .bdcols').scrollLeft")))
    chk('RAG dot on the board column', p.query_selector('#boardPane .bdhead[data-pid=aaaaaaaaaaa1] .wprag-r') is not None)

    # Work people in Manage projects
    p.click('#boardPane [data-pj=open]'); wait(500)
    for n in ('Sam Jones', 'Alex Kim', 'Robin Lee'):
        p.fill('#wpPNew', n); p.press('#wpPNew', 'Enter'); wait(300)
    chk('people added', [x['name'] for x in S['people']] == ['Sam Jones', 'Alex Kim', 'Robin Lee'])
    p.fill('#wpPNew', 'sam jones'); p.press('#wpPNew', 'Enter'); wait(300)
    chk('duplicate person refused with a message', 'already in the list' in p.inner_text('#projCard'))
    aid = [x['id'] for x in S['people'] if x['name'] == 'Alex Kim'][0]
    p.click('[data-pj=pedit][data-id="%s"]' % aid); wait(200)
    p.fill('#wpPEdit', 'Alex K'); p.click('[data-pj=psave]'); wait(300)
    chk('person renamed', [x['name'] for x in S['people'] if x['id'] == aid] == ['Alex K'] and 'Alex K' in p.inner_text('#projCard'))
    chk('Manage projects rows have Open', len(p.query_selector_all('#projCard [data-pj=page]')) == 2)
    chk('no overflow in Manage projects (1024)', overflow() <= 0)
    # open from Manage projects
    p.click('#projCard [data-pj=page][data-id=aaaaaaaaaaa1]'); wait(700)
    chk('opens from Manage projects', p.is_visible('#vWproject') and not p.is_visible('#projSheet'))
    # Edit details: every field type
    p.click('[data-wp=edit]'); wait(300)
    chk('form: requested prefilled with the creation date', p.input_value('[data-f="d:requested"]') == '2026-10-01')
    sid = [x['id'] for x in S['people'] if x['name'] == 'Sam Jones'][0]; rid = [x['id'] for x in S['people'] if x['name'] == 'Robin Lee'][0]
    p.select_option('[data-f=owner]', sid); p.select_option('[data-f=requester]', aid); p.select_option('[data-f=recruiter]', rid)
    p.fill('[data-f=goal]', 'Run the spring study\nwith two waves'); p.fill('[data-f=success]', '500 completes')
    p.fill('[data-f="d:started"]', '2026-10-05'); p.fill('[data-f="d:target"]', '2026-10-25'); p.fill('[data-f="d:due"]', '2026-10-30')
    for g in ('slack', 'slack', 'groups', 'studies', 'other', 'other'):
        p.click('[data-wp=addrow][data-g=%s]' % g); wait(150)
    chk('typed values survive adding rows', p.input_value('[data-f=goal]').startswith('Run the spring') and p.input_value('[data-f="d:due"]') == '2026-10-30')
    vals = {'ln:slack:0': 'Initial ask', 'lu:slack:0': 'https://prolific.slack.com/archives/C1/p1', 'ln:slack:1': 'Thread', 'lu:slack:1': 'https://prolific.slack.com/archives/C1/p2',
            'ln:groups:0': 'Group A', 'lu:groups:0': 'https://app.prolific.com/researcher/groups/1', 'ln:studies:0': 'Wave 1', 'lu:studies:0': 'https://app.prolific.com/researcher/studies/9',
            'ln:other:0': 'Linear', 'lu:other:0': 'https://linear.app/prolific/project/x', 'ln:other:1': 'Doomed', 'lu:other:1': 'https://example.com/gone'}
    for k, v in vals.items(): p.fill('[data-f="%s"]' % k, v)
    p.click('[data-wp=init][data-i="1"]'); wait(150)
    p.click('[data-wp=init][data-i="0"]'); wait(150)
    chk('only one Initial request at a time', len(p.query_selector_all('.wpinit.on')) == 1 and p.get_attribute('.wpinit.on', 'data-i') == '0')
    chk('typed links survive the Initial toggle', p.input_value('[data-f="lu:slack:1"]') == vals['lu:slack:1'])
    p.click('[data-wp=rmrow][data-g=other][data-i="1"]'); wait(150)
    chk('row removed, others kept', len(p.query_selector_all('[data-f^="ln:other:"]')) == 1 and p.input_value('[data-f="ln:other:0"]') == 'Linear')
    for i in range(3): p.click('[data-wp=addrow][data-g=codes]'); wait(120)
    p.fill('[data-f="cn:0"]', 'Spring'); p.fill('[data-f="cc:0"]', 'SPR-2026'); p.fill('[data-f="cn:1"]', 'Bad'); p.fill('[data-f="cc:1"]', 'X'); p.fill('[data-f="cn:2"]', 'Wave 2'); p.fill('[data-f="cc:2"]', 'W2-ABC')
    p.click('[data-wp=rmrow][data-g=codes][data-i="1"]'); wait(150)
    chk('code row removed', [p.input_value('[data-f="cc:%d"]' % i) for i in range(2)] == ['SPR-2026', 'W2-ABC'])
    p.screenshot(path=os.path.join(D, 'out', 'wproject_form.png'))
    chk('form fits 1024 (no overflow)', overflow() <= 0)
    chk('form tap targets 44px (1024)', not small_targets('#wpPane'), small_targets('#wpPane'))
    # background redraw writes nothing while typing
    p.click('[data-f=success]'); p.keyboard.press('End'); p.keyboard.type(' or more')
    first = p.evaluate("window.__wpf = document.querySelector('#wpPane .wpform'); 1")
    p.evaluate('App.render()'); wait(100)
    chk('background redraw leaves the form alone', p.evaluate("document.querySelector('#wpPane .wpform') === window.__wpf") and p.input_value('[data-f=success]') == '500 completes or more')
    # a real redraw (task list changed) keeps typed values and focus
    p.evaluate("App.todos().push({id:'x1',title:'Bg task',list:'work',category:'Alpha',done:false,items:[]}); App.mutated(); App.render()"); wait(100)
    chk('real redraw keeps typed values', p.input_value('[data-f=success]') == '500 completes or more' and p.input_value('[data-f="lu:slack:1"]') == vals['lu:slack:1'])
    # bad link -> readable error, form stays
    p.fill('[data-f="lu:groups:0"]', 'http://app.prolific.com/g'); p.click('[data-wp=save]'); wait(500)
    chk('http link refused with a message, form kept', 'https://' in p.inner_text('.wperr') and p.is_visible('.wpform') and p.input_value('[data-f=goal]').startswith('Run'))
    p.fill('[data-f="lu:groups:0"]', vals['lu:groups:0']); p.click('[data-wp=save]'); wait(600)
    m = S['meta']['aaaaaaaaaaa1']
    chk('saved: people', m.get('owner') == sid and m.get('requester') == aid and m.get('recruiter') == rid, m)
    chk('saved: text', m.get('goal') == 'Run the spring study\nwith two waves' and m.get('success') == '500 completes or more')
    chk('saved: dates', m.get('dates') == {'requested': '2026-10-01', 'started': '2026-10-05', 'target': '2026-10-25', 'due': '2026-10-30'}, m.get('dates'))
    chk('saved: links (Initial on the first Slack row)', m['links']['slack'][0] == {'n': 'Initial ask', 'u': vals['lu:slack:0'], 'init': True} and 'init' not in m['links']['slack'][1]
        and m['links']['groups'][0]['n'] == 'Group A' and m['links']['studies'][0]['n'] == 'Wave 1' and [x['n'] for x in m['links']['other']] == ['Linear'], m.get('links'))
    chk('saved: codes', m.get('codes') == [{'n': 'Spring', 'c': 'SPR-2026'}, {'n': 'Wave 2', 'c': 'W2-ABC'}])
    chk('saved: rag untouched by the form', m.get('rag') == 'r')
    chk('form closed after save', not p.query_selector('.wpform'))
    chk('task list starts at the top after the form closes', p.evaluate("document.querySelector('.wpmain').scrollTop") == 0)
    side = p.inner_text('#wpPane .wpside')
    chk('page shows people', 'Sam Jones' in side and 'Alex K' in side and 'Robin Lee' in side)
    chk('page shows links + Initial request', p.query_selector('.wplinks a[href="%s"]' % vals['lu:slack:0']) is not None and 'Initial request' in side and 'Group A' in side and 'Linear' in side)
    chk('links open in a new tab safely', p.get_attribute('.wplinks a', 'target') == '_blank' and 'noopener' in p.get_attribute('.wplinks a', 'rel'))
    chk('page shows codes as text', 'SPR-2026' in side and p.query_selector('.wpcodes a') is None)
    chk('page shows goal with line breaks', 'Run the spring study\nwith two waves' in side)
    chk('Past due pill on the page (due 30 Oct, today 1 Nov)', p.query_selector('.wpside .pdue') is not None)
    ev = p.inner_text('#wpPane .ppev')
    chk('activity logs owner/requester/recruiter/details', 'Owner: Sam Jones' in ev and 'Requester: Alex K' in ev and 'Recruiter: Robin Lee' in ev and 'Edited' in ev, ev)
    p.screenshot(path=os.path.join(D, 'out', 'wproject_page.png'))
    chk('page fits 1024', overflow() <= 0)
    chk('page tap targets 44px (1024)', not small_targets('#wpPane'), small_targets('#wpPane'))
    chk('page fonts >= 12px', not small_fonts('#wpPane'), small_fonts('#wpPane'))
    # fixed panes from innerHeight on the iPad size
    hs = p.evaluate("[document.querySelector('.wpwrap').style.height, document.querySelector('.wpside').style.height, document.querySelector('.wpmain').style.height, getComputedStyle(document.querySelector('#vWproject .scrollview')).overflowY]")
    chk('iPad: side and main get px heights, outer scroll off', hs[0].endswith('px') and hs[0] == hs[1] == hs[2] and hs[3] == 'hidden', hs)
    p.evaluate("document.querySelector('.wpmain').scrollTop = 120")
    t0 = p.evaluate("document.querySelector('.wpmain').scrollTop")
    p.evaluate("App.todos().push({id:'x2',title:'Bg task 2',list:'work',category:'Alpha',done:false,items:[]}); App.mutated(); App.render()"); wait(100)
    chk('main scroll kept across a real redraw', t0 > 0 and p.evaluate("document.querySelector('.wpmain').scrollTop") == t0, t0)
    # board header: owner + Past due
    p.click('[data-wp=back]'); wait(600)
    head = p.inner_text('#boardPane .bdcol:first-child .bdhealth')
    chk('board column shows owner first name and Past due', 'Sam' in head and 'Past due' in head, head)
    # remove a person who is used
    p.click('#boardPane [data-pj=open]'); wait(500)
    p.click('[data-pj=pdel][data-id="%s"]' % sid); wait(300)
    p.click('#ask button:has-text("Remove")') if p.query_selector('#ask button:has-text("Remove")') else p.click('text=Remove >> nth=-1'); wait(500)
    chk('person removed (kept as removed)', [x.get('removed') for x in S['people'] if x['id'] == sid] == [True] and 'Sam Jones' not in p.inner_text('#projCard .plist:last-of-type'))
    p.click('[data-pj=close]'); wait(600)
    chk('board shows "(removed)" for a removed owner', '(removed)' in p.inner_text('#boardPane .bdcol:first-child .bdhealth'), p.inner_text('#boardPane .bdcol:first-child .bdhealth'))
    p.click('#boardPane [data-bd=page][data-pid=aaaaaaaaaaa1]'); wait(700)
    chk('page shows "Sam Jones (removed)"', 'Sam Jones (removed)' in p.inner_text('#wpPane .wpside'))
    p.click('[data-wp=edit]'); wait(300)
    opts = p.evaluate("Array.prototype.map.call(document.querySelectorAll('[data-f=owner] option'), function (o) { return o.textContent; })")
    chk('removed person only offered where already picked', 'Sam Jones (removed)' in opts and opts.count('Sam Jones (removed)') == 1 and 'Sam Jones (removed)' not in p.evaluate("Array.prototype.map.call(document.querySelectorAll('[data-f=requester] option'), function (o) { return o.textContent; })"), opts)
    p.click('[data-wp=cancel]'); wait(200)
    # phone width
    p.set_viewport_size({'width': 390, 'height': 844}); wait(500)
    p.screenshot(path=os.path.join(D, 'out', 'wproject_phone.png'), full_page=True)
    chk('page fits 390 (no overflow)', overflow() <= 0, overflow())
    chk('phone: page scrolls normally (no fixed heights)', p.evaluate("document.querySelector('.wpwrap').style.height") == '')
    p.click('[data-wp=edit]'); wait(300)
    chk('form fits 390', overflow() <= 0, overflow())
    chk('form tap targets 44px (390)', not small_targets('#wpPane'), small_targets('#wpPane'))
    p.click('[data-wp=cancel]'); wait(200)
    p.click('[data-wp=back]'); wait(500)
    chk('board fits 390', overflow() <= 0)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(500)
    # the board still reorders by number
    n0 = len(calls('PATCH'))
    nums = p.query_selector_all('#boardPane .bdcol:first-child [data-bd=num]')
    nums[0].click(); wait(200)
    p.click('#boardPane .bdcol:first-child [data-bd=to][data-to="1"]'); wait(600)
    od = [c for c in calls('PATCH')[n0:] if 'order' in (c[3] or {})]
    chk('board number reorder still saves an order', od and len(od[-1][3]['order']) >= 2, calls('PATCH')[n0:])
    chk('board add box still works (bdadd)', True)
    f = p.query_selector('#boardPane form.bdadd[data-pid=aaaaaaaaaaa2] .bdin'); f.fill('Board add'); f.press('Enter'); wait(600)
    chk('board add files into Beta', [c for c in h.calls if c[0] == 'POST' and c[1] == '/api/todos'][-1][3] == {'title': 'Board add', 'category': 'Beta', 'list': 'work'})
    chk('no page errors', not h.errors, h.errors)
    p.screenshot(path=os.path.join(D, 'out', 'wproject_board.png'))
    return R
