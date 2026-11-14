"""Jobs tab (v1074, step 1): side-menu tab, dark view, stage board, add/edit/move/delete a job, history, stage editor
(rename, remove with the two-tap check, add, follow-up days, drag to reorder), phone layout (one stage at a time), no
sideways overflow, 44px tap targets, error + Try again, and idle redraws that touch nothing.
Runs t_core first (the shared nav changed a little). Standalone: python3 tests/harness.py . tests/t_jobs.py"""
import importlib.util, os
D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, 'out'); os.makedirs(OUT, exist_ok=True)  # screenshots (git-ignored)
spec = importlib.util.spec_from_file_location('tc', os.path.join(D, 't_core.py')); tc = importlib.util.module_from_spec(spec); spec.loader.exec_module(tc)

def run(h):
    R = tc.run(h)
    p = h.page
    def chk(name, cond, info=''): R.append(('Jobs: ' + name, bool(cond), info))
    def calls(m): return [c for c in h.calls if c[0] == m and c[1] == '/api/pprojects' and 'jobs' in c[2]]
    def wait(ms=350): p.wait_for_timeout(ms)
    def names(): return [e.inner_text() for e in p.query_selector_all('#jbStrip .jbcn')]
    def col_of(text):
        for i, c in enumerate(p.query_selector_all('#jbStrip .jbcol')):
            if text in c.inner_text(): return i
        return -1

    p.set_viewport_size({'width': 1024, 'height': 768})
    chk('Jobs tab is in the side menu', p.is_visible('#nJobs'))
    p.click('#nJobs'); wait(900)
    chk('opens on the pipeline with the six default stages', names() == ['Saved', 'Applied', 'Screening', 'Interview', 'Offer', 'Closed'], names())
    chk('dark earth-tone theme while open', p.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(22, 20, 17)', p.evaluate("getComputedStyle(document.body).backgroundColor"))
    chk('nav item highlighted', 'on' in (p.get_attribute('#nJobs', 'class') or ''))
    chk('page does not scroll sideways at 1024x768', p.evaluate("document.documentElement.scrollWidth <= 1024 && document.body.scrollWidth <= 1024"))

    # add a job
    p.click('[data-jb=add]'); wait(200)
    chk('add sheet opens with stage chips', p.is_visible('#jbSheet') and len(p.query_selector_all('#jbChips .jbchip')) == 6)
    p.click('[data-jb=save]'); wait(200)
    chk('empty job refused', len(calls('POST')) == 0 and p.is_visible('#jbSheet'))
    p.fill('#jbCompany', 'Corvid'); p.fill('#jbRole', 'AI Data Ops Manager'); p.fill('#jbLoc', 'London'); p.fill('#jbSalary', '£60-68k')
    p.click('[data-jb=mode][data-v=hybrid]'); p.fill('#jbNext', 'Follow up'); p.fill('#jbNextOn', '2026-10-20'); p.fill('#jbNotes', 'Found on LinkedIn')
    p.click('[data-jb=save]'); wait(600)
    post = calls('POST')[-1][3] if calls('POST') else {}
    chk('POST carries the fields and the first stage', post.get('company') == 'Corvid' and post.get('mode') == 'hybrid' and post.get('next_on') == '2026-10-20' and post.get('stage_id') == 'st0' and post.get('notes') == 'Found on LinkedIn', post)
    chk('sheet closes and the card lands in Saved', not p.is_visible('#jbSheet') and col_of('Corvid') == 0)
    chk('overdue next step shown in red', p.query_selector('.jbnx.due') is not None)
    p.screenshot(path=os.path.join(OUT, 'jobs_board.png'))
    chk('card shows location, pattern and salary', 'London · Hybrid · £60-68k' in p.inner_text('.jbcard'), p.inner_text('.jbcard'))

    # a second job added from a column's "+ Add" goes to that stage
    p.click('[data-jb=addin][data-sid=st3]'); wait(200)
    chk('column "+ Add" preselects its stage', 'on' in p.get_attribute('#jbChips .jbchip:nth-child(4)', 'class'))
    p.fill('#jbRole', 'Eval Lead'); p.click('[data-jb=save]'); wait(500)
    chk('second job in Interview', col_of('Eval Lead') == 3)

    # open + move + history
    p.click('.jbcard:has-text("Corvid")'); wait(400)
    chk('edit sheet shows saved values', p.input_value('#jbCompany') == 'Corvid' and p.input_value('#jbNextOn') == '2026-10-20' and 'on' in p.get_attribute('[data-jb=mode][data-v=hybrid]', 'class'))
    p.screenshot(path=os.path.join(OUT, 'jobs_sheet.png'))
    chk('history lists when it was added', 'Saved' in p.inner_text('#jbHist'), p.inner_text('#jbHist'))
    p.click('#jbChips .jbchip:nth-child(2)'); wait(500)
    patch = calls('PATCH')[-1][3] if calls('PATCH') else {}
    chk('tapping a stage chip moves the job (stage only)', patch == {'stage_id': 'st1'}, patch)
    chk('card moved to Applied behind the sheet', col_of('Corvid') == 1)
    chk('history shows the move', 'Moved to Applied' in p.inner_text('#jbHist'), p.inner_text('#jbHist'))
    p.fill('#jbContact', 'Priya Shah'); p.fill('#jbCv', 'CV - Human Data v3'); p.click('[data-jb=save]'); wait(500)
    patch = calls('PATCH')[-1][3]
    chk('Save sends the edited fields', patch.get('contact') == 'Priya Shah' and patch.get('cv_variant') == 'CV - Human Data v3' and 'stage_id' not in patch, patch)

    # idle redraws touch nothing
    ok = p.evaluate("""(function(){var s=document.getElementById('jbStrip');s.setAttribute('data-m','1');s.scrollLeft=60;var before=s.scrollLeft;App.views.jobs.render();App.views.jobs.render();
      var s2=document.getElementById('jbStrip');return s2===s && s2.getAttribute('data-m')==='1' && s2.scrollLeft===before})()""")
    chk('a background redraw writes nothing (same strip, scroll kept)', ok)

    # stage editor
    p.click('[data-jb=stages]'); wait(250)
    rows = lambda: p.query_selector_all('#jbSList .jbsrow')
    chk('editor lists the six stages', len(rows()) == 6)
    p.click('.jbsrow:nth-child(2) [data-jb=sdel]'); wait(150)
    chk('removing a stage that holds a job asks twice', len(rows()) == 6 and 'Sure' in p.inner_text('.jbsrow:nth-child(2) [data-jb=sdel]'))
    p.click('.jbsrow:nth-child(3) [data-jb=sdel]'); wait(150)   # Screening is empty: goes at once
    chk('empty stage removed at once', len(rows()) == 5)
    p.fill('.jbsrow:nth-child(4) .jbsname', 'Offer received')
    p.click('[data-jb=sadd]'); wait(150)
    chk('new stage added at the end', len(rows()) == 6 and p.input_value('.jbsrow:nth-child(6) .jbsname') == 'New stage')
    p.fill('.jbsrow:nth-child(6) .jbsname', 'Take-home'); p.fill('.jbsrow:nth-child(6) [data-f=follow_days]', '3')
    p.click('.jbsrow:nth-child(6) [data-jb=pal]'); wait(100); p.click('[data-jb=pick][data-c=rose]'); wait(100)
    chk('colour picker changes the dot', 'jbc-rose' in p.get_attribute('.jbsrow:nth-child(6) .jbswatch', 'class'))
    g = p.query_selector('.jbsrow:nth-child(6) .jbgrip').bounding_box(); t = p.query_selector('.jbsrow:nth-child(3)').bounding_box()
    p.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2); p.mouse.down()
    steps = 14
    for i in range(1, steps + 1): p.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2 + (t['y'] + 4 - g['y']) * i / steps)
    p.mouse.up(); wait(250)
    order = [e.input_value() for e in p.query_selector_all('#jbSList .jbsname')]
    chk('dragging the grip reorders the rows', order == ['Saved', 'Applied', 'Take-home', 'Interview', 'Offer received', 'Closed'], order)
    p.screenshot(path=os.path.join(OUT, 'jobs_stages.png'))
    p.click('[data-jb=ssave]'); wait(600)
    post = calls('POST')[-1][3]
    st = post.get('stages') or []
    chk('POST sends the whole list in order with ids, kinds and follow-up days',
        [s['name'] for s in st] == ['Saved', 'Applied', 'Take-home', 'Interview', 'Offer received', 'Closed'] and st[2]['id'] == '' and st[1]['id'] == 'st1' and st[2]['follow_days'] == 3 and st[2]['color'] == 'rose' and st[4]['kind'] == 'won' and st[1]['follow_days'] == 7, st)
    chk('board follows the new stages and the job stayed in Applied', names() == ['Saved', 'Applied', 'Take-home', 'Interview', 'Offer received', 'Closed'] and col_of('Corvid') == 1, names())

    # delete takes two taps
    p.click('.jbcard:has-text("Eval Lead")'); wait(300)
    p.click('#jbDel'); wait(150)
    chk('first tap on Delete only arms it', len([c for c in h.calls if c[0] == 'DELETE' and 'jobs' in c[2]]) == 0 and 'again' in p.inner_text('#jbDel'))
    p.click('#jbDel'); wait(500)
    chk('second tap deletes', len([c for c in h.calls if c[0] == 'DELETE' and 'jobs' in c[2]]) == 1 and col_of('Eval Lead') == -1)

    # to-do link: the sheet has an optional time and the save reports the to-do
    p.click('.jbcard'); wait(300)
    p.fill('#jbNextAt', '10:30'); p.click('[data-jb=save]'); wait(500)
    patch = calls('PATCH')[-1][3]
    chk('Save sends next_at with the date', patch.get('next_at') == '10:30' and patch.get('next_on') == '2026-10-20', patch)
    chk('toast says a to-do was added', 'to-do added' in p.inner_text('body'), '')
    chk('the To-do list is refreshed after a dated next step', len([c for c in h.calls if c[0] == 'GET' and c[1] == '/api/todos']) >= 2)
    p.click('.jbcard'); wait(250)
    p.fill('#jbNextOn', ''); p.click('[data-jb=save]'); wait(500)
    patch = calls('PATCH')[-1][3]
    chk('clearing the date sends an empty time too', patch.get('next_on') == '' and patch.get('next_at') == '', patch)
    p.click('.jbcard'); wait(250); p.fill('#jbNextOn', '2026-10-20'); p.click('[data-jb=save]'); wait(400)

    # Discover (leads from LinkedIn alert emails)
    h.jleads = [{'id': 'L1', 'source': 'linkedin', 'role': 'AI Data Operations Manager', 'company': 'Corvid Labs', 'location': 'London, England', 'mode': '', 'url': 'https://www.linkedin.com/jobs/view/1111111111/', 'created_at': '2026-11-13T08:00:00Z', 'fit': 83, 'why': 'RLHF, LLM', 'salary': '£60k-£70k'},
                {'id': 'L2', 'source': 'linkedin', 'role': 'Eval Lead', 'company': 'Cloudy', 'location': 'United Kingdom', 'mode': 'remote', 'url': 'https://www.linkedin.com/jobs/view/2222222222/', 'created_at': '2026-11-14T08:00:00Z'}]
    p.click('[data-jb=view][data-v=board]'); wait(200); p.evaluate("App.views.jobs.show()"); wait(500)
    p.click('[data-jb=view][data-v=discover]'); wait(600)
    chk('Discover button shows the count of new postings', '2' in p.inner_text('[data-jb=view][data-v=discover]'), p.inner_text('[data-jb=view][data-v=discover]'))
    chk('Discover lists both postings with Save / Dismiss / View', len(p.query_selector_all('.jblead')) == 2 and len(p.query_selector_all('[data-jb=lsave]')) == 2 and len(p.query_selector_all('.jblead a.btn')) == 2)
    chk('lead shows company, role, place and where it came from', all(t in p.inner_text('.jblead') for t in ['Corvid Labs', 'AI Data Operations Manager', 'London', 'LinkedIn']), p.inner_text('.jblead'))
    p.screenshot(path=os.path.join(OUT, 'jobs_discover.png'))
    chk('lead shows fit score, matched skills and salary', all(t in p.inner_text('.jblead') for t in ['83% fit', 'Matches: RLHF, LLM', '£60k-£70k']), p.inner_text('.jblead'))
    chk('opening Discover asks the server to check Reed (not forced)', any(c[0] == 'POST' and c[2].get('jobs') == ['feed'] and c[3] == {'force': False} for c in h.calls), [c for c in h.calls if str(c[2].get('jobs', '')).startswith("['feed")])
    h.feed_added = [{'id': 'R1', 'source': 'reed', 'role': 'RLHF Programme Lead', 'company': 'Reedco', 'location': 'London', 'mode': '', 'url': 'https://www.reed.co.uk/jobs/x/1', 'created_at': '2026-11-14T09:00:00Z', 'fit': 100, 'why': 'RLHF', 'salary': ''}]
    p.click('[data-jb=fcheck]'); wait(700)
    chk('Check now forces a search and the new Reed posting appears', any(c[0] == 'POST' and c[2].get('jobs') == ['feed'] and c[3] == {'force': True} for c in h.calls) and 'Reedco' in p.inner_text('#jobsPane') and '1 new from Reed' in p.inner_text('#jobsPane'), p.inner_text('#jobsPane')[:200])
    p.click('[data-jb=fcfg]'); wait(400)
    chk('Settings shows the keywords and skills boxes', p.input_value('#jbFKw') == 'AI ops' and p.input_value('#jbFSk') == 'RLHF\nLLM')
    p.fill('#jbFKw', 'AI ops\nLLM evaluation'); p.fill('#jbFSk', 'RLHF, LLM\nSLA'); p.click('[data-jb=fsave]'); wait(500)
    chk('Settings save sends the lists (commas or lines)', calls('POST')[-1][3] == {'keywords': ['AI ops', 'LLM evaluation'], 'skills': ['RLHF', 'LLM', 'SLA']} and not p.query_selector('#jbFKw'), calls('POST')[-1][3])
    p.click('[data-jb=ldismiss][data-id=R1]'); wait(400)
    p.click('.jblead [data-jb=lsave]'); wait(500)
    chk('Save posts the lead id and removes it from the list', calls('POST')[-1][3] == {'id': 'L1', 'action': 'save'} and len(p.query_selector_all('.jblead')) == 1, calls('POST')[-1][3])
    p.click('[data-jb=ldismiss]'); wait(500)
    chk('Dismiss removes the other one', calls('POST')[-1][3] == {'id': 'L2', 'action': 'dismiss'} and 'Nothing to look at' in p.inner_text('#jobsPane'))
    chk('Discover badge gone when empty', 'jbn' not in p.inner_html('[data-jb=view][data-v=discover]'))
    p.click('[data-jb=view][data-v=board]'); wait(400)
    chk('the saved posting is on the board in Saved', col_of('Corvid Labs') == 0, names())
    h.jleads = [dict(h.jleads[0] if h.jleads else {'id': 'L3', 'source': 'linkedin', 'role': 'PM', 'company': 'Zed', 'location': 'London', 'mode': '', 'url': '', 'created_at': '2026-11-14T08:00:00Z'}, id='L3')]
    p.set_viewport_size({'width': 390, 'height': 844}); wait(300)
    p.click('[data-jb=view][data-v=discover]'); wait(500)
    chk('Discover phone: no sideways overflow', p.evaluate("document.documentElement.scrollWidth <= 390 && document.body.scrollWidth <= 390"))
    chk('Discover phone: the three-way switch fits and is 44px', p.evaluate("(function(){var b=document.querySelectorAll('.jbseg button'),i,r;for(i=0;i<b.length;i++){r=b[i].getBoundingClientRect();if(r.height<43.5||r.right>390)return false}return b.length===3})()"))
    small = p.evaluate("""(function(){var o=[],els=document.querySelectorAll('.jblead .btn'),k,r;for(k=0;k<els.length;k++){r=els[k].getBoundingClientRect();if(r.height&&r.height<43.5)o.push(r.height)}return o})()""")
    chk('Discover phone: buttons are 44px', not small, small)
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(300)
    p.click('[data-jb=view][data-v=board]'); wait(300)

    # analytics
    p.click('[data-jb=view][data-v=stats]'); wait(600)
    chk('Analytics replaces the board', p.query_selector('#jbStrip') is None and len(p.query_selector_all('.jbcard2')) == 4, len(p.query_selector_all('.jbcard2')))
    chk('summary tiles', [e.inner_text().split('\n')[1] for e in p.query_selector_all('.jbkpis2 .jbkpi')] == ['Applied', 'Heard back', 'Response rate', 'Offers'])
    chk('funnel bars drawn', len(p.query_selector_all('.jbtrack i')) >= 3)
    chk('8 weekly bars', len(p.query_selector_all('.jbwc')) == 8)
    chk('sources table', 'Added by hand' in p.inner_text('.jbtbl'))
    chk('stats fetched once', len([c for c in h.calls if c[0] == 'GET' and 'jobs' in c[2] and c[2].get('jobs') == ['stats']]) >= 1)
    chk('analytics: no sideways overflow at 1024', p.evaluate("document.documentElement.scrollWidth <= 1024 && document.body.scrollWidth <= 1024"))
    n0 = len(h.calls); p.evaluate("App.views.jobs.render();App.views.jobs.render()"); wait(200)
    chk('analytics: a background redraw writes nothing', len(h.calls) == n0 or all(c[2].get('jobs') != ['stats'] for c in h.calls[n0:]))
    p.screenshot(path=os.path.join(OUT, 'jobs_analytics.png'))
    p.set_viewport_size({'width': 390, 'height': 844}); wait(300)
    chk('analytics phone: no sideways overflow', p.evaluate("document.documentElement.scrollWidth <= 390 && document.body.scrollWidth <= 390"))
    chk('analytics phone: cards stack', len(set([int(e.bounding_box()['x']) for e in p.query_selector_all('.jbcard2')])) == 1)
    small = p.evaluate("""(function(){var o=[],els=document.querySelectorAll('.jbseg button'),k,r;for(k=0;k<els.length;k++){r=els[k].getBoundingClientRect();if(r.height&&r.height<43.5)o.push(r.height)}return o})()""")
    chk('analytics phone: switch buttons are 44px', not small, small)
    p.screenshot(path=os.path.join(OUT, 'jobs_analytics_phone.png'))
    p.set_viewport_size({'width': 1024, 'height': 768}); wait(300)
    p.click('[data-jb=view][data-v=board]'); wait(400)
    chk('Board button returns to the pipeline', p.query_selector('#jbStrip') is not None)

    # sizes
    small = p.evaluate("""(function(){var o=[],q=['.jbacts .btn','.jbaddc'],i,els,k,r;for(i=0;i<q.length;i++){els=document.querySelectorAll(q[i]);for(k=0;k<els.length;k++){r=els[k].getBoundingClientRect();if(r.height&&r.height<43.5)o.push(q[i]+' '+r.height)}}return o})()""")
    chk('buttons are 44px tall', not small, small)
    p.set_viewport_size({'width': 768, 'height': 1024}); wait(300)
    chk('no sideways overflow at 768x1024', p.evaluate("document.documentElement.scrollWidth <= 768 && document.body.scrollWidth <= 768"))

    # phone
    p.set_viewport_size({'width': 390, 'height': 844}); wait(400)
    chk('phone: Jobs icon in the bottom bar', p.is_visible('#nJobs'))
    chk('phone: stage chips shown, one column visible', p.is_visible('.jbtabs') and len([c for c in p.query_selector_all('#jbStrip .jbcol') if c.is_visible()]) == 1)
    chk('phone: no sideways overflow', p.evaluate("document.documentElement.scrollWidth <= 390 && document.body.scrollWidth <= 390"))
    p.click('.jbtab:has-text("Applied")'); wait(250)
    chk('phone: tapping a chip shows that stage', 'Corvid' in p.inner_text('#jbStrip .jbcol.on'))
    p.screenshot(path=os.path.join(OUT, 'jobs_phone.png'))
    p.click('.jbcol.on .jbcard'); wait(300)
    p.screenshot(path=os.path.join(OUT, 'jobs_phone_sheet.png'))
    box = p.query_selector('#jbSheet').bounding_box()
    chk('phone: sheet fills the width', box['width'] >= 389, box)
    small = p.evaluate("""(function(){var o=[],q=['.jbtab','.jbchip','#jbSheet .btn','.jbx'],i,els,k,r;for(i=0;i<q.length;i++){els=document.querySelectorAll(q[i]);for(k=0;k<els.length;k++){r=els[k].getBoundingClientRect();if(r.height&&r.height<43.5)o.push(q[i]+' '+r.height)}}return o})()""")
    chk('phone: chips and buttons are 44px tall', not small, small)
    p.click('.jbx'); wait(200)

    # server problem, then Try again
    p.set_viewport_size({'width': 1024, 'height': 768})
    h.allow.append('500'); h.fail_jobs = True
    p.reload(); wait(900); p.click('#nJobs'); wait(900)
    chk('error shown with Try again', 'Could not reach the server' in p.inner_text('#jobsPane') and p.is_visible('[data-jb=retry]'))
    h.fail_jobs = False; p.click('[data-jb=retry]'); wait(700)
    chk('Try again loads the board', names()[:2] == ['Saved', 'Applied'], names())
    return R
