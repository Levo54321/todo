"""v1088 Work projects, new section (public/wp/main.js): list always on screen, overview (list / task board), project page replacing the overview,
inline editing (Enter, Escape, Tab), pasting a Linear link, deliverables and progress, Next task, ticking through the core, the legacy view switch, idle
redraws writing nothing, overflow and tap targets at 1440x900 and 390x844. The /api/projects mock runs the REAL api/_wpmeta.js + api/_wv2.js through node.
Run: python3 tests/harness.py . tests/t_wpx.py"""
import json, os, subprocess, uuid
D = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(D)
LIN = 'https://linear.app/prolific/issue/HDOR-394/uber-users-in-new-orleans-and-san-fran'

def mk(i): return '%012x' % i
def node(js, data):
    return json.loads(subprocess.run(['node', '-e', "var w=require('./api/_wpmeta.js'),V=require('./api/_wv2.js'),d=JSON.parse(require('fs').readFileSync(0,'utf8'));" + js], input=json.dumps(data), capture_output=True, text=True, cwd=REPO).stdout)

def mock():
    P = [('Uber users in NOLA and SF', 3, 'a', '2026-11-27'), ('Gig workers in Chicago', 2, 'g', '2026-12-01'), ('Healthcare UK', 2, 'r', '2026-11-05'),
         ('Gen Z gamers', 1, 'a', '2026-11-30'), ('Spanish bilinguals', 0, 'g', None), ('Fraud screener', 0, None, None)]
    S = {'list': [], 'puts': [], 'next': {}, 'upd': {}, 'nexts': []}
    people = [{'id': mk(900 + i), 'name': n} for i, n in enumerate(['Luc Evans', 'Priya Nair', 'Sam Okafor'])]
    clients = [{'id': mk(800), 'name': 'Uber', 'n': 2}]
    for i, (n, pr, rag, due) in enumerate(P):
        m = {'requester': mk(901), 'owner': mk(900), 'dates': {'requested': '2026-10-28'}}
        if rag: m['rag'] = rag
        if due: m['dates']['due'] = due
        if i < 2: m['client'] = mk(800)
        if i == 0:
            m['links'] = {'slack': [{'n': 'Request', 'u': 'https://prolific-ac.slack.com/archives/C1/p1', 'init': True, 'k': 'request'}],
                          'studies': [{'n': 'Main', 'u': 'https://app.prolific.com/researcher/workspaces/projects/6aeb6766bf02a709f13d86fd', 'k': 'prolific_project', 'id': '6aeb6766bf02a709f13d86fd'}]}
            m['deliver'] = [{'n': 'San Francisco', 'requested': 600, 'provided': 530, 'approved': 396}, {'n': 'New Orleans', 'requested': 400, 'provided': 261, 'approved': 195}]
            m['activity'] = {'last_slack': {'at': '2026-10-30T16:42:00Z', 'who': 'Priya Nair', 'where': '#ops', 'text': 'NOLA at 261, need 400 by Fri'}}
        S['list'].append({'id': mk(100 + i), 'name': n, 'prio': pr, 'status': 'active', 'pos': i + 1, 'meta': m, 'last': None})
    def prj(i): return [p for p in S['list'] if p['id'] == i][0]
    def api(h, method, q, body):
        g = lambda k: q.get(k, [None])[0]
        if g('v2') == 'overview': return 200, {'projects': json.loads(json.dumps(S['list'])), 'people': people, 'clients': clients}
        if g('next') and method == 'PATCH':
            S['nexts'].append((g('next'), body.get('task'))); prj(g('next'))['next'] = body.get('task'); return 200, {'id': g('next'), 'next': body.get('task')}
        if g('meta') and method == 'PATCH':
            p = prj(g('id')); r = node("try{var pt=w.cleanMeta(d.meta);pt=V.enrich(d.cur,pt,'2026-11-01');console.log(JSON.stringify({ok:pt}))}catch(e){console.log(JSON.stringify({err:e.message}))}", {'meta': body['meta'], 'cur': p['meta']})
            if 'err' in r: return 400, {'error': r['err']}
            S['puts'].append(r['ok'])
            for k, v in r['ok'].items():
                if v is None: p['meta'].pop(k, None)
                else: p['meta'][k] = v
            return 200, {'id': p['id'], 'meta': p['meta'], 'people': people, 'clients': clients, 'events': [], 'created': '2026-10-28'}
        if method == 'PATCH' and g('id'):
            p = prj(g('id'))
            if 'status' in body: p['status'] = body['status']
            if 'prio' in body: p['prio'] = body['prio']
            return 200, {'projects': [{'id': x['id'], 'name': x['name'], 'prio': x['prio'], 'status': x['status']} for x in S['list']]}
        if g('updates') is not None and method == 'GET': return 200, {'updates': S['upd'].get(g('updates'), [])}
        if g('export'): return 200, {'text': 'x', 'hash': 'h', 'count': 6, 'changed': False, 'ever': True}
        if g('cards'): return 200, {'cards': {}, 'people': people, 'clients': clients}
        if g('people'): return 200, {'people': people}
        if g('clients'): return 200, {'clients': clients}
        return 200, {'projects': [{'id': x['id'], 'name': x['name'], **({'prio': x['prio']} if x['prio'] else {})} for x in S['list']]}
    return S, api

def run(h):
    R = []; p = h.page
    def chk(name, cond, info=''): R.append(('WPX: ' + name, bool(cond), info))
    def wait(ms=400): p.wait_for_timeout(ms)
    def overflow(): return p.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    def mutations(sel, ms=1200):
        return p.evaluate("""([s, ms]) => new Promise(function (res) { var n = 0, o = new MutationObserver(function (m) { n += m.length; }); o.observe(document.querySelector(s), {childList: true, subtree: true, characterData: true, attributes: true});
            for (var i = 0; i < 3; i++) window.App.render(); setTimeout(function () { o.disconnect(); res(n); }, ms); })""", [sel, ms])
    S, api = mock(); h.extra['/api/projects'] = api
    h.allow += ['status of 400']
    base = h.todos[3]
    h.todos[:] = [t for t in h.todos if t['list'] != 'work']
    names = {mk(100): ['Chase NOLA invites', 'Reconcile SF approvals', 'Reply to Priya', 'Write the Participants section'], mk(101): ['Send reminder wave 3', 'Check incentive'], mk(102): ['Agree incentive']}
    for i, n in enumerate(['Uber users in NOLA and SF', 'Gig workers in Chicago', 'Healthcare UK']):
        for j, t in enumerate(names[mk(100 + i)]):
            h.todos.append(dict(base, id=str(uuid.uuid4()), title=t, category=n, prio=0, due_date=['2026-10-30', '2026-11-01', '2026-11-03', None][j % 4]))
    tid = {t['title']: t['id'] for t in h.todos if t['list'] == 'work'}
    SH = os.path.join(D, 'out'); os.makedirs(SH, exist_ok=True)
    p.context.add_init_script("localStorage.removeItem('wpxOff')")  # the harness turns the new section off for the older suites; this one wants it
    p.set_viewport_size({'width': 1440, 'height': 900}); p.goto('http://todo.test/'); wait(1800)
    p.evaluate("document.documentElement.classList.remove('night')")
    p.click('#nProjects'); wait(300)
    if not p.is_visible('#wxPane .wx'): p.click('#psW'); wait(900)
    chk('Projects opens the new section (module loaded)', p.is_visible('#wxPane .wx') and p.evaluate('window.App.view()') == 'wp', p.evaluate('window.App.view()'))
    chk('the legacy board is not shown', not p.is_visible('#boardPane'))
    rows = p.query_selector_all('#wxPane .wx-pr')
    chk('list shows the 6 active projects sorted by deadline (soonest first, none last)', len(rows) == 6 and 'Healthcare UK' in rows[0].inner_text() and 'Fraud screener' in rows[-1].inner_text(), [r.inner_text()[:20] for r in rows])
    chk('overview rows show deadline, ticket column and progress', 'Deadline' in p.inner_text('#wxPane .wx-orow') and p.query_selector('#wxPane .wx-ohd') is not None)
    chk('overview stats count overdue tasks and deadlines', 'overdue tasks' in p.inner_text('#wxPane .wx-sub') and 'deadline within 7 days' in p.inner_text('#wxPane .wx-sub'), p.inner_text('#wxPane .wx-sub'))
    p.screenshot(path=os.path.join(SH, 'wpx_overview.png'))
    # task board tab
    p.click('#wxPane [data-wpx=tab][data-v=board]'); wait(300)
    chk('Task board view: one column per project with its open tasks', len(p.query_selector_all('#wxPane .wx-colm')) == 6 and 'Chase NOLA invites' in p.inner_text('#wxPane'))
    p.screenshot(path=os.path.join(SH, 'wpx_taskboard.png'))
    p.click('#wxPane [data-wpx=tab][data-v=list]'); wait(200)
    # open a project: replaces the right side, list stays
    p.click('#wxPane .wx-pr:has-text("Uber users")'); wait(500)
    chk('clicking a project replaces the overview and the list stays', p.is_visible('#wxPane .wx-list') and 'Uber users in NOLA and SF' in p.inner_text('#wxPane .wx-main h1') and p.query_selector('#wxPane .wx-orow') is None)
    chk('the selected project is marked in the list', 'Uber users' in p.inner_text('#wxPane .wx-pr.on'))
    t = p.inner_text('#wxPane .wx-main')
    chk('progress: 79% from 791 of 1,000, segments listed', '79%' in t and '791 of 1,000' in t and '591 ID approved' in t, t[:300])
    chk('resource bar shows Request link and the Prolific project link', 'Request link' in p.inner_text('#wxPane .wx-res') and 'Prolific project' in p.inner_text('#wxPane .wx-res'), p.inner_text('#wxPane .wx-res'))
    chk('last Slack message shown', 'NOLA at 261' in t)
    p.screenshot(path=os.path.join(SH, 'wpx_project.png'))
    # inline edit: deadline
    p.click('#wxPane [data-wpx=edit][data-f="dates.due"]'); wait(200)
    p.fill('#wxPane input[type=date]', '2026-12-04'); wait(700)  # picking a date saves it at once
    chk('deadline edited inline: one field saved, with provenance', S['puts'] and S['puts'][-1]['dates']['due'] == '2026-12-04' and S['puts'][-1]['prov']['dates.due']['by'] == 'luc', S['puts'][-1:])
    chk('the new deadline shows', 'Fri 4 Dec' in p.inner_text('#wxPane .wx-main'))
    # escape cancels
    p.click('#wxPane [data-wpx=edit][data-f="particip.source"]'); wait(150); p.fill('#wxPane input[data-wpx-in=edit]', 'Should not save'); p.press('#wxPane input[data-wpx-in=edit]', 'Escape'); wait(300)
    n0 = len(S['puts'])
    chk('Escape cancels without saving', 'Should not save' not in p.inner_text('#wxPane .wx-main') and len(S['puts']) == n0)
    # tab moves to the next field
    p.click('#wxPane [data-wpx=edit][data-f="linear.status"]'); wait(150); p.fill('#wxPane input[data-wpx-in=edit]', 'In Progress'); p.press('#wxPane input[data-wpx-in=edit]', 'Tab'); wait(500)
    chk('Tab saves and opens the next field', S['puts'][-1]['linear']['status'] == 'In Progress' and p.evaluate("document.activeElement && document.activeElement.type") in ('date', 'text'), p.evaluate("document.activeElement && document.activeElement.outerHTML.slice(0,80)"))
    p.keyboard.press('Escape'); wait(300)
    # paste a Linear link
    p.click('#wxPane [data-wpx=addlink]'); wait(150)
    p.fill('#wxPane input[data-wpx-in=newlink]', LIN); p.press('#wxPane input[data-wpx-in=newlink]', 'Enter'); wait(700)
    last = S['puts'][-1]
    chk('pasting a Linear link fills Issue ID and title, typed as linear', last['linear']['id'] == 'HDOR-394' and last['linear']['title'] == 'Uber users in New Orleans and San Fran' and any(r.get('k') == 'linear' and r.get('id') == 'HDOR-394' for r in last['links']['other']), last)
    chk('the ticket chip shows HDOR-394 and the title is in the inspector', 'HDOR-394' in p.inner_text('#wxPane .wx-res') and 'Uber users in New Orleans and San Fran' in p.inner_text('#wxPane .wx-insp'))
    # paste a Prolific group link: ID read from the link
    p.click('#wxPane [data-wpx=addlink]'); wait(150)
    p.fill('#wxPane input[data-wpx-in=newlink]', 'https://app.prolific.com/researcher/workspaces/6970eb/groups/6aff8acb438b9363d5ca1fd9/overview'); p.press('#wxPane input[data-wpx-in=newlink]', 'Enter'); wait(700)
    chk('a Prolific group link: ID is the text after the last / (not /overview), shown as a Group ID', S['puts'][-1]['links']['groups'][0]['id'] == '6aff8acb438b9363d5ca1fd9' and '6aff8a' in p.inner_text('#wxPane .wx-insp'), S['puts'][-1]['links'])
    p.click('#wxPane [data-wpx=addlink]'); wait(150); p.fill('#wxPane input[data-wpx-in=newlink]', 'http://insecure.example.com'); p.press('#wxPane input[data-wpx-in=newlink]', 'Enter'); wait(400)
    chk('an http link is refused with a message', 'https://' in p.inner_text('#wxPane .wx-toast'), p.inner_text('#wxPane .wx-main')[:200])
    # deliverables
    n0 = len(S['puts'])
    p.fill('#wxPane [data-row="0"] [data-k=provided]', '540'); p.press('#wxPane [data-row="0"] [data-k=provided]', 'Tab'); wait(500)
    chk('editing a delivered number saves the segments and recalculates the %', len(S['puts']) > n0 and S['puts'][-1]['deliver'][0]['provided'] == 540 and '80%' in p.inner_text('#wxPane .wx-big'), p.inner_text('#wxPane .wx-big'))
    # Next task
    p.click('#wxPane #wx-i-%s .wx-pin' % tid['Reconcile SF approvals']); wait(500)
    chk('Next task: saved on the project and pinned first with "Next up"', S['nexts'][-1] == (mk(100), tid['Reconcile SF approvals']) and 'Next up' in p.inner_text('#wxPane .wx-tasks li:first-child') and 'Reconcile SF' in p.inner_text('#wxPane .wx-tasks li:first-child'), S['nexts'])
    p.click('#wxPane #wx-i-%s .wx-tk' % tid['Reconcile SF approvals']); wait(700)
    pt = [c for c in h.calls if c[0] == 'PATCH' and c[1] == '/api/todos']
    chk('ticking the next task completes it through the core', pt and pt[-1][3].get('done') is True)
    chk('a finished Next task is cleared and the page asks to pick another', 'Pick the next task' in p.inner_text('#wxPane .wx-main') and S['nexts'][-1] == (mk(100), None), S['nexts'][-2:])
    # add a task
    p.fill('#wxPane .wx-newtask input', 'From the new page'); p.press('#wxPane .wx-newtask input', 'Enter'); wait(600)
    tp = [c for c in h.calls if c[0] == 'POST' and c[1] == '/api/todos'][-1][3]
    chk('add box files the task in this project', tp == {'title': 'From the new page', 'category': 'Uber users in NOLA and SF', 'list': 'work'}, tp)
    # menus
    p.select_option('#wxPane select[data-wpx-in=rag]', 'r'); wait(400)
    chk('status menu saves the RAG', S['puts'][-1]['rag'] == 'r')
    # remove a link
    n0 = len(S['puts']); p.click('#wxPane .wx-lk:has-text("Group") [data-wpx=rmlink]'); wait(500)
    chk('removing a link saves the remaining ones', len(S['puts']) > n0 and 'groups' not in S['puts'][-1]['links'])
    chk('page idle redraw writes nothing', mutations('#wxPane') == 0)
    chk('fits 1440 without sideways scroll', overflow() <= 0, overflow())
    p.screenshot(path=os.path.join(SH, 'wpx_project2.png'))
    # legacy switch
    p.click('#wxPane [data-wpx=legacy]'); wait(900)
    chk('Legacy view opens the earlier board on the same data', p.is_visible('#boardPane') and 'New projects view' in p.inner_text('#boardPane'), p.evaluate('window.App.view()'))
    p.click('#boardPane [data-bd=newui]'); wait(700)
    chk('and New projects view comes back', p.is_visible('#wxPane .wx'))
    # phone
    p.set_viewport_size({'width': 390, 'height': 844}); wait(500)
    p.evaluate("window.App.wpOpen('')"); wait(500)
    chk('phone: the list is the overview (no project selected)', p.is_visible('#wxPane .wx-list') and not p.is_visible('#wxPane .wx-main'))
    chk('phone fits 390', overflow() <= 0, overflow())
    p.screenshot(path=os.path.join(SH, 'wpx_phone_list.png'))
    p.click('#wxPane .wx-pr:has-text("Uber users")'); wait(600)
    chk('phone: opening a project shows its page with Tasks / Details / Updates tabs', p.is_visible('#wxPane .wx-ptabs') and not p.is_visible('#wxPane .wx-list') and p.is_visible('#wxPane .wx-res'))
    p.screenshot(path=os.path.join(SH, 'wpx_phone_project.png'))
    p.click('#wxPane [data-wpx=ptab][data-v=details]'); wait(300)
    chk('phone: Details tab shows the inspector, not the tasks', p.is_visible('#wxPane .wx-insp') and not p.is_visible('#wxPane .wx-tasks'))
    p.screenshot(path=os.path.join(SH, 'wpx_phone_details.png'))
    chk('phone fits 390 (project page)', overflow() <= 0, overflow())
    small = p.evaluate("""() => Array.prototype.slice.call(document.querySelectorAll('#wxPane button, #wxPane select, #wxPane a.wx-rc, #wxPane code')).filter(function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 43.5); }).map(function (e) { return (e.getAttribute('data-wpx') || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height); })""")
    chk('no tiny buttons on the phone page', not small, small)
    p.click('#wxPane [data-wpx=back]'); wait(300)
    chk('phone: Back returns to the list', p.is_visible('#wxPane .wx-list'))
    chk('no page errors', not h.errors, h.errors)
    return R
