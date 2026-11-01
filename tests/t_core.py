"""Regression flows shared by both changes."""
def run(h):
    p = h.page; R = []
    def chk(name, cond, info=''): R.append((name, bool(cond), info))
    def calls(method, path): return [c for c in h.calls if c[0] == method and c[1] == path]

    chk('no Shopping rail button', p.query_selector('#nShopping') is None)
    chk('no Shopping view section', p.query_selector('#vShopping') is None)
    chk('no shopping.js loaded', 'shopping.js' not in p.content())
    p.click('#nPersonal'); p.wait_for_timeout(200)
    txt = p.inner_text('#cols')
    chk('personal list renders', 'Call dentist' in txt and 'Read book' in txt, txt[:200])
    chk('personal overdue shown', 'Overdue' in txt or 'overdue' in txt.lower(), txt[:300])
    # quick add / Shortcut path
    p.fill('#addInput', 'buy stamps fri #home'); p.press('#addInput', 'Enter'); p.wait_for_timeout(400)
    po = calls('POST', '/api/todos')
    chk('quick add posts {text}', po and po[-1][3].get('text') == 'buy stamps fri #home', po[-1:] if po else None)
    # recurring tick -> successor
    rid = [t for t in h.todos if t['title'] == 'Water plants'][0]['id']
    p.click('button.tick[data-id="%s"]' % rid); p.wait_for_timeout(600)
    pa = [c for c in calls('PATCH', '/api/todos') if c[2].get('id', [''])[0] == rid]
    chk('recurring tick patches done', pa and pa[-1][3].get('done') is True, pa[-1:] if pa else None)
    # work list: ordering + paused + blocked groups
    p.click('#nWork'); p.wait_for_timeout(300)
    wt = p.inner_text('#cols')
    chk('work list renders', 'Ship report' in wt and 'Review deck' in wt, wt[:200])
    chk('paused group shown', 'Paused' in wt and 'Waiting on legal' in wt)
    chk('blocked group shown', 'Blocked' in wt and 'Blocked thing' in wt)
    p.click('button.chip[data-act="resume"]'); p.wait_for_timeout(400)
    chk('resume calls /api/pause', calls('POST', '/api/pause'))
    # board, insights, budget, plan views
    for v, sel, word in [('board', '#boardPane', 'Alpha'), ('insights', '#insightsPane', ''), ('budget', '#budgetPane', ''), ('plan', '#planPane', '')]:
        p.click('#nProjects' if v == 'board' else '[data-act=nav][data-view=%s]' % v); p.wait_for_timeout(400)
        on = p.get_attribute('#v' + v[0].upper() + v[1:], 'class') or ''
        inner = p.inner_text(sel)
        chk('view %s opens' % v, 'on' in on and len(inner.strip()) > 0 and word in inner, (on, inner[:120]))
    # v1053: one Projects tab with a Work | Personal switch; no Workouts, no separate My projects / board tabs
    chk('no Workouts / old tabs', p.query_selector('#nWorkouts') is None and p.query_selector('#nBoard') is None and p.query_selector('#nPprojects') is None)
    p.click('#nProjects'); p.wait_for_timeout(300)
    chk('Projects tab switch visible', p.is_visible('#projSwitch'))
    p.click('#psP'); p.wait_for_timeout(500)
    chk('switch to Personal projects', 'on' in (p.get_attribute('#vPprojects', 'class') or '') and 'on' in (p.get_attribute('#psP', 'class') or ''))
    p.click('#psW'); p.wait_for_timeout(500)
    chk('switch back to Work board', 'Alpha' in p.inner_text('#boardPane'))
    # round 2: overdue "Move to" collapsed behind one button
    p.click('#nPersonal'); p.wait_for_timeout(400)
    chk('overdue shows one Move to… button', p.query_selector('button.moveopen') is not None and not p.is_visible('button[data-act=quick]'))
    p.click('button.moveopen'); p.wait_for_timeout(300)
    chk('Move to… reveals the options', p.is_visible('button[data-act=quick]'))
    # settings + screensaver try
    p.click('#nSettings'); p.wait_for_timeout(300)
    tabs = p.inner_text('#settings')
    chk('settings has no Shopping tab', 'Shopping' not in tabs, tabs[:200])
    p.click('[data-act=stab][data-val=saver]'); p.wait_for_timeout(300)
    t = p.query_selector('[data-sv=try]')
    if t:
        t.click(); p.wait_for_timeout(600)
        chk('screensaver starts', p.is_visible('#saver'))
        p.click('#saver'); p.wait_for_timeout(300)
    else:
        chk('screensaver try button present', False)
    p.click('#settings', position={'x': 5, 'y': 5}); p.wait_for_timeout(300)  # tap the backdrop to close Settings
    chk('settings closes', not p.is_visible('#settings'))
    chk('never calls /api/shopping', not [c for c in h.calls if 'shopping' in c[1]])
    return R
