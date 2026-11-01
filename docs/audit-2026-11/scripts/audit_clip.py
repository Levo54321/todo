import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_lib as L
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    out = {}
    for w, hh in ((1024, 768), (768, 1024), (390, 844)):
        h = L.rich(1); ctx = b.new_context(viewport={'width': w, 'height': hh}); ctx.add_init_script(L.INIT + "localStorage.setItem('saverTimeout','0');")
        L.make_route(h, ctx); pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(2000)
        for v in ('personal', 'work'):
            pg.click('[data-act=nav][data-view=%s]' % v); pg.wait_for_timeout(800)
            out['%d %s' % (w, v)] = pg.evaluate("""(function(){var r=[],a=document.querySelectorAll('#vTasks *');for(var i=0;i<a.length;i++){var b=a[i].getBoundingClientRect();if(b.width>0&&b.right>innerWidth+1&&a[i].children.length===0)r.push((a[i].id||a[i].getAttribute('data-act')||a[i].className)+' right='+Math.round(b.right));}
              var fs=document.querySelector('.fsbtn'),fb=fs&&fs.getBoundingClientRect(); return {offscreen:r.slice(0,8), fsbtn: fb?[Math.round(fb.left),Math.round(fb.top),Math.round(fb.width)]:null};})()""")
        ctx.close()
    print(json.dumps(out, indent=1)); b.close()
