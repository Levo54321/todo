import os, sys, json, gzip, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_lib as L
from playwright.sync_api import sync_playwright

VIEWS = [('personal', 'Personal'), ('work', 'Work'), ('plan', 'Tomorrow'), ('board', 'Work board'), ('pprojects', 'My projects'),
         ('pppage', 'My projects page'), ('budget', 'Budget'), ('insights', 'Insights')]
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    for scale in (1, 2):
        h = L.rich(scale)
        body = json.dumps({'today': '2026-11-01', 'now': L.NOW, 'todos': h.todos}, separators=(',', ':'))
        # mock rows carry every column with nulls, like to_jsonb(t); real rows have 37 keys, mock 37
        res = {'payload_bytes': len(body), 'payload_gzip': len(gzip.compress(body.encode(), 6)), 'rows': len(h.todos), 'per_row': len(body) // len(h.todos)}
        loads = []
        for run in range(3):
            ctx = b.new_context(viewport={'width': 1024, 'height': 768})
            ctx.add_init_script(L.INIT)
            L.make_route(h, ctx)
            pg = ctx.new_page()
            cdp = ctx.new_cdp_session(pg); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6}); cdp.send('Performance.enable')
            t0 = time.time()
            pg.goto('http://todo.test/')
            pg.wait_for_function("document.getElementById('stats') && /open/.test(document.getElementById('stats').textContent)", timeout=60000)
            first = (time.time() - t0) * 1000
            nav = pg.evaluate("(function(){var n=performance.getEntriesByType('navigation')[0];return {dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd};})()")
            m = {x['name']: x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
            loads.append({'tasks_visible_ms': round(first), 'dcl_ms': round(nav['dcl']), 'script_s': round(m['ScriptDuration'], 3), 'layout_s': round(m['LayoutDuration'], 3), 'nodes': int(m['Nodes'])})
            if run < 2: ctx.close(); continue
            pg.wait_for_timeout(2500)
            pg.add_script_tag(content=L.SPY)
            ticks = {}
            for v, label in VIEWS:
                if v == 'pppage':
                    pg.click('#nPprojects'); pg.wait_for_timeout(1500); pg.click('.ppcard .ppnm'); pg.wait_for_timeout(1500)
                else:
                    pg.click('[data-act=nav][data-view=%s]' % v); pg.wait_for_timeout(1500)
                # cost of one App.render() when nothing changed (string building + compare)
                rt = pg.evaluate("(function(){var a=[];for(var i=0;i<5;i++){var t=performance.now();App.render();a.push(performance.now()-t);}a.sort(function(x,y){return x-y});return a[2];})()")
                # full background tick: reload from the (unchanged) mock and render
                pg.evaluate("window.__w.html=0;window.__w.htmlBytes=0;window.__w.value=0;window.__w.scroll=0;window.__w.byId={};")
                n0 = len(h.calls)
                pg.evaluate("App.reload()"); pg.wait_for_timeout(2500)
                w = pg.evaluate("window.__w")
                calls = [c[1] + (('?' + '&'.join(c[2].keys())) if c[2] else '') for c in h.calls[n0:]]
                ticks[label] = {'render_ms_6x': round(rt, 1), 'innerHTML_sets': w['html'], 'bytes': w['htmlBytes'], 'value_sets': w['value'], 'scroll_sets': w['scroll'], 'where': w['byId'], 'calls': calls}
            # forced rebuild of the task columns (what a real change costs)
            pg.click('[data-act=nav][data-view=personal]'); pg.wait_for_timeout(800)
            full = pg.evaluate("(function(){var a=[];for(var i=0;i<5;i++){['colA','colB','colC','focus','filters','stats'].forEach(function(id){var e=document.getElementById(id);if(e)e._h=null;});var t=performance.now();App.render();document.body.offsetHeight;a.push(performance.now()-t);}a.sort(function(x,y){return x-y});return a[2];})()")
            parse = pg.evaluate("(function(){var s=JSON.stringify({todos:App.todos()});var a=[];for(var i=0;i<5;i++){var t=performance.now();JSON.parse(s);a.push(performance.now()-t);}a.sort(function(x,y){return x-y});return [s.length,a[2]];})()")
            res['ticks'] = ticks; res['full_rebuild_ms_6x'] = round(full, 1); res['json_parse_ms_6x'] = round(parse[1], 1)
            res['errors'] = h.errors[:5]
            ctx.close()
        res['loads'] = loads
        out['scale%d' % scale] = res
    b.close()
print(json.dumps(out, indent=1))
