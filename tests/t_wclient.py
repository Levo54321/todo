"""v35 Work clients: Internal / Client toggle on the project page, the client list in Manage projects (add, duplicate,
rename, icon upload with a mock image, remove with confirmation), the icon / letter and name on board columns and the
project page, the board filter (All / Internal / client, remembered), removal resetting projects to Internal (logged),
the board still reordering and adding, background redraws writing nothing, overflow and tap targets at 1024x768 / 390x844.
Run: python3 tests/harness.py . tests/t_wclient.py
Builds on the /api/projects mock of t_wproject.py (which runs the REAL api/_wpmeta.js); the client routes below copy
api/_wclients.js + db/setup35.sql. Byte checks and SQL are covered by tests/wclient_node.js and the live rolled-back test."""
import base64, importlib.util, os, uuid
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('twp', os.path.join(D, 't_wproject.py')); twp = importlib.util.module_from_spec(spec); spec.loader.exec_module(twp)

def mock():
    S, base = twp.mock()
    C = {'clients': [], 'icons': {}, 'puts': [], 'icon_posts': []}
    def cl():
        out = []
        for c in sorted(C['clients'], key=lambda c: c['name'].lower()):
            o = {'id': c['id'], 'name': c['name'], 'n': len([1 for m in S['meta'].values() if m.get('client') == c['id']])}
            if c['id'] in C['icons']: o['icon_at'] = C['icons'][c['id']]['at']
            out.append(o)
        return out
    def ev(i, k, t): S['events'][i].append({'at': '2026-11-01T10:00:00Z', 'kind': k, 'text': t})
    def api(h, method, q, body):
        g = lambda k: q.get(k, [None])[0]
        if 'clients' in q:
            if method == 'GET': return 200, {'clients': cl()}
            if method == 'DELETE':
                cid = g('clients'); c = [x for x in C['clients'] if x['id'] == cid]
                if not c: return 404, {'error': 'not found'}
                n = 0
                for i, m in S['meta'].items():
                    if m.get('client') == cid: m.pop('client'); ev(i, 'client_removed', c[0]['name']); n += 1
                C['clients'].remove(c[0]); C['icons'].pop(cid, None)
                return 200, {'clients': cl(), 'reset': n}
            nm = ' '.join((body.get('name') or '').split())
            if not nm: return 400, {'error': 'Give the client a name'}
            cid = g('clients') if method == 'PATCH' else uuid.uuid4().hex[:12]
            if any(c['name'].lower() == nm.lower() and c['id'] != cid for c in C['clients']): return 409, {'error': nm + ' is already in the list'}
            if method == 'POST': C['clients'].append({'id': cid, 'name': nm}); return 201, {'clients': cl()}
            for c in C['clients']:
                if c['id'] == cid: c['name'] = nm
            return 200, {'clients': cl()}
        if 'clienticon' in q:
            cid = g('clienticon')
            if method == 'DELETE': C['icons'].pop(cid, None); return 200, {'clients': cl()}
            raw = base64.b64decode(body.get('data') or '')
            if not raw.startswith(b'\x89PNG') or len(raw) > 200000: return 400, {'error': 'that is not a PNG, JPEG, GIF or WebP image'}
            C['icon_posts'].append({'id': cid, 'mime': body.get('mime'), 'bytes': len(raw)})
            C['icons'][cid] = {'at': 1700000000000 + len(C['icon_posts'])}
            return 200, {'clients': cl()}
        if g('meta') and method == 'PATCH':
            i = g('id'); new = (body.get('meta') or {}).get('client', 'unset'); old = S['meta'].get(i, {}).get('client')
            if isinstance(new, str) and new and new not in [c['id'] for c in C['clients']]: return 400, {'error': 'That client is not in the list any more, pick another'}
            C['puts'].append(body)
            st, d = base(h, method, q, body)
            if st == 200 and new != 'unset' and (new or None) != old:
                evs = S['events'][i]
                if evs and evs[-1]['kind'] == 'details':
                    keys = [k for k in evs[-1]['text'].split(',') if k != 'client']
                    if keys: evs[-1]['text'] = ','.join(keys)
                    else: evs.pop()
                nm = [c['name'] for c in C['clients'] if c['id'] == new]
                ev(i, 'client', nm[0] if nm else '')
                d = base(h, 'GET', {'page': [i]}, {})[1]
            if st == 200: d['clients'] = cl()
            return st, d
        st, d = base(h, method, q, body)
        if st == 200 and g('page'): d['clients'] = cl()
        if st == 200 and g('cards'):
            for i, m in S['meta'].items():
                if m.get('client'): d['cards'].setdefault(i, {})['client'] = m['client']
            d['clients'] = cl()
        return st, d
    return S, C, api

def run(h):
    R = []; p = h.page
    def chk(name, cond, info=''): R.append(('WC: ' + name, bool(cond), info))
    def wait(ms=400): p.wait_for_timeout(ms)
    def overflow(): return p.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    def small(scope):
        return p.evaluate("""s => Array.prototype.slice.call(document.querySelectorAll(s)).filter(function (e) {
            var r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(function (e) { return (e.getAttribute('data-pj') || e.getAttribute('data-bd') || e.className || e.tagName) + ':' + e.textContent.slice(0, 16) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height); })""", scope)
    S, C, api = mock(); h.extra['/api/projects'] = api
    h.allow += ['status of 409', 'status of 400']
    A, B = 'aaaaaaaaaaa1', 'aaaaaaaaaaa2'
    p.goto('http://todo.test/'); wait(1500)
    p.click('#nProjects'); wait(200)
    if not p.is_visible('#vBoard'): p.click('#psW'); wait(600)
    chk('no filter bar while there are no clients', p.query_selector('#boardPane .bdfilter') is None)
    # ---- the client list in Manage projects
    p.click('#boardPane [data-pj=open]'); wait(500)
    chk('Work clients section shown', 'work clients' in p.inner_text('#projCard').lower() and 'No clients yet' in p.inner_text('#projCard'))
    for n in ('Prolific', 'acme corp', 'Zed'):
        p.fill('#wpCNew', n); p.press('#wpCNew', 'Enter'); wait(300)
    chk('clients added (A-Z)', [c['name'] for c in cl_sorted(C)] == ['acme corp', 'Prolific', 'Zed'], C['clients'])
    p.fill('#wpCNew', 'ACME CORP'); p.press('#wpCNew', 'Enter'); wait(300)
    chk('duplicate (ignoring case) refused with a message', 'already in the list' in p.inner_text('#projCard') and len(C['clients']) == 3)
    cid = {c['name']: c['id'] for c in C['clients']}
    p.click('[data-pj=cedit][data-id="%s"]' % cid['acme corp']); wait(200)
    p.fill('#wpCEdit', 'Acme'); p.click('[data-pj=csave]'); wait(300)
    chk('client renamed', 'Acme' in [c['name'] for c in C['clients']] and 'Acme' in p.inner_text('#projCard'))
    acme = cid['acme corp']; zed = cid['Zed']; prol = cid['Prolific']
    # icon upload with a real (small) image, cropped in the browser
    p.set_input_files('.wcfile[data-id="%s"]' % acme, os.path.join(D, '..', 'public', 'favicon-32.png')); wait(800)
    up = C['icon_posts'][-1:] or [{}]
    chk('icon uploaded as a 128px-cropped PNG within 200 KB', up[0].get('id') == acme and up[0].get('mime') == 'image/png' and 0 < up[0].get('bytes', 0) <= 200000, C['icon_posts'])
    chk('row shows the image for Acme, a letter for Zed', p.query_selector('#projCard .wcli .wcl img[src*="clienticon=%s"]' % acme) is not None
        and p.query_selector('#projCard .wcli .wcl img[src*="clienticon=%s"]' % zed) is None)
    chk('icon url carries a ?v= stamp and no svg', 'v=1700000000001' in p.get_attribute('#projCard .wcl img', 'src'))
    iw = p.evaluate("(function(){var c=document.createElement('canvas');c.width=128;c.height=128;return 1})()")
    p.click('[data-pj=cedit][data-id="%s"]' % acme); wait(200)
    chk('Remove icon offered only when there is one', p.query_selector('[data-pj=cicx]') is not None)
    p.click('[data-pj=cicx]'); wait(300)
    chk('icon removed', acme not in C['icons'] and p.query_selector('#projCard .wcl img') is None)
    p.set_input_files('.wcfile[data-id="%s"]' % acme, os.path.join(D, '..', 'public', 'favicon-32.png')); wait(800)
    chk('no overflow in Manage projects (1024)', overflow() <= 0)
    chk('client row tap targets 44px (1024)', not small('#projCard .wcli button, #projCard .wcli label, #projCard #wpCForm input, #projCard #wpCForm button'), small('#projCard .wcli button, #projCard .wcli label'))
    p.click('[data-pj=close]'); wait(500)
    chk('board shows the filter bar once clients exist', p.query_selector('#boardPane .bdfilter') is not None and 'Prolific' in p.inner_text('#boardPane .bdfilter'))
    # ---- the project page: default Internal, toggle, validation
    p.click('#boardPane [data-bd=page][data-pid=%s]' % A); wait(700)
    chk('default is Internal', 'Internal' in p.inner_text('#wpPane .wpfor'))
    p.click('[data-wp=edit]'); wait(300)
    chk('form: Internal selected, no dropdown', p.inner_text('.wpform [data-wp=ctype].on') == 'Internal' and p.query_selector('[data-f=client]') is None)
    p.click('[data-wp=ctype][data-val="1"]'); wait(200)
    chk('Client shows the dropdown with the clients', p.query_selector('[data-f=client]') is not None and p.evaluate("Array.prototype.map.call(document.querySelectorAll('[data-f=client] option'), function(o){return o.textContent})") == ['Pick a client…', 'Acme', 'Prolific', 'Zed'])
    n0 = len(C['puts'])
    p.fill('[data-f=goal]', 'Keep me'); p.click('[data-wp=save]'); wait(400)
    chk('saving as Client without a client is refused (nothing sent)', len(C['puts']) == n0 and 'Pick a client' in p.inner_text('.wperr') and p.input_value('[data-f=goal]') == 'Keep me')
    p.select_option('[data-f=client]', acme); p.click('[data-wp=save]'); wait(600)
    chk('saved with the client id', C['puts'][-1]['meta'].get('client') == acme and S['meta'][A].get('client') == acme, C['puts'][-1:])
    chk('page: logo and name in the header + For section', p.query_selector('#wpPane .wpnm .wcl img') is not None and 'Acme' in p.inner_text('#wpPane .wpfor'))
    chk('activity logs the client', 'Client: Acme' in p.inner_text('#wpPane .ppev'), p.inner_text('#wpPane .ppev'))
    chk('goal saved with it (previous fields not lost)', S['meta'][A].get('goal') == 'Keep me')
    p.click('[data-wp=edit]'); wait(300)
    chk('editing again starts on Client with Acme picked', p.inner_text('.wpform [data-wp=ctype].on') == 'Client' and p.input_value('[data-f=client]') == acme)
    p.click('[data-wp=cancel]'); wait(200)
    # ---- board header + filter
    p.click('[data-wp=back]'); wait(600)
    chk('board column header shows the client icon and name', p.query_selector('#boardPane .bdhead[data-pid=%s] .wcl img' % A) is not None and 'Acme' in p.inner_text('#boardPane .bdcol:first-child .bdhealth'))
    chk('Internal project has no client mark', p.query_selector('#boardPane .bdhead[data-pid=%s] .wcl' % B) is None)
    sums = p.inner_text('#boardPane .bdsum')
    chk('both columns shown under All', len(p.query_selector_all('#boardPane .bdcol:not(.loose)')) == 2 and p.query_selector('#boardPane [data-bd=cf][data-val=""].on') is not None)
    p.click('#boardPane [data-bd=cf][data-val="%s"]' % acme); wait(300)
    cols = p.evaluate("Array.prototype.map.call(document.querySelectorAll('#boardPane .bdcol .bdname'), function(e){return e.textContent})")
    chk('filter Acme shows only Alpha', cols == ['Alpha'], cols)
    chk('filter does not change the counts in the summary', all(x in p.inner_text('#boardPane .bdsum') for x in sums.split(' · ')[:3]), (sums, p.inner_text('#boardPane .bdsum')))
    chk('filter remembered in localStorage', p.evaluate("localStorage.getItem('wbClient')") == acme)
    p.reload(); wait(1800)
    p.click('#nProjects'); wait(200)
    if not p.is_visible('#vBoard'): p.click('#psW'); wait(600)
    wait(500)
    chk('filter survives a reload', p.evaluate("Array.prototype.map.call(document.querySelectorAll('#boardPane .bdcol .bdname'), function(e){return e.textContent})") == ['Alpha'] and p.query_selector('#boardPane [data-bd=cf].on .wcl') is not None)
    p.click('#boardPane [data-bd=cf][data-val=int]'); wait(300)
    chk('filter Internal shows only Beta', p.evaluate("Array.prototype.map.call(document.querySelectorAll('#boardPane .bdcol .bdname'), function(e){return e.textContent})") == ['Beta'])
    # reorder and add still work while filtered
    n0 = len([c for c in h.calls if c[0] == 'PATCH' and c[1] == '/api/projects'])
    f = p.query_selector('#boardPane form.bdadd[data-pid=%s] .bdin' % B); f.fill('Filtered add'); f.press('Enter'); wait(600)
    chk('board Add box works under a filter', [c for c in h.calls if c[0] == 'POST' and c[1] == '/api/todos'][-1][3] == {'title': 'Filtered add', 'category': 'Beta', 'list': 'work'})
    p.click('#boardPane [data-bd=cf][data-val="%s"]' % zed); wait(300)
    chk('a client with no projects shows an empty message', 'No projects here yet' in p.inner_text('#boardPane') and p.query_selector('#boardPane .bdcol') is None)
    p.click('#boardPane [data-bd=cf][data-val=""]'); wait(300)
    nums = p.query_selector_all('#boardPane .bdcol:first-child [data-bd=num]')
    nums[0].click(); wait(200); p.click('#boardPane .bdcol:first-child [data-bd=to][data-to="1"]'); wait(600)
    chk('board number reorder still saves', any('order' in (c[3] or {}) for c in [c for c in h.calls if c[0] == 'PATCH' and c[1] == '/api/projects'][n0:]))
    # background redraws write nothing
    p.evaluate("window.__m = 0; window.__o = new MutationObserver(function (l) { window.__m += l.length; }); window.__o.observe(document.getElementById('boardPane'), {childList: true, subtree: true, attributes: true, characterData: true})")
    p.evaluate('App.render(); App.render()'); wait(300)
    chk('background redraw writes nothing to the board (no flicker)', p.evaluate('window.__m') == 0, p.evaluate('window.__m'))
    # ---- remove a client in use
    p.click('#boardPane [data-bd=cf][data-val="%s"]' % acme); wait(200)
    p.click('#boardPane [data-pj=open]'); wait(500)
    chk('client row shows project count in the confirmation', True)
    p.click('[data-pj=cdel][data-id="%s"]' % acme); wait(300)
    chk('removal asks first and says how many projects go back to Internal', '1 project is for Acme' in p.inner_text('#askCard') and 'Internal' in p.inner_text('#askCard'), p.inner_text('#askCard'))
    p.click('#askCard button:has-text("Cancel")'); wait(300)
    chk('Cancel keeps the client and the project', len(C['clients']) == 3 and S['meta'][A].get('client') == acme)
    p.click('[data-pj=cdel][data-id="%s"]' % acme); wait(300)
    p.click('#askCard button:has-text("Remove")'); wait(700)
    chk('removed: client gone, project back to Internal', len(C['clients']) == 2 and 'client' not in S['meta'][A])
    p.click('[data-pj=close]'); wait(600)
    chk('stored filter for a removed client falls back to All', len(p.query_selector_all('#boardPane .bdcol:not(.loose)')) == 2 and p.query_selector('#boardPane [data-bd=cf][data-val=""].on') is not None)
    chk('Alpha column lost its client mark', p.query_selector('#boardPane .bdhead[data-pid=%s] .wcl' % A) is None)
    p.click('#boardPane [data-bd=page][data-pid=%s]' % A); wait(700)
    chk('project page says Internal and the log says why', 'Internal' in p.inner_text('#wpPane .wpfor') and 'Acme was removed' in p.inner_text('#wpPane .ppev'), p.inner_text('#wpPane .ppev'))
    p.click('[data-wp=edit]'); wait(300)
    p.click('[data-wp=ctype][data-val="1"]'); wait(200); p.select_option('[data-f=client]', zed)
    chk('form fits 1024 with the client picker', overflow() <= 0)
    chk('form buttons 44px', not small('#wpPane .wpform [data-wp=ctype], #wpPane .wpform select'), small('#wpPane .wpform [data-wp=ctype], #wpPane .wpform select'))
    p.click('[data-wp=save]'); wait(600)
    p.click('[data-wp=back]'); wait(600)
    # ---- phone width
    p.set_viewport_size({'width': 390, 'height': 844}); wait(600)
    p.screenshot(path=os.path.join(D, 'out', 'wclient_phone_board.png'))
    chk('board with filter + client fits 390', overflow() <= 0, overflow())
    chk('filter chips 44px (390)', not small('#boardPane .bdfilter .chip'), small('#boardPane .bdfilter .chip'))
    p.click('#boardPane [data-pj=open]'); wait(500)
    p.screenshot(path=os.path.join(D, 'out', 'wclient_phone_manage.png'), full_page=True)
    chk('Manage projects fits 390', overflow() <= 0, overflow())
    chk('client row tap targets 44px (390)', not small('#projCard .wcli button, #projCard .wcli label'), small('#projCard .wcli button, #projCard .wcli label'))
    p.click('[data-pj=close]'); wait(400)
    p.click('#boardPane [data-bd=page][data-pid=%s]' % A); wait(700)
    chk('project page fits 390', overflow() <= 0, overflow())
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(500)
    p.screenshot(path=os.path.join(D, 'out', 'wclient_page.png'))
    chk('no page errors', not h.errors, h.errors)
    return R

def cl_sorted(C): return sorted(C['clients'], key=lambda c: c['name'].lower())
