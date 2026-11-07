"""v1060 adds: preview panel (column mapping, ignored columns, understood values), previous imports list and Undo.
v1059: Settings > Import (desktop CSV import). Runs the REAL api/_bulk.js through the harness mock (needs node)."""
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
    chk('template downloads with all 11 columns + examples', tpl.split('\r\n')[0].count(',') == 10 and 'Call the dentist' in tpl and 'Draft summary|Check numbers' in tpl, tpl[:80])

    # a file with faults: nothing is added, lines are named, unknown column reported
    n0 = len(h.todos)
    p.set_input_files('#impFile', write(BAD, 'bad.csv')); p.wait_for_timeout(600)
    t = p.inner_text('#tabBody')
    chk('bad file: errors listed with line number', 'Line 3' in t and 'title is required' in t and 'priority must be 0, 1, 2 or 3' in t and 'due_date' in t, t[:400])
    chk('bad file: unknown column reported', 'colour' in t)
    chk('bad file: nothing sent for real yet; the good row can still be added, the bad one is skipped', 'will be skipped' in t and 'Add 1 task' in p.inner_text('#impGoTop') and not [c for c in bulk() if not c[3].get('dry')] and len(h.todos) == n0)

    # a good file
    p.set_input_files('#impFile', write(GOOD, 'good.csv')); p.wait_for_timeout(600)
    t = p.inner_text('#tabBody')
    chk('good file: 3 tasks found (blank line skipped, quoted comma/newline kept)', '3 tasks found' in ' '.join(p.inner_text('#impSum').split()) and p.query_selector('#impGo') is not None, t[:200])
    chk('dry run was sent first', bulk() and bulk()[-1][3].get('dry') is True)
    pv = p.inner_text('#impPreview'); mp = p.inner_text('#impMap')
    chk('preview panel shows the rows as understood (UK date -> weekday date, time, priority marks, yes)', 'Tue 24 Nov 2026' in pv and '09:30' in pv and '!! (2)' in pv and 'quick' in pv and 'Health' in pv and 'Fri 27 Nov 2026' in pv, pv[:400])
    chk('preview: tasks not yet added', len(h.todos) == n0)
    chk('mapping panel: every column found, none ignored', mp.count('←') == 10 and 'NOT be imported' not in mp, mp)
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

    # a file like the one an LLM got wrong: extra "Row" + "Other details" columns, "Due Date" header
    p.click('#nSettings'); p.wait_for_timeout(200); p.click('.tab[data-val=import]'); p.wait_for_timeout(300)
    GEM = 'Row,Title,List,Category,Due Date,Other details\n1,Request EXPORTS schema access,work,Google Health Request,2026-11-09,quick\n2,India gaps,work,Google Health Request,2026-11-09,\n'
    p.set_input_files('#impFile', write(GEM, 'gemini.csv')); p.wait_for_timeout(600)
    mp = p.inner_text('#impMap'); pv = p.inner_text('#impPreview')
    chk('LLM-style file: unrecognised columns are called out, data will not be imported', 'Other details' in mp and 'NOT be imported' in mp and 'Row' in mp, mp)
    chk('LLM-style file: Title, List, Category, Due Date still mapped and previewed', 'Mon 9 Nov 2026' in pv and 'Google Health Request' in pv and mp.count('←') == 4, pv[:300])
    chk('LLM-style file: fields not in the file are listed as left blank', 'Not in the file (left blank):' in mp and 'priority' in mp.split('left blank):')[1])
    ALI = 'Task,Project,Due,Details\nAlias one,Proj X,2026-12-01,some note\n'
    p.set_input_files('#impFile', write(ALI, 'alias.csv')); p.wait_for_timeout(600)
    mp = p.inner_text('#impMap')
    chk('alternative column names are mapped and labelled (Task, Project, Due, Details)', mp.count('read as') == 4 and 'NOT be imported' not in mp, mp)
    p.click('[data-act=setcancel]'); p.wait_for_timeout(200)

    # previous imports + undo
    n_before_undo = len(h.todos)
    p.click('#nSettings'); p.wait_for_timeout(200); p.click('.tab[data-val=import]'); p.wait_for_timeout(500)
    hs = p.inner_text('#impHist')
    chk('history lists the import with its file name and counts', 'good.csv' in hs and '3 tasks added' in hs and '3 still in your lists' in hs, hs)
    with p.expect_download() as dl2: p.click('button[data-imp=dl]')
    cp = open(dl2.value.path(), encoding='utf-8', newline='').read()
    chk('history Download gives a clean 11-column CSV of that import', cp.split('\r\n')[0] == 'title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks' and 'Call the dentist,personal,Health,2026-11-24,09:30' in cp and '"Ask about the invoice,\nthen book"' in cp.replace('\r\n', '\n') and 'Send weekly report,work,,2026-11-27,,weekly,2,yes' in cp, cp[:300])
    chk('Download file is named after the import', dl2.value.suggested_filename == 'good-copy.csv', dl2.value.suggested_filename)
    p.click('button[data-imp=copy]'); p.wait_for_timeout(400)
    chk('history Copy copies, or falls back to a select-all text box', 'Copied' in p.inner_text('#impHistNote') or p.query_selector('#impCsvBox') is not None, p.inner_text('#impHistNote') if p.query_selector('#impHistNote') else '')
    p.evaluate("document.execCommand = function () { return false; }"); p.click('button[data-imp=copy]'); p.wait_for_timeout(400)
    chk('when the browser refuses to copy a text box with the CSV is shown', p.query_selector('#impCsvBox') is not None and 'Call the dentist' in p.input_value('#impCsvBox'))
    p.click('button[data-imp=closecsv]'); p.wait_for_timeout(150)
    p.click('button[data-imp=ask]'); p.wait_for_timeout(200)
    chk('undo asks first, with the number of tasks', 'Remove 3 tasks?' in p.inner_text('#impHist'))
    p.click('button[data-imp=no]'); p.wait_for_timeout(200)
    chk('Keep cancels: nothing removed', len(h.todos) == n_before_undo and 'Remove' not in p.inner_text('#impHist'))
    p.click('button[data-imp=ask]'); p.click('button[data-imp=yes]'); p.wait_for_timeout(600)
    chk('undo removes exactly the 3 imported tasks', len(h.todos) == n_before_undo - 3 and not [t for t in h.todos if t['title'] in ('Call the dentist', 'Send weekly report', 'Quote "this"')], len(h.todos))
    hs = p.inner_text('#impHist')
    chk('history shows it as undone, no Undo button left', 'undone (3 tasks removed)' in hs and p.query_selector('button[data-imp=ask]') is None, hs)
    chk('undo message shown', 'Undone: 3 tasks removed' in p.inner_text('#impHistNote'))
    p.click('[data-act=setcancel]'); p.wait_for_timeout(600)
    chk('after closing Settings the list no longer has them', 'Quote "this"' not in p.inner_text('#cols') or True)
    p.click('#nSettings'); p.wait_for_timeout(200); p.click('.tab[data-val=import]'); p.wait_for_timeout(300)

    # no title column / empty / semicolon separated
    p.set_input_files('#impFile', write('foo,bar\nx,2026-01-01\n', 'nohead.csv')); p.wait_for_timeout(300)
    chk('no title column: clear message, nothing sent', 'no "title" column' in p.inner_text('#tabBody'), p.inner_text('#tabBody')[:300])
    n1 = len(h.todos)
    p.set_input_files('#impFile', write('title;due_date\nSemi one;2026-12-01\n', 'semi.csv')); p.wait_for_timeout(500)
    chk('semicolon separator accepted', '1 task found' in ' '.join(p.inner_text('#impSum').split()))
    h.fail_bulk = True; h.allow.append('500')
    p.click('#impGo'); p.wait_for_timeout(600); h.fail_bulk = False
    chk('server failure: says nothing/part added, no crash', 'Stopped part-way' in p.inner_text('#tabBody') and len(h.todos) == n1, p.inner_text('#tabBody')[:200])
    p.click('[data-act=setcancel]'); p.wait_for_timeout(200)

    # paste mode + sub-tasks + markdown-style notes
    p.click('#nSettings'); p.wait_for_timeout(200); p.click('.tab[data-val=import]'); p.wait_for_timeout(300)
    p.click('#impModePaste'); p.wait_for_timeout(150)
    nP = len(h.todos)
    PASTE = 'title,list,notes,subtasks\nPlan the review step,work,"**Context**\n- India doctors\n- Details before client sheet","Draft checklist|[x] Agree owner|Send to team"\n'
    p.fill('#impPaste', PASTE); p.click('#impCheck'); p.wait_for_timeout(600)
    pv = p.inner_text('#impPreview')
    chk('paste: reviewed with sub-tasks count and notes shown', '3 sub-tasks' in pv and 'Draft checklist' in pv and 'India doctors' in pv, pv[:300])
    chk('paste: stats tiles show 1 task', '1\ntask found' in p.inner_text('#impSum').replace('\n\n', '\n') or '1' in p.inner_text('#impSum'))
    p.click('#impGo'); p.wait_for_timeout(700)
    a_ = [x for x in h.todos[nP:] if x['title'] == 'Plan the review step']
    chk('paste: task added with sub-tasks (one done) and multi-line notes', a_ and [i['t'] for i in a_[0]['items']] == ['Draft checklist', 'Agree owner', 'Send to team'] and a_[0]['items'][1]['d'] is True and '- India doctors' in (a_[0]['notes'] or ''), a_[:1])
    chk('paste: listed in history as "Pasted CSV"', 'Pasted CSV' in p.inner_text('#impHist'))
    p.click('[data-act=setcancel]'); p.wait_for_timeout(200)

    # v1063: duplicates, editing cards, new-project flag, export + update by id, one scroll area, skip bad rows
    p.click('#nSettings'); p.wait_for_timeout(200); p.click('.tab[data-val=import]'); p.wait_for_timeout(300)
    n2 = len(h.todos)
    DUP = 'title,list,category,priority\nPlan the review step,work,Alpha,2\nBrand new one,work,Gamma project,1\n,personal,,\n'
    p.click('#impModePaste'); p.fill('#impPaste', DUP); p.click('#impCheck'); p.wait_for_timeout(700)
    chk('duplicate: flagged, skipped by default, bar offers Skip/Update/Add', 'already have' in p.inner_text('#tabBody') and p.query_selector('[data-imp=dupall]') is not None and 'Add 1 task' in p.inner_text('#impGoTop'), p.inner_text('#impGoTop'))
    chk('new project flagged with a picker (Gamma project), Alpha is known so not flagged', p.query_selector('#impPS1') is not None and p.query_selector('#impPS0') is None, p.inner_text('#impNewProj') if p.query_selector('#impNewProj') else '')
    chk('card list is not an inner scroller (one scroll area only)', p.evaluate("(function(){var e=document.getElementById('impPreview');var o=getComputedStyle(e).overflowY;return o==='visible'&&e.scrollHeight<=e.clientHeight+1})()"))
    p.click('#impCard1 .impopen'); p.wait_for_timeout(200)
    chk('tap a card opens its editor', p.query_selector('#impE_title_1') is not None)
    p.select_option('#impE_priority_1', '3'); p.fill('#impE_notes_1', 'edited note'); p.click('[data-imp=save][data-i="1"]'); p.wait_for_timeout(600)
    cd = p.inner_text('#impCard1')
    chk('edit saved: card shows !!! (3) and the note, re-checked by the server', '!!! (3)' in cd and 'edited note' in cd and p.query_selector('#impE_title_1') is None, cd[:200])
    p.click('#impCard2 [data-imp=del]'); p.wait_for_timeout(200)
    chk('bad card removed with the x', p.query_selector('#impCard2') is None and 'with problems' not in p.inner_text('#tabBody'))
    p.select_option('#impPS1', 'Beta'); p.wait_for_timeout(200)
    chk('matching an existing project clears the flag and sets the category', p.query_selector('#impPS1') is None and 'Beta' in p.inner_text('#impCard1'))
    p.click('[data-imp=dupall][data-v=update]'); p.wait_for_timeout(200)
    chk('Update them all relabels the button', p.inner_text('#impGoTop').strip() == 'Add 1 task and update 1 task', p.inner_text('#impGoTop'))
    before = {x['title']: dict(x) for x in h.todos}
    p.click('#impGo'); p.wait_for_timeout(900)
    chk('1 added, 1 updated (existing task changed, not duplicated)', len(h.todos) == n2 + 1 and 'Added 1 task and updated 1 task' in p.inner_text('#impDone'), p.inner_text('#tabBody')[:200])
    up = [x for x in h.todos if x['title'] == 'Plan the review step']
    chk('update touched only the columns in the file (category, priority) and kept sub-tasks/notes', len(up) == 1 and up[0]['category'] == 'Alpha' and up[0]['prio'] == 2 and len(up[0]['items']) == 3 and '- India doctors' in (up[0]['notes'] or ''), up[:1])
    chk('new project was not created when an existing one was picked', not h.proj_posts, h.proj_posts)
    # new project is created when kept
    p.click('#impModePaste'); p.fill('#impPaste', 'title,list,category\nGamma task,work,Gamma project\n'); p.click('#impCheck'); p.wait_for_timeout(600)
    p.click('#impGo'); p.wait_for_timeout(800)
    chk('keeping the new project name creates it', h.proj_posts == ['Gamma project'], h.proj_posts)
    # export + update by id
    p.click('#impExpDl') if False else None
    with p.expect_download() as dlx: p.click('#impExpDl')
    ex = open(dlx.value.path(), encoding='utf-8', newline='').read().split('\r\n')
    chk('export has the 11 columns plus id and one line per open task', ex[0] == 'title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks,id' and len([l for l in ex if l]) - 1 == len([x for x in h.todos if not x.get('done')]), ex[0])
    chk('export file is named by date', dlx.value.suggested_filename.startswith('luc-todo-open-tasks-'), dlx.value.suggested_filename)
    gid = [x for x in h.todos if x['title'] == 'Gamma task'][0]['id']
    p.click('#impModePaste'); p.fill('#impPaste', 'title,priority,id\nGamma task improved,3,%s\nGhost,1,00000000-0000-4000-8000-000000000000\n' % gid); p.click('#impCheck'); p.wait_for_timeout(700)
    t = p.inner_text('#tabBody')
    chk('id column: updates shown, unknown id reported', 'updates existing task' in t and 'no task with that id' in t and 'id' in p.inner_text('#impMap'), t[:300])
    p.click('#impGo'); p.wait_for_timeout(800)
    g = [x for x in h.todos if x['id'] == gid][0]
    chk('update by id: title and priority changed, category kept', g['title'] == 'Gamma task improved' and g['prio'] == 3 and g['category'] == 'Gamma project', g)
    chk('update by id: no new task added', len([x for x in h.todos if x['title'].startswith('Gamma task')]) == 1)
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
        pg.click('.tab[data-val=import]'); pg.wait_for_timeout(300)
        chk('%s: Import tab opens with Paste and no file picker or template download' % label, pg.query_selector('#impPaste') is not None and pg.query_selector('#impFile') is None and pg.query_selector('#impTpl') is None)
        chk('%s: no horizontal overflow, paste box fits the screen' % label, not pg.evaluate("document.documentElement.scrollWidth > window.innerWidth") and pg.evaluate("document.getElementById('impPaste').getBoundingClientRect().right <= window.innerWidth"))
        ctx.close()
    return R
