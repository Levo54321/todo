"""v1059: Settings > Import (desktop CSV import). Runs the REAL api/_bulk.js through the harness mock (needs node)."""
import os, tempfile, json

GOOD = ('title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes\r\n'
        'Call the dentist,personal,Health,24/11/2026,09:30,,,,,"Ask about the invoice,\r\nthen book"\r\n'
        'Send weekly report,work,,2026-11-27,,weekly,2,yes,no,\r\n'
        '\r\n'
        '"Quote ""this""",,,,,,,,,\r\n')
BAD = 'title,due_date,priority,colour\nOk one,2026-11-30,1,red\n,31/02/2026,9,blue\n'

def write(txt, name):
    f = os.path.join(tempfile.mkdtemp(), name); open(f, 'w', encoding='utf-8', newline='').write(txt); return f

def run(h):
    p = h.page; R = []
    def chk(name, cond, info=''): R.append(('Import: ' + name, bool(cond), info))
    def bulk(): return [c for c in h.calls if c[0] == 'POST' and c[1] == '/api/todos' and 'bulk' in c[2]]

    h.allow.append('400')  # the dry run of a faulty file is answered 400 on purpose
    p.click('#nSettings'); p.wait_for_timeout(300)
    chk('Import tab shown on desktop', p.query_selector('.tab[data-val=import]') is not None)
    p.click('.tab[data-val=import]'); p.wait_for_timeout(200)
    chk('lists the columns', 'due_date' in p.inner_text('#tabBody') and 'must_today' in p.inner_text('#tabBody'))
    with p.expect_download() as dl: p.click('#impTpl')
    tpl = open(dl.value.path(), encoding='utf-8', newline='').read()
    chk('template downloads with all 10 columns + examples', tpl.split('\r\n')[0].count(',') == 9 and 'Call the dentist' in tpl, tpl[:80])

    # a file with faults: nothing is added, lines are named, unknown column reported
    n0 = len(h.todos)
    p.set_input_files('#impFile', write(BAD, 'bad.csv')); p.wait_for_timeout(600)
    t = p.inner_text('#tabBody')
    chk('bad file: errors listed with line number', 'Line 3' in t and 'title is required' in t and 'priority must be 0, 1, 2 or 3' in t and 'due_date' in t, t[:400])
    chk('bad file: unknown column reported', 'colour' in t)
    chk('bad file: no Add button, nothing sent for real', p.query_selector('#impGo') is None and not [c for c in bulk() if not c[3].get('dry')] and len(h.todos) == n0)

    # a good file
    p.set_input_files('#impFile', write(GOOD, 'good.csv')); p.wait_for_timeout(600)
    t = p.inner_text('#tabBody')
    chk('good file: 3 tasks found (blank line skipped, quoted comma/newline kept)', '3 tasks found' in t and p.query_selector('#impGo') is not None, t[:200])
    chk('dry run was sent first', bulk() and bulk()[-1][3].get('dry') is True)
    p.click('#impGo'); p.wait_for_timeout(800)
    chk('done message', 'Added 3 tasks' in p.inner_text('#tabBody'), p.inner_text('#tabBody')[:200])
    added = h.todos[n0:]
    chk('3 tasks stored', len(added) == 3, [x['title'] for x in added])
    a = {x['title']: x for x in added}
    d = a.get('Call the dentist') or {}
    chk('UK date converted, time and category kept', d.get('due_date') == '2026-11-24' and d.get('remind_time') == '09:30' and d.get('category') == 'Health', d)
    chk('multi-line note kept', 'Ask about the invoice,' in (d.get('notes') or '') and 'then book' in (d.get('notes') or ''), d.get('notes'))
    w = a.get('Send weekly report') or {}
    chk('work row: list, repeat, priority, quick', w.get('list') == 'work' and w.get('recur') == 'weekly' and w.get('prio') == 2 and w.get('quick') is True, w)
    chk('doubled quotes unescaped', 'Quote "this"' in a)
    p.click('[data-act=setcancel]'); p.wait_for_timeout(600)
    p.click('#nPersonal'); p.wait_for_timeout(300)
    chk('imported tasks appear on the Personal list', 'Quote "this"' in p.inner_text('#cols'), p.inner_text('#cols')[:300])

    # no title column / empty / semicolon separated
    p.click('#nSettings'); p.wait_for_timeout(200); p.click('.tab[data-val=import]'); p.wait_for_timeout(200)
    p.set_input_files('#impFile', write('name,due\nx,2026-01-01\n', 'nohead.csv')); p.wait_for_timeout(300)
    chk('no title column: clear message, nothing sent', 'no "title" column' in p.inner_text('#tabBody'))
    n1 = len(h.todos)
    p.set_input_files('#impFile', write('title;due_date\nSemi one;2026-12-01\n', 'semi.csv')); p.wait_for_timeout(500)
    chk('semicolon separator accepted', '1 task found' in p.inner_text('#tabBody'), p.inner_text('#tabBody')[:150])
    h.fail_bulk = True; h.allow.append('500')
    p.click('#impGo'); p.wait_for_timeout(600); h.fail_bulk = False
    chk('server failure: says nothing/part added, no crash', 'Stopped part-way' in p.inner_text('#tabBody') and len(h.todos) == n1, p.inner_text('#tabBody')[:200])
    p.click('[data-act=setcancel]'); p.wait_for_timeout(200)

    # not offered on phones/tablets
    import mimetypes
    from urllib.parse import urlparse, parse_qs
    REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    def serve(r):
        u = urlparse(r.request.url)
        if u.hostname != 'todo.test': return r.abort()
        if u.path.startswith('/api/'):
            try: body = json.loads(r.request.post_data or 'null')
            except Exception: body = None
            st, data = h.api(r.request.method, u.path, parse_qs(u.query), body or {})
            return r.fulfill(status=st, content_type='application/json', body=json.dumps(data))
        fp = os.path.join(REPO, 'public', u.path.lstrip('/') or 'index.html')
        if not os.path.isfile(fp): return r.fulfill(status=404, body='nf')
        r.fulfill(status=200, content_type=mimetypes.guess_type(fp)[0] or 'text/plain', body=open(fp, 'rb').read())
    for label, ua, w_, hh in (('iPad 2', 'Mozilla/5.0 (iPad; CPU OS 9_3_5 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13G36 Safari/601.1', 1024, 768),
                              ('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1', 390, 844)):
        ctx = p.context.browser.new_context(viewport={'width': w_, 'height': hh}, user_agent=ua)
        ctx.add_init_script("localStorage.setItem('todoToken','tok');localStorage.setItem('railOpen','1');localStorage.setItem('pvSeen','2026-11-01');")
        ctx.route('**/*', serve)
        pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(900)
        pg.evaluate("document.querySelector('[data-act=settings]').click()"); pg.wait_for_timeout(300)
        chk('%s: no Import tab' % label, pg.query_selector('.tab[data-val=import]') is None and pg.query_selector('.tab') is not None)
        ctx.close()
    return R
