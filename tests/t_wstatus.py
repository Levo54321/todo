"""v36 Work status updates: Copy for Claude (clipboard, select-all box for old browsers, "changed since last copy"), the Paste updates
screen (clipboard read, paste box, broken / wrong-version / unknown-project pastes, review cards, Accept off by default, nothing saved
before Save, RAG accepted vs ignored), the Status updates section on a project page (newest first, older collapsed, per-project paste
skipping other projects, manual update), no redraw writes while idle, and overflow / tap targets / font sizes at 390x844 and 1024x768.
Run: python3 tests/harness.py . tests/t_wstatus.py
Builds on the /api/projects mock of t_wproject.py; the parser, cleaning and export text below are the REAL api/_wstatus.js run through node.
The SQL (db/setup36.sql) was tested in the live database inside a rolled-back transaction."""
import importlib.util, json, os, subprocess
D = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(D)
spec = importlib.util.spec_from_file_location('twp', os.path.join(D, 't_wproject.py')); twp = importlib.util.module_from_spec(spec); spec.loader.exec_module(twp)

def node(js, data):
    return json.loads(subprocess.run(['node', '-e', "var ws=require('./api/_wstatus.js'),d=JSON.parse(require('fs').readFileSync(0,'utf8'));" + js], input=json.dumps(data), capture_output=True, text=True, cwd=REPO).stdout)

def mock():
    S, base = twp.mock()
    S['upds'] = {}; S['last_hash'] = None; S['uid'] = 0; S['saves'] = []; S['copies'] = []
    names = {'aaaaaaaaaaa1': 'Alpha', 'aaaaaaaaaaa2': 'Beta'}
    def plist(): return [{'id': i, 'name': n} for i, n in names.items()]
    def export_rows():
        return {'today': '2026-11-22', 'people': [], 'projects': [{'id': i, 'name': n, 'status': 'active', 'meta': S['meta'][i], 'last': ({'at': '2026-11-22', 'headline': S['upds'][i][0]['headline']} if S['upds'].get(i) else None)} for i, n in names.items()]}
    def api(h, method, q, body):
        g = lambda k: q.get(k, [None])[0]
        if 'statusparse' in q:
            r = node("console.log(JSON.stringify(ws.parse(d.text,d.projects,{only:d.only||''})))", {'text': body.get('text'), 'projects': plist(), 'only': body.get('only') or ''})
            if r.get('ok'):
                for e in r['entries']:
                    rg = S['meta'][e['project']['id']].get('rag')
                    if rg: e['project']['rag'] = rg
            return 200, r
        if 'updates' in q:
            if method == 'GET': return 200, {'updates': S['upds'].get(g('updates'), [])}
            items = []
            if body.get('manual') is not None:
                u = node("console.log(JSON.stringify(ws.cleanManual(d)))", body['manual'])
                if not u: return 400, {'error': 'Give the update a headline'}
                items.append((body['id'], u, False, 'manual'))
            else:
                for it in body['items']:
                    u = node("console.log(JSON.stringify(ws.cleanUpdate(d,[],'x')))", it['update'])
                    if not u: return 400, {'error': 'Update is not complete'}
                    items.append((it['id'], u, it.get('accept_rag') is True, 'claude'))
            S['saves'].append(body)
            for pid, u, acc, origin in items:
                S['uid'] += 1
                rec = dict(u, id=S['uid'], at='2026-11-22T10:00:0%dZ' % S['uid'], origin=origin, rag_accepted=bool(acc and u.get('rag')))
                S['upds'].setdefault(pid, []).insert(0, rec)
                if acc and u.get('rag'):
                    if S['meta'][pid].get('rag') != u['rag']: S['events'][pid].append({'at': '2026-11-22T10:00:00Z', 'kind': 'rag', 'text': u['rag']})
                    S['meta'][pid]['rag'] = u['rag']
            return 201, {'saved': len(items), 'projects': [i[0] for i in items]}
        if 'export' in q:
            if method == 'GET':
                ex = node("console.log(JSON.stringify(ws.buildExport(d)))", export_rows())
                return 200, {'text': ex['text'], 'hash': ex['hash'], 'count': ex['count'], 'changed': ex['hash'] != (S['last_hash'] or ''), 'ever': bool(S['last_hash'])}
            S['last_hash'] = body['hash']; S['copies'].append(body['hash']); return 200, {'ok': True}
        return base(h, method, q, body)
    return S, api

def block(updates, v=1):
    return 'Weekly update from Claude\n\n## Alpha\nText\n\n```todo-status\n' + json.dumps({'v': v, 'exported': '2026-11-22', 'updates': updates}, indent=1) + '\n```\nThanks'

def upd(pid, name, **kw):
    o = {'id': pid, 'name': name, 'headline': name + ' headline', 'done': ['Did a thing'], 'next': ['Do the next'], 'blockers': [], 'risks': ['A risk'], 'decisions': [], 'asks': [{'who': 'Sam', 'what': 'Approve it'}], 'sources': {'slack': [{'n': 'Thread', 'u': 'https://x.slack.com/archives/C1/p1'}], 'linear': [{'n': 'OPS-1', 'u': 'https://linear.app/x/issue/OPS-1'}]}}
    o.update(kw); return o

def run(h):
    R = []
    p = h.page
    def chk(name, cond, info=''): R.append(('WS: ' + name, bool(cond), info))
    def wait(ms=400): p.wait_for_timeout(ms)
    def calls(m, key): return [c for c in h.calls if c[0] == m and c[1] == '/api/projects' and key in c[2]]
    def overflow(): return p.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    def small_targets(scope):
        return p.evaluate("""s => Array.prototype.slice.call(document.querySelectorAll(s + ' button, ' + s + ' a, ' + s + ' input, ' + s + ' textarea')).filter(function (e) {
            var r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(function (e) { return (e.getAttribute('data-ws') || e.tagName) + ':' + e.textContent.slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height); })""", scope)
    def small_fonts(scope):
        return p.evaluate("""s => Array.prototype.slice.call(document.querySelectorAll(s + ' *')).filter(function (e) {
            return e.getBoundingClientRect().width > 0 && e.childNodes.length && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12; }).map(function (e) { return e.tagName + ':' + e.textContent.slice(0, 20); })""", scope)
    def clip_ok(txt):  # a modern browser: reads and writes the clipboard
        p.evaluate("""t => { Object.defineProperty(window, 'isSecureContext', {value: true, configurable: true});
            Object.defineProperty(navigator, 'clipboard', {value: {readText: function () { return Promise.resolve(t); }, writeText: function (x) { window.__copied = x; return Promise.resolve(); }}, configurable: true}); }""", txt)
    def clip_none():   # iPad 2: no clipboard API, execCommand copy refused
        p.evaluate("""() => { Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true}); document.execCommand = function () { return false; }; }""")
    def mutations(sel, ms=1200):
        return p.evaluate("""([s, ms]) => new Promise(function (res) { var n = 0, o = new MutationObserver(function (m) { n += m.length; }); o.observe(document.querySelector(s), {childList: true, subtree: true, characterData: true, attributes: true});
            for (var i = 0; i < 3; i++) window.App.render(); setTimeout(function () { o.disconnect(); res(n); }, ms); })""", [sel, ms])

    S, api = mock(); h.extra['/api/projects'] = api
    S['meta']['aaaaaaaaaaa1']['rag'] = 'g'          # Alpha is Green now, Beta has no RAG
    S['meta']['aaaaaaaaaaa1']['links'] = {'slack': [{'n': 'Request', 'u': 'https://x.slack.com/archives/C1/p0', 'init': True}], 'other': [{'n': 'Linear', 'u': 'https://linear.app/p'}]}
    p.goto('http://todo.test/'); wait(1500)
    p.click('#nProjects'); wait(200)
    if not p.is_visible('#vBoard'): p.click('#psW'); wait(600)
    wait(500)
    chk('board has Copy for Claude and Paste updates (44px)', p.is_visible('#boardPane [data-ws=copy]') and p.is_visible('#boardPane [data-ws=open]') and not small_targets('#boardPane .bdtools'), small_targets('#boardPane .bdtools'))
    chk('board says not copied yet', 'Not copied yet' in p.inner_text('#boardPane .bdtools'), p.inner_text('#boardPane .bdtools'))
    chk('board fits 390', overflow() <= 0, overflow())
    # ---- Copy for Claude: modern browser
    clip_ok(''); p.click('#boardPane [data-ws=copy]'); wait(600)
    cp = p.evaluate('window.__copied || ""')
    chk('copy puts the export on the clipboard', '```todo-projects' in cp and 'aaaaaaaaaaa1' in cp and '"init":true' in cp and 'Linear' in cp, cp[:200])
    chk('copy is recorded and the flag clears', len(S['copies']) == 1 and 'Not copied' not in p.inner_text('#boardPane .bdtools') and 'Changed' not in p.inner_text('#boardPane .bdtools'))
    # ---- Copy for Claude: old browser gets the select-all box
    clip_none(); p.click('#boardPane [data-ws=copy]'); wait(500)
    chk('old browser: select-all box with the text', p.is_visible('#wsModal') and '```todo-projects' in p.input_value('#wsExpBox'))
    chk('box buttons are 44px', not small_targets('#wsModal'), small_targets('#wsModal'))
    chk('copy not recorded until I tap "I have copied it"', len(S['copies']) == 1)
    p.click('#wsModal [data-ws=mclose]'); wait(200)
    chk('Close removes the box', not p.query_selector('#wsModal'))
    # ---- Paste updates, bulk
    p.click('#boardPane [data-ws=open]'); wait(500)
    chk('Paste updates screen opens', p.is_visible('#vWstatus') and 'Paste updates' in p.inner_text('#wsPane'))
    # broken JSON
    clip_ok('```todo-status\n{"v":1,"updates":[{"id":\n```'); p.click('#wsPane [data-ws=clip]'); wait(500)
    chk('broken JSON: plain message, no review', 'not valid JSON' in p.inner_text('#wsPane') and not p.query_selector('#wsPane .wsrv'), p.inner_text('#wsPane')[:200])
    clip_ok(block([upd('aaaaaaaaaaa1', 'Alpha')], v=2)); p.click('#wsPane [data-ws=clip]'); wait(500)
    chk('wrong version: refused with the reason', 'version 2' in p.inner_text('#wsPane') and not p.query_selector('#wsPane .wsrv'))
    clip_ok('just some text'); p.click('#wsPane [data-ws=clip]'); wait(500)
    chk('no block: says so', 'No todo-status block' in p.inner_text('#wsPane'))
    clip_ok('   '); p.click('#wsPane [data-ws=clip]'); wait(400)
    chk('empty clipboard: says so', 'clipboard is empty' in p.inner_text('#wsPane'))
    # good paste: Alpha by id (suggest amber, now green), Beta by NAME with a wrong id (suggest green, now none), Ghost unknown
    good = block([upd('aaaaaaaaaaa1', 'Alpha', rag='amber', headline='Alpha slipping'), upd('ffffffffffff', 'beta', rag='green', headline='Beta fine'), upd('eeeeeeeeeeee', 'Ghost', headline='Nope')])
    clip_ok(good); p.click('#wsPane [data-ws=clip]'); wait(700)
    cards = p.query_selector_all('#wsPane .wsrv')
    t = p.inner_text('#wsPane')
    chk('two review cards, one skipped', len(cards) == 2 and 'skipped (1)' in t.lower() and 'Ghost' in t and 'no project' in t, t[:300])
    chk('card shows headline and sections and links', 'Alpha slipping' in t and 'Did a thing' in t and 'A risk' in t and 'Sam: Approve it' in t and p.query_selector('#wsPane a.wslink[href^="https://linear.app"]'))
    chk('second matched by name', 'matched by name' in t and 'matched by id' in t)
    chk('suggestion text with current RAG', 'Suggested: Amber (now Green)' in t.replace('\n', ' ') or 'Suggested:' in t and 'Amber' in t and 'now Green' in t, t)
    accs = p.query_selector_all('#wsPane [data-ws=acc]')
    chk('Accept is off by default for every card', len(accs) == 2 and all(a.get_attribute('aria-pressed') == 'false' for a in accs))
    chk('nothing saved yet', not calls('POST', 'updates'))
    chk('Save says how many', 'Save 2 updates' in t)
    p.screenshot(path=os.path.join(D, 'out', 'wstatus_review.png'))
    chk('review fits 390 with 44px targets and no tiny fonts', overflow() <= 0 and not small_targets('#wsPane') and not small_fonts('#wsPane'), (overflow(), small_targets('#wsPane'), small_fonts('#wsPane')))
    # accept Alpha only
    accs[0].click(); wait(200)
    chk('Accept toggles on', p.get_attribute('#wsPane [data-ws=acc][data-ref="1"]', 'aria-pressed') == 'true')
    chk('review redraw writes nothing when idle', mutations('#wsPane') == 0)
    p.click('#wsPane [data-ws=save]'); wait(800)
    sv = calls('POST', 'updates')
    chk('Save sends both, accept only where asked', len(sv) == 1 and [(i['id'], i['accept_rag']) for i in sv[0][3]['items']] == [('aaaaaaaaaaa1', True), ('aaaaaaaaaaa2', False)], sv[-1:] and sv[-1][3])
    chk('RAG accepted on Alpha, Beta untouched', S['meta']['aaaaaaaaaaa1'].get('rag') == 'a' and 'rag' not in S['meta']['aaaaaaaaaaa2'], S['meta'])
    chk('rag change logged once', len([e for e in S['events']['aaaaaaaaaaa1'] if e['kind'] == 'rag']) == 1)
    chk('both updates stored', len(S['upds']['aaaaaaaaaaa1']) == 1 and len(S['upds']['aaaaaaaaaaa2']) == 1 and S['upds']['aaaaaaaaaaa2'][0]['rag_accepted'] is False and S['upds']['aaaaaaaaaaa1'][0]['rag_accepted'] is True)
    chk('review closed after Save', not p.query_selector('#wsPane .wsrv'))
    # back to the board: changed flag shows again
    p.click('#wsPane [data-ws=back]'); wait(900)
    chk('board says changed since last copy', 'Changed since last copy' in p.inner_text('#boardPane .bdtools'), p.inner_text('#boardPane .bdtools'))
    chk('board RAG dot follows the accepted RAG', p.query_selector('#boardPane .bdhead[data-pid=aaaaaaaaaaa1] .wprag-a') is not None)
    clip_ok(''); p.click('#boardPane [data-ws=copy]'); wait(600)
    cp = p.evaluate('window.__copied || ""')
    chk('export now carries the last update headline', 'Alpha slipping' in cp and 'Beta fine' in cp)
    chk('flag clears after copying again', 'Changed' not in p.inner_text('#boardPane .bdtools'))
    # ---- iPad 2: no clipboard read -> a paste box
    clip_none(); p.click('#boardPane [data-ws=open]'); wait(500); p.click('#wsPane [data-ws=clip]'); wait(300)
    chk('no clipboard API: paste box appears', p.is_visible('#wsPane textarea[data-f=wsBulk]'))
    p.fill('#wsPane textarea[data-f=wsBulk]', block([upd('aaaaaaaaaaa2', 'Beta', rag='red', headline='Beta in trouble')])); p.click('#wsPane [data-ws=read]'); wait(700)
    chk('box paste reviews', len(p.query_selector_all('#wsPane .wsrv')) == 1 and 'Beta in trouble' in p.inner_text('#wsPane'))
    p.click('#wsPane [data-ws=discard]'); wait(200)
    chk('Discard leaves nothing saved', len(calls('POST', 'updates')) == 1 and not p.query_selector('#wsPane .wsrv'))
    # ---- project page
    p.click('#wsPane [data-ws=back]'); wait(500)
    p.click('#boardPane [data-bd=page][data-pid=aaaaaaaaaaa1]'); wait(800)
    t = p.inner_text('#wpPane')
    chk('page lists Status updates, newest first', 'Status updates' in t and 'Alpha slipping' in t and 'Did a thing' in t, t[:300])
    chk('newest says suggested Amber, accepted', 'suggested Amber, accepted' in t)
    chk('page has Paste update and Add manual update', p.is_visible('#wpPane [data-ws=ppaste]') and p.is_visible('#wpPane [data-ws=pman]'))
    chk('page idle redraw writes nothing', mutations('#wpPane') == 0)
    # per-project paste: Alpha + Beta in one paste -> Beta skipped
    clip_ok(block([upd('aaaaaaaaaaa1', 'Alpha', rag='green', headline='Alpha recovered', sources={}), upd('aaaaaaaaaaa2', 'Beta')]))
    p.click('#wpPane [data-ws=ppaste]'); wait(200); p.click('#wpPane [data-ws=clip]'); wait(700)
    t = p.inner_text('#wpPane')
    chk('page paste: one card, other project skipped', len(p.query_selector_all('#wpPane .wsrv')) == 1 and 'not this project' in t and 'Alpha recovered' in t, t[-400:])
    chk('page paste: accept off, nothing saved yet', p.get_attribute('#wpPane [data-ws=acc]', 'aria-pressed') == 'false' and len(calls('POST', 'updates')) == 1)
    p.click('#wpPane [data-ws=save]'); wait(800)
    chk('page paste saved without changing RAG', len(calls('POST', 'updates')) == 2 and S['meta']['aaaaaaaaaaa1']['rag'] == 'a' and S['upds']['aaaaaaaaaaa1'][0]['headline'] == 'Alpha recovered' and S['upds']['aaaaaaaaaaa1'][0]['rag_accepted'] is False)
    t = p.inner_text('#wpPane')
    chk('older update collapsed under a toggle', 'Older updates (1)' in t and 'Alpha slipping' in t.split('Older updates')[0] is False or 'Older updates (1)' in t)
    chk('older not shown until opened', 'Alpha slipping' not in t)
    p.click('#wpPane [data-ws=older]'); wait(250)
    chk('older shows as a headline row', 'Alpha slipping' in p.inner_text('#wpPane') and 'Approve it' not in p.inner_text('#wpPane').split('Older updates')[1])
    p.click('#wpPane [data-ws=uo]:not([data-first])'); wait(250)
    chk('tapping an older row opens it', 'Approve it' in p.inner_text('#wpPane').split('Older updates')[1])
    # manual
    p.click('#wpPane [data-ws=pman]'); wait(250)
    p.click('#wpPane [data-ws=msave]'); wait(250)
    chk('manual needs a headline', 'headline' in p.inner_text('#wpPane').lower() and len(S['upds']['aaaaaaaaaaa1']) == 2)
    p.fill('#wpPane [data-f=wsMHead]', 'Typed by hand'); p.fill('#wpPane [data-f=wsMNotes]', 'Line one\nLine two'); p.click('#wpPane [data-ws=msave]'); wait(800)
    mu = S['upds']['aaaaaaaaaaa1'][0]
    chk('manual update stored with origin manual and notes, RAG untouched', mu['origin'] == 'manual' and mu['notes'] == 'Line one\nLine two' and S['meta']['aaaaaaaaaaa1']['rag'] == 'a', mu)
    chk('manual shows first with the older ones below', 'Typed by hand' in p.inner_text('#wpPane') and 'Older updates (2)' in p.inner_text('#wpPane') and 'typed by hand' in p.inner_text('#wpPane'))
    p.screenshot(path=os.path.join(D, 'out', 'wstatus_page.png'))
    chk('page fits 390, 44px targets, no tiny fonts', overflow() <= 0 and not small_targets('#wpPane .wpmain') and not small_fonts('#wpPane .wpmain'), (overflow(), small_targets('#wpPane .wpmain'), small_fonts('#wpPane .wpmain')))
    # 1024x768
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(500)
    chk('page fits 1024', overflow() <= 0, overflow())
    p.click('[data-wp=back]'); wait(500)
    chk('board fits 1024', overflow() <= 0 and not small_targets('#boardPane .bdtools'), (overflow(), small_targets('#boardPane .bdtools')))
    p.click('#boardPane [data-ws=open]'); wait(400)
    chk('paste screen fits 1024', overflow() <= 0)
    chk('no page errors', not h.errors, h.errors)
    return R
