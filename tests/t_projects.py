"""My projects v3: In progress / Live statuses, folded headers on one line, multiple links, Vercel picker, paused deploys,
collapsible activity (plus core regression flows first).
v1044 (Deploy 1): fixed-height layout (lanes scroll on their own, frozen side panel, back bar always visible) at iPad
landscape, iPad portrait and iPhone sizes, and the Vercel picker replacing only the websites/GitHub it filled in."""
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
    chk('5 status columns', heads == ['In progress', 'Live', 'Paused', 'Not pursued', 'Shut down'], heads)
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
    return R

def layout_checks(h, chk, wait):
    p = h.page
    import uuid as _u
    for i in range(9):  # enough projects to overflow the lanes
        h.pprojects.append({'id': str(_u.uuid4()), 'name': 'Filler %d' % i, 'status': 'in_progress' if i < 6 else 'live', 'created_at': '2026-10-01T09:00:00Z',
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
        p.evaluate("document.querySelector('.pplane[data-lane=in_progress]').scrollTop = 300"); wait(200)
        r = p.evaluate("""() => ({lane: document.querySelector('.pplane[data-lane=in_progress]').scrollTop, live: document.querySelector('.pplane[data-lane=live]').scrollTop,
            sv: document.querySelector('#vPprojects .scrollview').scrollTop, top: document.getElementById('ppNew').getBoundingClientRect().top})""")
        chk(tag + ': scrolling one lane moves nothing else', r['lane'] > 0 and r['live'] == 0 and r['sv'] == 0 and abs(r['top'] - top0) < 1, r)
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
