"""My projects v3: In progress / Live statuses, folded headers on one line, multiple links, Vercel picker, paused deploys,
collapsible activity (plus core regression flows first).
v1044 (Deploy 1): fixed-height layout (lanes scroll on their own, frozen side panel, back bar always visible) at iPad
landscape, iPad portrait and iPhone sizes, and the Vercel picker replacing only the websites/GitHub it filled in.
v1045 (Deploy 2): Idea status (shelved, Backlog default), Reason (edit, log, card), "still live on Vercel" warning,
drag-and-drop order within a lane (mouse and synthetic touch), new projects first, order kept across lanes.
v1046: Idea lane hidden when empty; background refreshes touch nothing (no flicker, cursor kept) and a real redraw
keeps the cursor position in the field being typed in.
v1047 (Deploy 3): subscriptions and costs per project (add/edit/delete, totals, roll-forward of due dates,
"due soon" on cards, "also in Budget" hint, activity entries).
v1048 (Deploy 4a): account labels (typed and filled by the picker), custom icon upload (resized to 128px), icon from
website, remove -> letter, stored icon address; Edit details keeps the Reason.
v1049 (Deploy 4b): vault UI (not configured, setup, add/reveal/hide/copy/edit/delete, lock now, idle lock, lock on
leaving, wrong password, expired pass, forgotten-password wipe; POST only, nothing sensitive in URLs or activity).
Server-side crypto is tested separately: node tests/vault_node.js."""
import importlib.util, os
D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, 'out'); os.makedirs(OUT, exist_ok=True)  # screenshots (git-ignored)
spec = importlib.util.spec_from_file_location('tc', os.path.join(D, 't_core.py')); tc = importlib.util.module_from_spec(spec); spec.loader.exec_module(tc)

def run(h):
    R = tc.run(h)
    p = h.page
    def chk(name, cond, info=''): R.append(('PP: ' + name, bool(cond), info))
    def calls(m, path): return [c for c in h.calls if c[0] == m and c[1] == path]
    def tid(title): return [t for t in h.todos if t['title'] == title][0]['id']
    def wait(ms=400): p.wait_for_timeout(ms)

    p.click('#nPprojects'); wait()
    for n in ('Holmlodge Hub', 'Old App'):
        p.fill('#ppNew', n); p.press('#ppNew', 'Enter'); wait()
    hub = [x for x in h.pprojects if x['name'] == 'Holmlodge Hub'][0]['id']
    old = [x for x in h.pprojects if x['name'] == 'Old App'][0]['id']
    chk('new projects default to In progress', all(x['status'] == 'in_progress' for x in h.pprojects))
    heads = [e.inner_text() for e in p.query_selector_all('#ppPane .bdhead .bdname')]
    chk('5 status columns, In progress first (empty Idea lane hidden)', heads == ['In progress', 'Live', 'Paused', 'Not pursued', 'Shut down'], heads)
    for v in ('not_pursued', 'shut_down'):
        nm = p.query_selector('[data-pp=fold][data-val=%s] .bdname' % v)
        box = nm.bounding_box(); lh = p.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)', nm)
        chk('folded "%s" header on one line' % v, box['height'] < lh * 1.5, (box, lh))
    # Live: tasks still normal, card not dimmed
    p.click('.ppcard[data-id="%s"] [data-pp=mv]' % hub); wait(200)
    p.click('.ppcard[data-id="%s"] [data-pp=stat][data-val=live]' % hub); wait(500)
    chk('move to Live', calls('PATCH', '/api/pprojects')[-1][3] == {'status': 'live'})
    cols = p.query_selector_all('#ppPane .bdcol')
    chk('card in Live column, not dimmed', 'Holmlodge Hub' in cols[1].inner_text() and 'off' not in p.get_attribute('.ppcard[data-id="%s"]' % hub, 'class'))
    # details with Vercel picker + multiple links
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait()
    p.fill('#ppTask', 'Fix the login bug'); p.press('#ppTask', 'Enter'); wait(500)
    p.click('[data-pp=det]'); wait(500)
    opts = p.inner_text('#ppVsel')
    chk('Vercel picker lists projects', 'holmlodge-hub' in opts and 'old-app (paused)' in opts, opts)
    p.select_option('#ppVsel', 'teamevo/holmlodge-hub'); wait(600)
    sites = [e.input_value() for e in p.query_selector_all('[data-f^="site:"]')]
    chk('picker fills websites', 'https://hub.example.com' in sites and 'https://holmlodge-hub.vercel.app' in sites, sites)
    chk('picker fills GitHub', p.input_value('[data-f=github]') == 'https://github.com/Levo54321/hub')
    p.fill('[data-f="ll:0"]', 'Claude project'); p.fill('[data-f="lu:0"]', 'https://claude.ai/project/abc')
    p.click('[data-pp=addlink]'); wait(200)
    chk('typed values survive adding a row', p.input_value('[data-f="lu:0"]') == 'https://claude.ai/project/abc')
    p.fill('[data-f="ll:1"]', 'Session'); p.fill('[data-f="lu:1"]', 'https://claude.ai/code/xyz')
    p.click('[data-pp=addsite]'); wait(200)
    p.fill('[data-f="site:2"]', 'https://www.hub.co.uk')
    p.click('[data-pp=rmsite][data-val="1"]'); wait(200)
    p.click('#ppDetForm button[type=submit]'); wait(700)
    m = calls('PATCH', '/api/pprojects')[-1][3].get('meta', {})
    chk('meta saved with lists', m.get('sites') == ['https://hub.example.com', 'https://www.hub.co.uk'] and m.get('vercel') == 'https://vercel.com/teamevo/holmlodge-hub'
        and m.get('links') == [{'l': 'Claude project', 'u': 'https://claude.ai/project/abc'}, {'l': 'Session', 'u': 'https://claude.ai/code/xyz'}], m)
    side = p.inner_text('.ppside')
    chk('side lists every link', all(w in side for w in ['Website', 'hub.example.com', 'hub.co.uk', 'Claude project', 'Session', 'GitHub', 'Vercel']), side)
    chk('Live hint shown', 'Live: tasks you add still show up' in side)
    # activity collapsible
    act = p.query_selector('[data-pp=act]')
    was = act.get_attribute('aria-expanded')
    p.click('[data-pp=act]'); wait()
    chk('activity toggles', p.get_attribute('[data-pp=act]', 'aria-expanded') != was)
    exp = p.get_attribute('[data-pp=act]', 'aria-expanded') == 'true'
    chk('activity list follows toggle', bool(p.query_selector('.ppev')) == exp or not exp)
    if exp: p.click('[data-pp=act]'); wait()
    chk('activity collapsed hides list', not p.query_selector('.ppev'))
    p.screenshot(path=os.path.join(OUT, 'pp3_page.png'))
    # paused-in-Vercel project shows paused, not live
    p.click('[data-pp=back]'); wait()
    p.click('.ppcard[data-id="%s"] .ppnm' % old); wait()
    p.click('[data-pp=det]'); wait(400)
    p.select_option('#ppVsel', 'teamevo/old-app'); wait(600)
    p.click('#ppDetForm button[type=submit]'); wait(700)
    side = p.inner_text('.ppside')
    chk('paused Vercel project says Paused, not Live', 'Paused in Vercel' in side and 'Live ·' not in side, side)
    p.click('[data-pp=back]'); wait()
    chk('card dot is the paused style', p.query_selector('.ppcard[data-id="%s"] .ppdot.paused' % old))
    p.screenshot(path=os.path.join(OUT, 'pp3_board.png'))
    # Live project task appears in Personal list normally
    p.click('#nPersonal'); wait()
    chk('Live project task is not shelved', p.evaluate('id => App.isShelved(App.find(id))', tid('Fix the login bug')) is False)
    p.set_viewport_size({'width': 390, 'height': 844}); wait()
    p.click('#nPprojects'); wait()
    chk('board fits iPhone width', p.evaluate('document.documentElement.scrollWidth') <= 392, p.evaluate('document.documentElement.scrollWidth'))
    for v in ('not_pursued', 'shut_down'):
        nm = p.query_selector('[data-pp=fold][data-val=%s] .bdname' % v)
        chk('iPhone folded "%s" on one line' % v, nm.bounding_box()['height'] < 30, nm.bounding_box())
    p.screenshot(path=os.path.join(OUT, 'pp3_iphone.png'), full_page=True)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait()
    layout_checks(h, chk, wait)
    picker_checks(h, chk, wait, calls)
    d2_checks(h, chk, wait, calls)
    idle_checks(h, chk, wait)
    cost_checks(h, chk, wait, calls)
    d4a_checks(h, chk, wait, calls)
    vault_checks(h, chk, wait, calls)
    return R

def layout_checks(h, chk, wait):
    p = h.page
    import uuid as _u
    for i in range(9):  # enough projects to overflow the lanes
        h.pprojects.append({'id': str(_u.uuid4()), 'name': 'Filler %d' % i, 'status': 'in_progress' if i < 6 else 'live', 'created_at': '2026-10-01T09:00:00Z', 'pos': 100 + i,
                            'last_at': '2026-10-01T09:00:00Z', 'done_old': 0, 'meta': {'desc': 'A project with a description that wraps onto a second line'}})
    big = h.pprojects[-1]['id']
    for i in range(30):
        h.todos.append(dict(h.todos[2], id=str(_u.uuid4()), title='Long task %d' % i, pproject_id=big, pp_backlog=i % 2 == 0, due_date=None, done=False))
    p.evaluate("ts => { for (var i = 0; i < ts.length; i++) App.todos().push(ts[i]); App.mutated(); }", [t for t in h.todos if t.get('pproject_id') == big])
    js_metrics = """() => { var v=document.getElementById('vPprojects'), sv=v.querySelector('.scrollview'), cols=v.querySelector('.bdcols');
      var lanes=[].map.call(v.querySelectorAll('.pplane'), function(l){var r=l.getBoundingClientRect(); return {k:l.getAttribute('data-lane'), sh:l.scrollHeight, ch:l.clientHeight, bottom:r.bottom, ov:getComputedStyle(l).overflowY};});
      var c=cols?cols.getBoundingClientRect():null;
      return {fix:/ppfix/.test(v.className), svSh:sv.scrollHeight, svCh:sv.clientHeight, H:innerHeight, W:innerWidth, docW:document.documentElement.scrollWidth,
        colsBottom:c&&c.bottom, colsSW:cols&&cols.scrollWidth, colsCW:cols&&cols.clientWidth, lanes:lanes,
        paneSW:document.getElementById('ppPane').scrollWidth, paneCW:document.getElementById('ppPane').clientWidth}; }"""
    for (w, ht, tag) in ((1024, 768, 'iPad landscape'), (768, 1024, 'iPad portrait')):
        p.set_viewport_size({'width': w, 'height': ht}); wait(300)
        p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(600)
        if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(300)
        if p.query_selector('[data-pp=fold][data-val=paused][aria-expanded=false]'): p.click('[data-pp=fold][data-val=paused]'); wait(300)
        m = p.evaluate(js_metrics)
        chk(tag + ': fixed layout on', m['fix'], m)
        chk(tag + ': page itself does not scroll', m['svSh'] <= m['svCh'] + 1, (m['svSh'], m['svCh']))
        chk(tag + ': lanes end inside the window', m['colsBottom'] <= m['H'], (m['colsBottom'], m['H']))
        ip = [l for l in m['lanes'] if l['k'] == 'in_progress'][0]
        chk(tag + ': In progress lane scrolls on its own', ip['sh'] > ip['ch'] and ip['ov'] == 'auto' and ip['bottom'] <= m['H'], ip)
        chk(tag + ': no horizontal page overflow', m['docW'] <= m['W'] and m['paneSW'] <= m['paneCW'] + 1, m)
        top0 = p.evaluate("document.getElementById('ppNew').getBoundingClientRect().top")
        lv0 = p.evaluate("document.querySelector('.pplane[data-lane=live]').scrollTop")  # Playwright may have scrolled it to click a card
        p.evaluate("document.querySelector('.pplane[data-lane=in_progress]').scrollTop = 300"); wait(200)
        r = p.evaluate("""() => ({lane: document.querySelector('.pplane[data-lane=in_progress]').scrollTop, live: document.querySelector('.pplane[data-lane=live]').scrollTop,
            sv: document.querySelector('#vPprojects .scrollview').scrollTop, top: document.getElementById('ppNew').getBoundingClientRect().top})""")
        chk(tag + ': scrolling one lane moves nothing else', r['lane'] > 0 and r['live'] == lv0 and r['sv'] == 0 and abs(r['top'] - top0) < 1, (r, lv0))
        if m['colsSW'] > m['colsCW']:
            p.evaluate("document.querySelector('#ppPane .bdcols').scrollLeft = 200")
        p.click('[data-pp=fold][data-val=shut_down]'); wait(300)  # repaint
        r2 = p.evaluate("""() => ({lane: document.querySelector('.pplane[data-lane=in_progress]').scrollTop, left: document.querySelector('#ppPane .bdcols').scrollLeft})""")
        chk(tag + ': repaint keeps lane and sideways scroll', r2['lane'] == r['lane'] and (m['colsSW'] <= m['colsCW'] or r2['left'] > 0), (r, r2, m['colsSW'], m['colsCW']))
        p.click('[data-pp=fold][data-val=shut_down]'); wait(300)
        if tag == 'iPad landscape':
            m2 = p.evaluate(js_metrics)
            chk(tag + ': lanes strip scrolls sideways with all lanes open', m2['colsSW'] > m2['colsCW'], (m2['colsSW'], m2['colsCW']))
        p.screenshot(path=os.path.join(OUT, 'd1_board_%dx%d.png' % (w, ht)))
        # project page
        p.click('.ppcard[data-id="%s"] .ppnm' % big); wait(500)
        pm = p.evaluate("""() => { function r(s){var e=document.querySelector(s); return e?e.getBoundingClientRect():null;}
            var m=document.querySelector('.ppmain'), sd=document.querySelector('.ppside');
            return {back:r('[data-pp=back]'), side:r('.ppside'), main:r('.ppmain'), wrap:r('.ppwrap'), msh:m.scrollHeight, mch:m.clientHeight,
              sv:document.querySelector('#vPprojects .scrollview').scrollTop, H:innerHeight, W:innerWidth, docW:document.documentElement.scrollWidth}; }""")
        chk(tag + ': side panel fills the height', abs(pm['side']['height'] - pm['wrap']['height']) < 1 and pm['side']['bottom'] <= pm['H'] and pm['H'] - pm['side']['bottom'] < 30, pm)
        chk(tag + ': right side scrolls', pm['msh'] > pm['mch'], (pm['msh'], pm['mch']))
        p.evaluate("document.querySelector('.ppmain').scrollTop = 99999"); wait(200)
        pm2 = p.evaluate("""() => ({back: document.querySelector('[data-pp=back]').getBoundingClientRect().top, side: document.querySelector('.ppside').getBoundingClientRect().top,
             sv: document.querySelector('#vPprojects .scrollview').scrollTop, main: document.querySelector('.ppmain').scrollTop})""")
        chk(tag + ': back bar and side stay put while tasks scroll', pm2['main'] > 0 and pm2['sv'] == 0 and abs(pm2['back'] - pm['back']['top']) < 1 and abs(pm2['side'] - pm['side']['top']) < 1 and pm2['back'] >= 0, (pm, pm2))
        chk(tag + ': project page has no horizontal overflow', pm['docW'] <= pm['W'], pm)
        p.click('[data-pp=act]'); wait(300)  # repaint keeps the right side where it was
        chk(tag + ': repaint keeps the task scroll', p.evaluate("document.querySelector('.ppmain').scrollTop") > 0)
        p.click('[data-pp=act]'); wait(300)
        p.screenshot(path=os.path.join(OUT, 'd1_page_%dx%d.png' % (w, ht)))
        p.click('[data-pp=back]'); wait(400)
        chk(tag + ': back to board restores the lane scroll', p.evaluate("document.querySelector('.pplane[data-lane=in_progress]').scrollTop") > 0)
    # iPhone: stacked, page scrolls normally
    p.set_viewport_size({'width': 390, 'height': 844}); wait(400)
    m = p.evaluate(js_metrics)
    chk('iPhone: stacked layout (not fixed)', not m['fix'] and all(l['ov'] == 'visible' for l in m['lanes']), m)
    chk('iPhone: no horizontal overflow on board', m['docW'] <= 392, m['docW'])
    p.click('.ppcard[data-id="%s"] .ppnm' % big); wait(500)
    chk('iPhone: no horizontal overflow on project page', p.evaluate('document.documentElement.scrollWidth') <= 392)
    chk('iPhone: side panel stacked below', p.evaluate("document.querySelector('.ppside').getBoundingClientRect().top > document.querySelector('.ppmain').getBoundingClientRect().top"))
    p.screenshot(path=os.path.join(OUT, 'd1_iphone_page.png'), full_page=True)
    p.click('[data-pp=back]'); wait(300)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(400)

def picker_checks(h, chk, wait, calls):
    p = h.page
    p.fill('#ppNew', 'Picker Test'); p.press('#ppNew', 'Enter'); wait(500)
    pid = [x for x in h.pprojects if x['name'] == 'Picker Test'][0]['id']
    p.click('.ppcard[data-id="%s"] .ppnm' % pid); wait(400)
    p.click('[data-pp=det]'); wait(500)
    p.fill('[data-f="site:0"]', 'https://mine.example.com')
    p.select_option('#ppVsel', 'teamevo/holmlodge-hub'); wait(600)
    sites = lambda: [e.input_value() for e in p.query_selector_all('[data-f^="site:"]')]
    chk('picker adds domains, keeps typed site', sites() == ['https://mine.example.com', 'https://hub.example.com', 'https://holmlodge-hub.vercel.app'], sites())
    p.select_option('#ppVsel', 'teamevo/old-app'); wait(600)
    chk('switching to a one-domain project drops the old extra domains', sites() == ['https://mine.example.com', 'https://old-app.vercel.app'], sites())
    chk('switching replaces picker GitHub', p.input_value('[data-f=github]') == 'https://github.com/Levo54321/old', p.input_value('[data-f=github]'))
    p.fill('[data-f=github]', 'https://github.com/Levo54321/my-own')
    p.select_option('#ppVsel', 'teamevo/holmlodge-hub'); wait(600)
    chk('typed GitHub is kept on switch', p.input_value('[data-f=github]') == 'https://github.com/Levo54321/my-own')
    chk('switch back replaces again', sites() == ['https://mine.example.com', 'https://hub.example.com', 'https://holmlodge-hub.vercel.app'], sites())
    p.select_option('#ppVsel', ''); wait(400)
    chk('None removes picker websites only', sites() == ['https://mine.example.com'], sites())
    p.select_option('#ppVsel', 'teamevo/holmlodge-hub'); wait(600)
    p.click('#ppDetForm button[type=submit]'); wait(700)
    m = calls('PATCH', '/api/pprojects')[-1][3].get('meta', {})
    chk('saved picker result', m.get('sites') == ['https://mine.example.com', 'https://hub.example.com', 'https://holmlodge-hub.vercel.app'] and m.get('github') == 'https://github.com/Levo54321/my-own', m)
    # reopening a saved project: its saved domains are recognised as picker-filled
    p.click('[data-pp=det]'); wait(700)
    p.select_option('#ppVsel', 'teamevo/old-app'); wait(600)
    chk('saved project: switching drops the previous project domains', sites() == ['https://mine.example.com', 'https://old-app.vercel.app'], sites())
    p.click('[data-pp=detx]'); wait(300)
    p.click('[data-pp=back]'); wait(300)


def d2_checks(h, chk, wait, calls):
    p = h.page
    def pid(name): return [x for x in h.pprojects if x['name'] == name][0]['id']
    def lane_ids(k): return p.evaluate("k => [].map.call(document.querySelectorAll('.pplane[data-lane=' + k + '] .ppcard'), function(c){return c.getAttribute('data-id');})", k)
    p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(600)
    if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(300)
    # new project goes to the top of its lane
    p.fill('#ppNew', 'Dream App'); p.press('#ppNew', 'Enter'); wait(500)
    dream = pid('Dream App')
    chk('new project goes to the top of In progress', lane_ids('in_progress')[0] == dream, lane_ids('in_progress'))
    # move to Idea
    p.click('.ppcard[data-id="%s"] [data-pp=mv]' % dream); wait(200)
    p.click('.ppcard[data-id="%s"] [data-pp=stat][data-val=idea]' % dream); wait(500)
    chk('move to Idea patches status idea', calls('PATCH', '/api/pprojects')[-1][3] == {'status': 'idea'})
    chk('card sits in the Idea lane', lane_ids('idea') == [dream], lane_ids('idea'))
    heads = [e.inner_text() for e in p.query_selector_all('#ppPane .bdhead .bdname')]
    chk('Idea lane appears first once it holds a project', heads[:2] == ['Idea', 'In progress'], heads)
    # project page: idea hint, Backlog default, reason
    p.click('.ppcard[data-id="%s"] .ppnm' % dream); wait(500)
    side = p.inner_text('.ppside')
    chk('Idea hint on project page', 'Idea: not started yet' in side, side)
    chk('Idea project defaults new tasks to Backlog', 'on' in (p.get_attribute('[data-pp=to][data-val=backlog]', 'class') or ''))
    p.click('[data-pp=to][data-val=list]'); wait(200)
    p.fill('#ppTask', 'Sketch the idea'); p.press('#ppTask', 'Enter'); wait(500)
    t = [x for x in h.todos if x['title'] == 'Sketch the idea'][0]
    chk('Idea project task is shelved', p.evaluate('id => App.isShelved(App.find(id))', t['id']) is True)
    p.click('[data-pp=redit]'); wait(200)
    p.fill('#ppReason', 'Waiting until the Hub is finished'); p.click('[data-pp=rsave]'); wait(600)
    m = calls('PATCH', '/api/pprojects')[-1][3].get('meta', {})
    chk('reason saved in details', m.get('reason') == 'Waiting until the Hub is finished', m)
    chk('reason shown on the page', 'Why: Waiting until the Hub is finished' in p.inner_text('.ppside'))
    if p.get_attribute('[data-pp=act]', 'aria-expanded') != 'true': p.click('[data-pp=act]'); wait(200)
    p.evaluate("App.render()"); wait(2000)
    chk('reason change appears in activity', 'Reason: Waiting until the Hub is finished' in p.inner_text('.ppmain'), p.inner_text('.ppmain')[-400:])
    # clearing the reason
    p.click('[data-pp=redit]'); wait(200); p.fill('#ppReason', ''); p.click('[data-pp=rsave]'); wait(600)
    chk('reason can be cleared', 'reason' not in calls('PATCH', '/api/pprojects')[-1][3].get('meta', {}) and '+ Add a reason' in p.inner_text('.ppside'))
    p.click('[data-pp=redit]'); wait(200); p.fill('#ppReason', 'Parked'); p.click('[data-pp=rsave]'); wait(600)
    # changing to Paused on the page asks for the reason only if none
    p.click('[data-pp=stat][data-val=in_progress]'); wait(400)
    chk('reason hidden for In progress', 'Why:' not in p.inner_text('.ppside') and not p.query_selector('[data-pp=redit]'))
    p.click('[data-pp=back]'); wait(300)
    chk('reason hidden on card for In progress', 'Why:' not in p.inner_text('.ppcard[data-id="%s"]' % dream))
    chk('Idea lane hidden again once empty', not p.query_selector('[data-pp=fold][data-val=idea]') and p.inner_text('#ppPane .bdhead .bdname') == 'In progress')
    hub = pid('Holmlodge Hub')
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait(500)
    p.click('[data-pp=stat][data-val=paused]'); wait(500)
    chk('moving to Paused opens the reason box', p.query_selector('#ppReason') is not None)
    chk('mismatch warning on project page', 'Marked paused but still live on Vercel' in p.inner_text('.ppside'), p.inner_text('.ppside')[:300])
    p.fill('#ppReason', 'Hosting costs too much'); p.click('[data-pp=rsave]'); wait(600)
    p.click('[data-pp=back]'); wait(300)
    card = p.inner_text('.ppcard[data-id="%s"]' % hub)
    chk('mismatch warning and reason on the card', 'Marked paused but still live on Vercel' in card and 'Why: Hosting costs too much' in card, card)
    chk('board summary counts the mismatch', '1 still live on Vercel' in p.inner_text('.ppsum'), p.inner_text('.ppsum'))
    old = pid('Old App')
    chk('paused-in-Vercel project has no warning', 'still live' not in p.inner_text('.ppcard[data-id="%s"]' % old))
    p.click('.ppcard[data-id="%s"] [data-pp=mv]' % hub); wait(200)
    p.click('.ppcard[data-id="%s"] [data-pp=stat][data-val=live]' % hub); wait(500)
    chk('warning goes when back to Live', 'still live' not in p.inner_text('.ppcard[data-id="%s"]' % hub))
    # drag and drop with the mouse: first card of In progress to third place
    before = lane_ids('in_progress')
    g = p.query_selector('.ppcard[data-id="%s"] [data-pp=grip]' % before[0]).bounding_box()
    tgt = p.query_selector('.ppcard[data-id="%s"]' % before[2]).bounding_box()
    n0 = len(calls('PATCH', '/api/pprojects'))
    p.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2); p.mouse.down()
    for k in range(1, 11): p.mouse.move(g['x'] + g['width'] / 2, g['y'] + (tgt['y'] + tgt['height'] * 0.7 - g['y']) * k / 10); wait(30)
    p.mouse.up(); wait(600)
    after = lane_ids('in_progress')
    want = before[1:3] + [before[0]] + before[3:]
    oc = [c for c in calls('PATCH', '/api/pprojects')[n0:] if 'order' in c[2]]
    chk('mouse drag reorders the lane', after == want, (before, after))
    chk('drag saves the order', oc and oc[-1][3].get('ids') == want, oc[-1:] if oc else None)
    chk('drag does not open the project', not p.query_selector('[data-pp=back]'))
    # synthetic touch drag (iOS path): third card back to the top
    before = lane_ids('in_progress')
    res = p.evaluate("""ids => {
      var g = document.querySelector('.ppcard[data-id="' + ids[2] + '"] [data-pp=grip]'), t0 = document.querySelector('.ppcard[data-id="' + ids[0] + '"]');
      var gb = g.getBoundingClientRect(), tb = t0.getBoundingClientRect(), x = gb.left + 5;
      function fire(type, y) { var tc = new Touch({identifier: 1, target: g, clientX: x, clientY: y});
        var ev = new TouchEvent(type, {touches: type === 'touchend' ? [] : [tc], targetTouches: type === 'touchend' ? [] : [tc], changedTouches: [tc], bubbles: true, cancelable: true});
        return g.dispatchEvent(ev); }
      var started = !fire('touchstart', gb.top + 5);
      for (var k = 1; k <= 8; k++) fire('touchmove', gb.top + 5 + (tb.top + 4 - gb.top - 5) * k / 8);
      fire('touchend', tb.top + 4);
      return started; }""", before)
    wait(600)
    after = lane_ids('in_progress')
    chk('touch drag reorders the lane (handler prevents scrolling)', res and after == [before[2]] + before[0:2] + before[3:], (res, before, after))
    # order kept across lanes: move the 2nd card to Live; Live stays sorted by position
    mover = after[1]
    p.click('.ppcard[data-id="%s"] [data-pp=mv]' % mover); wait(200)
    p.click('.ppcard[data-id="%s"] [data-pp=stat][data-val=live]' % mover); wait(500)
    live = lane_ids('live'); pos = dict((x['id'], x.get('pos', 0)) for x in h.pprojects)
    chk('project keeps its place by position in the new lane', mover in live and [pos[i] for i in live] == sorted(pos[i] for i in live), [(i[:4], pos[i]) for i in live])
    p.reload(); wait(1200); p.click('#nPprojects'); wait(600)
    if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(300)
    chk('order survives a reload', lane_ids('in_progress')[0] == before[2], lane_ids('in_progress'))
    p.screenshot(path=os.path.join(OUT, 'd2_board.png'))
    # iPhone: drag handle there, no overflow
    p.set_viewport_size({'width': 390, 'height': 844}); wait(400)
    chk('iPhone: board with Idea lane fits', p.evaluate('document.documentElement.scrollWidth') <= 392)
    gb = p.query_selector('.pplane[data-lane=in_progress] [data-pp=grip]').bounding_box()
    chk('drag handle is a 44px target', gb['width'] >= 44 and gb['height'] >= 44, gb)
    p.screenshot(path=os.path.join(OUT, 'd2_iphone.png'), full_page=True)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(400)


SPY = """() => { window._w = {value: 0, focus: 0, scroll: 0}; window._undo = [];
  function wrap(proto, prop, key) { var d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, {get: d.get, set: function (v) { window._w[key]++; d.set.call(this, v); }, configurable: true});
    window._undo.push(function () { Object.defineProperty(proto, prop, d); }); }
  wrap(HTMLInputElement.prototype, 'value', 'value'); wrap(HTMLTextAreaElement.prototype, 'value', 'value');
  wrap(Element.prototype, 'scrollTop', 'scroll'); wrap(Element.prototype, 'scrollLeft', 'scroll');
  var f = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function () { window._w.focus++; return f.apply(this, arguments); };
  window._undo.push(function () { HTMLElement.prototype.focus = f; });
  window._attr = 0; window._kids = 0;
  window._mo = new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].type === 'attributes') window._attr++; else window._kids++; });
  window._mo.observe(document.getElementById('vPprojects'), {attributes: true, childList: true, subtree: true}); }"""
UNSPY = """() => { window._mo.disconnect(); for (var i = 0; i < window._undo.length; i++) window._undo[i]();
  return {value: window._w.value, focus: window._w.focus, scroll: window._w.scroll, attr: window._attr, kids: window._kids}; }"""

def idle_checks(h, chk, wait):
    """The background refresh (core load() every 15s -> App.render) must not touch My projects when nothing changed."""
    p = h.page
    for (w, ht, tag) in ((1024, 768, 'iPad'), (390, 844, 'iPhone')):
        p.set_viewport_size({'width': w, 'height': ht}); wait(400)
        p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(800)
        if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(400)
        for where in ('board', 'page'):
            if where == 'page': p.click('.pplane[data-lane=in_progress] .ppcard .ppnm'); wait(800)
            fid = '#ppNew' if where == 'board' else '#ppTask'
            p.click(fid); p.fill(fid, 'half-typed words'); p.evaluate("s => { var e = document.querySelector(s); e.focus(); e.setSelectionRange(4, 4); }", fid)
            if where == 'page': p.evaluate("document.querySelector('.ppmain').scrollTop = 40")
            p.evaluate(SPY)
            for k in range(3):  # what core's 15-second refresh does: fresh copies of every task, then App.render()
                p.evaluate("() => { var a = App.todos(), c = JSON.parse(JSON.stringify(a)); a.length = 0; for (var i = 0; i < c.length; i++) a.push(c[i]); App.render(); }"); wait(150)
            r = p.evaluate(UNSPY)
            sel = p.evaluate("s => [document.activeElement === document.querySelector(s), document.querySelector(s).selectionStart, document.querySelector(s).value]", fid)
            chk('%s %s: background refresh writes nothing (no flicker)' % (tag, where), r == {'value': 0, 'focus': 0, 'scroll': 0, 'attr': 0, 'kids': 0}, r)
            chk('%s %s: cursor stays where it was while typing' % (tag, where), sel == [True, 4, 'half-typed words'], sel)
        # a real change while typing: the field is redrawn but the cursor comes back to the same place
        p.evaluate("s => { var e = document.querySelector(s); e.focus(); e.setSelectionRange(6, 6); }", '#ppTask')
        pid = p.evaluate("document.getElementById('ppPane').getAttribute('data-sel')")
        p.evaluate("""pid => { var t = JSON.parse(JSON.stringify(App.todos()[0])); t.id = 'x' + Math.random(); t.title = 'Arrived from the phone'; t.pproject_id = pid;
            t.pp_backlog = true; t.done = false; t.list = 'personal'; App.todos().push(t); App.render(); }""", pid); wait(300)
        sel = p.evaluate("[document.activeElement && document.activeElement.id, document.getElementById('ppTask').selectionStart, document.getElementById('ppTask').value, document.getElementById('ppPane').innerText.indexOf('Arrived from the phone') >= 0]")
        chk('%s: real redraw shows the change and keeps focus + cursor' % tag, sel == ['ppTask', 6, 'half-typed words', True], sel)
        p.fill('#ppTask', ''); p.click('[data-pp=back]'); wait(300); p.fill('#ppNew', '')
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(400)


def cost_checks(h, chk, wait, calls):
    p = h.page
    def pid(name): return [x for x in h.pprojects if x['name'] == name][0]['id']
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(300)
    p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(700)
    if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(300)
    hub = pid('Holmlodge Hub')
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); p.wait_for_selector('.ppside .ppcosts'); wait(300)
    chk('costs section on project page', 'subscriptions and costs' in p.inner_text('.ppside').lower() and p.query_selector('[data-pp=cadd]'))
    # add a monthly cost
    p.click('[data-pp=cadd]'); wait(200)
    p.fill('#ppCname', 'Vercel Pro'); p.fill('#ppCamt', '16')
    p.fill('#ppCdue', '2026-11-03'); p.fill('#ppCemail', 'Luc@Example.com')
    p.click('#ppCostForm button[type=submit]'); wait(600)
    po = [c for c in calls('POST', '/api/pprojects') if 'cost' in c[2]]
    chk('add cost posts the right body', po and po[-1][3] == {'name': 'Vercel Pro', 'amount': 16, 'currency': 'GBP', 'freq': 'monthly', 'next_due': '2026-11-03',
        'link': '', 'email': 'Luc@Example.com', 'project_id': hub}, po[-1][3] if po else None)
    side = p.inner_text('.ppside')
    chk('cost row shows amount, frequency and due', '£16' in side and 'a month' in side and 'in 2 days' in side, side[side.lower().find('subscriptions'):][:300])
    chk('"also in Budget" hint on a matching name', 'also in Budget' in side)
    # yearly domain in the past: rolls forward a year; one-off overdue
    p.click('[data-pp=cadd]'); wait(200)
    p.fill('#ppCname', 'Domain renewal'); p.fill('#ppCamt', '12.5'); p.click('[data-pp=cfreq][data-val=yearly]'); wait(150)
    p.fill('#ppCdue', '2025-11-10'); p.fill('#ppClink', 'https://porkbun.com/account')
    p.click('#ppCostForm button[type=submit]'); wait(600)
    p.click('[data-pp=cadd]'); wait(200)
    p.fill('#ppCname', 'Logo design'); p.fill('#ppCamt', '40'); p.click('[data-pp=cfreq][data-val=one_off]'); wait(150)
    p.fill('#ppCdue', '2026-10-25'); p.click('#ppCostForm button[type=submit]'); wait(600)
    side = p.inner_text('.ppside')
    chk('yearly cost rolls forward to next year', '10 Nov 2026' in side, side[side.find('Domain'):][:120])
    chk('totals per month and year (+ one-off)', '£17.04 a month · £204.50 a year · £40 one-off' in side, side[side.lower().find('subscriptions'):])
    chk('no "also in Budget" for unrelated names', side.count('also in Budget') == 1)
    # edit: typing survives a background refresh, then change amount
    ids = [c['id'] for c in [x for x in h.pprojects if x['id'] == hub][0]['costs']]
    p.click('.ppcost [data-pp=cedit][data-id="%s"]' % ids[0]); wait(200)
    p.fill('#ppCamt', '20'); p.evaluate("App.render()"); wait(200)
    chk('cost edit survives a background refresh', p.input_value('#ppCamt') == '20')
    p.click('#ppCostForm button[type=submit]'); wait(600)
    pa = [c for c in calls('PATCH', '/api/pprojects') if 'cost' in c[2]]
    chk('edit patches the cost', pa and pa[-1][2]['cost'][0] == ids[0] and pa[-1][3]['amount'] == 20, pa[-1:] if pa else None)
    # card flags: Vercel Pro due in 2 days -> but the one-off is overdue and first
    p.click('[data-pp=back]'); wait(400)
    card = p.inner_text('.ppcard[data-id="%s"]' % hub)
    chk('card flags the overdue one-off first', 'Overdue: Logo design · £40' in card and '+2 more' in card, card)
    # delete (confirm dialog)
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait(500)
    p.click('.ppcost [data-pp=cedit][data-id="%s"]' % ids[2]); wait(200)
    p.once('dialog', lambda d: d.accept())
    p.click('[data-pp=cdel]'); wait(600)
    chk('delete removes the cost', 'Logo design' not in p.inner_text('.ppside') and [c for c in calls('DELETE', '/api/pprojects') if 'cost' in c[2]])
    if p.get_attribute('[data-pp=act]', 'aria-expanded') != 'true': p.click('[data-pp=act]'); wait(200)
    wait(800)
    act = p.inner_text('.ppmain')
    chk('cost changes in activity', 'Cost added:' in act and 'Cost changed:' in act and 'Cost removed:' in act, act[-500:])
    p.click('[data-pp=back]'); wait(300)
    card = p.inner_text('.ppcard[data-id="%s"]' % hub)
    chk('card flags the next due cost', 'Due in 2 days: Vercel Pro · £20' in card, card)
    # bad input is caught before saving
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait(400)
    n0 = len(calls('POST', '/api/pprojects'))
    p.click('[data-pp=cadd]'); wait(200); p.fill('#ppCname', 'No amount'); p.click('#ppCostForm button[type=submit]'); wait(300)
    chk('missing amount is not sent', len(calls('POST', '/api/pprojects')) == n0)
    p.click('[data-pp=cx]'); wait(200)
    p.screenshot(path=os.path.join(OUT, 'd3_page.png'))
    p.set_viewport_size({'width': 390, 'height': 844}); wait(400)
    p.click('[data-pp=cadd]'); wait(200)
    chk('iPhone: cost form fits', p.evaluate('document.documentElement.scrollWidth') <= 392)
    p.screenshot(path=os.path.join(OUT, 'd3_iphone.png'), full_page=True)
    p.click('[data-pp=cx]'); wait(200); p.click('[data-pp=back]'); wait(300)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(400)


def d4a_checks(h, chk, wait, calls):
    p = h.page
    def pid(name): return [x for x in h.pprojects if x['name'] == name][0]['id']
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(300)
    p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(700)
    if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(300)
    p.fill('#ppNew', 'Icon Test'); p.press('#ppNew', 'Enter'); wait(500)
    it = pid('Icon Test')
    p.click('.ppcard[data-id="%s"] .ppnm' % it); wait(500)
    # Reason survives an Edit details save (Deploy 2 bug)
    p.click('[data-pp=stat][data-val=paused]'); wait(400)
    p.fill('#ppReason', 'Waiting on a domain'); p.click('[data-pp=rsave]'); wait(500)
    p.click('[data-pp=det]'); wait(500)
    # picker fills account labels when empty
    p.select_option('#ppVsel', 'teamevo/holmlodge-hub'); wait(600)
    chk('picker fills Vercel team and GitHub account', p.input_value('[data-f=acct_vercel]') == 'teamevo' and p.input_value('[data-f=acct_github]') == 'Levo54321',
        (p.input_value('[data-f=acct_vercel]'), p.input_value('[data-f=acct_github]')))
    p.fill('[data-f=acct_supabase]', 'luc@example.com')
    p.click('#ppDetForm button[type=submit]'); wait(700)
    m = calls('PATCH', '/api/pprojects')[-1][3].get('meta', {})
    chk('details save keeps the Reason', m.get('reason') == 'Waiting on a domain', m)
    chk('account labels saved', m.get('acct_vercel') == 'teamevo' and m.get('acct_supabase') == 'luc@example.com' and m.get('acct_github') == 'Levo54321', m)
    side = p.inner_text('.ppside')
    chk('Accounts section on the project page', 'Supabase' in side and 'luc@example.com' in side and 'teamevo' in side, side[-300:])
    chk('Reason still shown', 'Why: Waiting on a domain' in side)
    # icon: upload a PNG (resized to 128px)
    p.click('[data-pp=det]'); wait(500)
    p.set_input_files('#ppIconFile', os.path.join(os.path.dirname(D), 'public', 'favicon-32.png')); wait(1200)
    body = getattr(h, 'last_icon', None)
    import base64, struct
    dims = None
    if body:
        raw = base64.b64decode(body['data']); dims = struct.unpack('>II', raw[16:24]) if raw[:4] == b'\x89PNG' else None
    chk('upload sends a 128px square PNG', body and body['mime'] == 'image/png' and dims == (128, 128), (body and body['mime'], dims))
    src = p.get_attribute('.ppicon .pplogo img', 'src') or ''
    chk('stored icon address used (with version and token)', '/api/pprojects?icon=%s&v=' % it in src and '&t=' in src, src)
    chk('icon upload in activity', any(e['k'] == 'icon' and e['t'] == 'uploaded' for e in h.pevents if e['pid'] == it))
    # remove -> letter
    p.click('[data-pp=icx]'); wait(600)
    chk('remove icon -> first letter only', not p.query_selector('.ppicon .pplogo img') and 'first letter' in p.inner_text('.ppicon + .pphint'))
    # from website (holmlodge-hub sites in the mock)
    p.click('[data-pp=icsite]'); wait(600)
    src = p.get_attribute('.ppicon .pplogo img', 'src') or ''
    chk('icon from website stored', '?icon=%s' % it in src and 'saved copy' in p.inner_text('.ppicon + .pphint'), src)
    p.click('[data-pp=detx]'); wait(300)
    p.click('[data-pp=back]'); wait(400)
    csrc = p.get_attribute('.ppcard[data-id="%s"] .pplogo img' % it, 'src') or ''
    chk('card shows the stored icon', '?icon=%s' % it in csrc, csrc)
    # paused site: from website fails politely
    old = pid('Old App')
    pj = [x for x in h.pprojects if x['id'] == old][0]; pj['meta']['sites'] = ['https://paused.example.com']
    p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(600)
    p.click('.ppcard[data-id="%s"] .ppnm' % old); wait(400); p.click('[data-pp=det]'); wait(400)
    h.allow.append('status of 422')
    p.click('[data-pp=icsite]'); wait(600)
    chk('paused site: clear message, nothing changed', 'paused or down' in p.inner_text('#toast'), p.inner_text('#toast'))
    p.click('[data-pp=detx]'); wait(200); p.click('[data-pp=back]'); wait(300)
    p.set_viewport_size({'width': 390, 'height': 844}); wait(400)
    p.click('.ppcard[data-id="%s"] .ppnm' % it); wait(400); p.click('[data-pp=det]'); wait(400)
    chk('iPhone: details form with icon and accounts fits', p.evaluate('document.documentElement.scrollWidth') <= 392)
    p.screenshot(path=os.path.join(OUT, 'd4a_iphone.png'), full_page=True)
    p.click('[data-pp=detx]'); wait(200); p.click('[data-pp=back]'); wait(300)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(400)


def vault_checks(h, chk, wait, calls):
    p = h.page
    SECRET = 'sk_test_51Hvault-secret'
    h.allow += ['status of 403', 'status of 401']  # deliberate wrong password and expired pass below
    def pid(name): return [x for x in h.pprojects if x['name'] == name][0]['id']
    def main(): return p.inner_text('.ppmain')
    def vtoast(): return p.inner_text('#toast')
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(300)
    p.click('#nPersonal'); wait(200); p.click('#nPprojects'); wait(700)
    if p.query_selector('[data-pp=back]'): p.click('[data-pp=back]'); wait(300)
    hub = pid('Holmlodge Hub')
    h.vault['configured'] = False
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait(600)
    chk('vault: not switched on without VAULT_PEPPER', 'VAULT_PEPPER' in main(), main()[-300:])
    p.click('[data-pp=back]'); wait(300)
    h.vault['configured'] = True
    p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait(600)
    chk('vault: asks for a password first, with the cannot-recover warning', p.query_selector('#ppVsetForm') and 'cannot be recovered' in main())
    n0 = len([c for c in h.calls if 'vault' in c[2]])
    p.fill('#ppVpw', 'short'); p.fill('#ppVpw2', 'short'); p.click('#ppVsetForm button[type=submit]'); wait(300)
    chk('vault: short password refused before sending', 'at least 10' in vtoast() and len([c for c in h.calls if 'vault' in c[2] and c[3].get('action') == 'setup']) == 0)
    p.fill('#ppVpw', 'correct horse battery'); p.fill('#ppVpw2', 'correct horse batteri'); p.click('#ppVsetForm button[type=submit]'); wait(300)
    chk('vault: mismatched passwords refused', 'do not match' in vtoast())
    p.fill('#ppVpw2', 'correct horse battery'); p.click('#ppVsetForm button[type=submit]'); wait(700)
    chk('vault: created and unlocked', 'Unlocked' in main() and p.query_selector('[data-pp=vlock]'), main()[-300:])
    # add a value
    p.click('[data-pp=vadd]'); wait(200)
    p.fill('#ppVname', 'STRIPE_KEY'); p.fill('#ppVvalue', SECRET); p.click('#ppVentForm button[type=submit]'); wait(700)
    html = p.inner_html('#ppPane')
    chk('vault: value saved, listed by name, masked', 'STRIPE_KEY' in main() and SECRET not in html and '••••' in main(), main()[-300:])
    p.evaluate("App.render()"); wait(200)
    chk('vault: background refresh does not reveal or lock', SECRET not in p.inner_html('#ppPane') and 'Unlocked' in main())
    eid = list(h.vault['entries'].keys())[0]
    p.click('[data-pp=vshow][data-id="%s"]' % eid); wait(500)
    chk('vault: Reveal shows the value', p.input_value('#ppVv' + eid) == SECRET)
    p.click('[data-pp=vshow][data-id="%s"]' % eid); wait(300)
    chk('vault: Hide masks it again', SECRET not in p.inner_html('#ppPane'))
    gets = h.vault['gets']
    p.click('[data-pp=vcopy][data-id="%s"]' % eid); wait(500)
    chk('vault: Copy works (or selects the value for iOS 9)', vtoast() in ('Copied', 'Tap Copy on the selected text') and h.vault['gets'] == gets, (vtoast(), h.vault['gets'], gets))
    # edit keeps the value pre-filled
    p.click('[data-pp=vedit][data-id="%s"]' % eid); wait(400)
    chk('vault: Edit pre-fills the value', p.input_value('#ppVvalue') == SECRET)
    p.fill('#ppVvalue', SECRET + '-v2'); p.click('#ppVentForm button[type=submit]'); wait(600)
    chk('vault: edit saved', h.vault['entries'][eid]['value'] == SECRET + '-v2')
    # Lock now
    p.click('[data-pp=vlock]'); wait(400)
    chk('vault: Lock now hides names and values, keeps the count', 'STRIPE_KEY' not in p.inner_html('#ppPane') and SECRET not in p.inner_html('#ppPane') and '1 value saved' in main(), main()[-300:])
    # wrong password, then right
    p.fill('#ppVpw', 'not the password'); p.click('#ppVunForm button[type=submit]'); wait(500)
    chk('vault: wrong password message', 'Wrong password' in vtoast(), vtoast())
    p.fill('#ppVpw', 'correct horse battery'); p.click('#ppVunForm button[type=submit]'); wait(700)
    chk('vault: unlock lists names again', 'STRIPE_KEY' in main())
    # leaving the page locks it
    p.click('[data-pp=back]'); wait(300); p.click('.ppcard[data-id="%s"] .ppnm' % hub); wait(700)
    chk('vault: leaving the project page locks it', p.query_selector('#ppVunForm') and 'STRIPE_KEY' not in p.inner_html('#ppPane'))
    p.fill('#ppVpw', 'correct horse battery'); p.click('#ppVunForm button[type=submit]'); wait(700)
    p.click('#nPersonal'); wait(300); p.click('#nPprojects'); wait(800)
    chk('vault: switching tabs locks it', p.query_selector('#ppVunForm') is not None)
    # idle lock after 5 minutes
    p.fill('#ppVpw', 'correct horse battery'); p.click('#ppVunForm button[type=submit]'); wait(700)
    p.evaluate("App.ppVaultAge(4 * 60000)"); wait(200)
    chk('vault: still open after 4 idle minutes', p.query_selector('[data-pp=vlock]') is not None)
    p.evaluate("App.ppVaultAge(2 * 60000)"); wait(300)
    chk('vault: locks itself after 5 idle minutes', p.query_selector('#ppVunForm') is not None and 'STRIPE_KEY' not in p.inner_html('#ppPane'))
    # server says the pass expired mid-use
    p.fill('#ppVpw', 'correct horse battery'); p.click('#ppVunForm button[type=submit]'); wait(700)
    h.vault['pass'] = 'something-else'
    p.click('[data-pp=vshow][data-id="%s"]' % eid); wait(500)
    chk('vault: expired pass on the server locks the page', p.query_selector('#ppVunForm') is not None and 'locked' in vtoast().lower(), vtoast())
    # nothing sensitive in URLs or the activity log; POST only
    vc = [c for c in h.calls if c[1] == '/api/pprojects' and 'vault' in c[2]]
    chk('vault: POST only, nothing in the address', vc and all(c[0] == 'POST' and c[2] == {'vault': ['1']} for c in vc), set((c[0], str(c[2])) for c in vc))
    chk('vault: nothing in the activity log', not any('STRIPE' in str(e.get('t')) or 'vault' in str(e.get('k')) for e in h.pevents))
    # forgotten password: wipe
    p.click('[data-pp=vforgot]'); wait(300)
    chk('vault: forgot explains values are lost', 'cannot be recovered' in main())
    p.fill('#ppVreset', 'delete'); p.click('[data-pp=vreset]'); wait(300)
    chk('vault: wipe needs DELETE ALL', h.vault['pw'] is not None)
    p.fill('#ppVreset', 'DELETE ALL'); p.click('[data-pp=vreset]'); wait(800)
    chk('vault: wipe deletes everything and asks for a new password', h.vault['pw'] is None and not h.vault['entries'] and p.query_selector('#ppVsetForm') is not None)
    p.set_viewport_size({'width': 390, 'height': 844}); wait(400)
    chk('iPhone: vault fits', p.evaluate('document.documentElement.scrollWidth') <= 392)
    p.screenshot(path=os.path.join(OUT, 'd4b_iphone.png'), full_page=True)
    p.click('[data-pp=back]'); wait(300)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(400)
