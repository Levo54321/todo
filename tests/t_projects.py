"""My projects v3: In progress / Live statuses, folded headers on one line, multiple links, Vercel picker, paused deploys,
collapsible activity (plus core regression flows first)."""
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
    return R
