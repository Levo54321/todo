"""Screenshots at the four sizes plus layout checks: horizontal overflow, small tap targets, small text."""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_lib as L
from playwright.sync_api import sync_playwright
OUT = os.path.join(L.REPO, 'docs', 'audit-2026-11', 'png')
os.makedirs(OUT, exist_ok=True)
SIZES = [('ipad-land', 1024, 768), ('ipad-port', 768, 1024), ('iphone', 390, 844), ('desktop', 1440, 900)]
CHECK = r"""
(function(){
  function vis(e){var r=e.getBoundingClientRect();if(r.width<1||r.height<1)return null;var s=getComputedStyle(e);if(s.visibility==='hidden'||s.display==='none')return null;
    for(var p=e;p&&p!==document.body;p=p.parentElement){var ps=getComputedStyle(p);if(ps.display==='none'||ps.visibility==='hidden'||+ps.opacity===0)return null;}
    if(r.bottom<0||r.top>innerHeight*3)return null;return r;}
  var tap=[], small=[], seen={};
  var els=document.querySelectorAll('button,a,[data-act],[data-pp],[data-bd],input,select,label.tg');
  for(var i=0;i<els.length;i++){var e=els[i],r=vis(e);if(!r)continue;var m=Math.min(r.width,r.height);if(m<44){var k=(e.getAttribute('data-act')||e.getAttribute('data-pp')||e.getAttribute('data-bd')||e.tagName.toLowerCase()+'.'+(e.className||'').split(' ')[0]);if(!seen[k]){seen[k]=1;tap.push(k+' '+Math.round(r.width)+'x'+Math.round(r.height));}}}
  var all=document.querySelectorAll('body *'),sm={};
  for(i=0;i<all.length;i++){var t=all[i];if(!t.childNodes.length||t.children.length&&!/\S/.test(t.textContent))continue;var hasText=false;for(var j=0;j<t.childNodes.length;j++)if(t.childNodes[j].nodeType===3&&/\S/.test(t.childNodes[j].nodeValue))hasText=true;
    if(!hasText||!vis(t))continue;var fs=parseFloat(getComputedStyle(t).fontSize);if(fs<12){var c=t.tagName.toLowerCase()+'.'+(t.className||'').split(' ')[0];sm[c+' '+fs+'px']=1;}}
  for(var k2 in sm)small.push(k2);
  return {overflowX: document.documentElement.scrollWidth - innerWidth, smallTaps: tap.length, tapList: tap.slice(0,25), smallText: small};
})()
"""
def shoot(pg, name, full=False):
    pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)

res = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    for night in (False, True):
        for tag, w, hgt in SIZES:
            if night and tag not in ('ipad-land', 'iphone'): continue
            h = L.rich(1)
            ctx = b.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=1 if w > 500 else 2)
            ctx.add_init_script(L.INIT + "localStorage.setItem('saverTimeout','0');" + ("localStorage.setItem('themeMode','night');" if night else "localStorage.setItem('themeMode','day');"))
            L.make_route(h, ctx)
            pg = ctx.new_page(); pg.goto('http://todo.test/'); pg.wait_for_timeout(2500)
            sfx = ('-night' if night else '')
            views = [('personal', '[data-act=nav][data-view=personal]'), ('work', '[data-act=nav][data-view=work]'), ('board', '[data-act=nav][data-view=board]'),
                     ('myprojects', '[data-act=nav][data-view=pprojects]')] if not night else [('personal', '[data-act=nav][data-view=personal]'), ('myprojects', '[data-act=nav][data-view=pprojects]')]
            for v, sel in views:
                pg.click(sel); pg.wait_for_timeout(1500)
                shoot(pg, '%s-%s%s' % (tag, v, sfx))
                res['%s %s%s' % (tag, v, sfx)] = pg.evaluate(CHECK)
            if not night:
                # project page of a Not pursued project that is still live (warning)
                warn = [x for x in h.pprojects if x['status'] == 'not_pursued' and x['meta'].get('vercel')][0]
                pg.click('[data-pp=fold][data-val=not_pursued]'); pg.wait_for_timeout(800)
                shoot(pg, '%s-myprojects-unfolded' % tag)
                pg.click('.ppcard[data-id="%s"] .ppnm' % warn['id']); pg.wait_for_timeout(1500)
                shoot(pg, '%s-project-page' % tag); res['%s project-page' % tag] = pg.evaluate(CHECK)
                pg.click('[data-act=nav][data-view=personal]'); pg.wait_for_timeout(800)
                pg.click('#colA .item .body'); pg.wait_for_timeout(1000)
                shoot(pg, '%s-editor' % tag); res['%s editor' % tag] = pg.evaluate(CHECK)
            res['%s errors%s' % (tag, sfx)] = h.errors[:3]
            ctx.close()
    b.close()
print(json.dumps(res, indent=1))
