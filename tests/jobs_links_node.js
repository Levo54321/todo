// Node test for Jobs step 2: analytics (computeStats) and the to-do links (syncLinks via the handler). Run: node tests/jobs_links_node.js
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js'));
var S = [{ id: '51000000-0000-4000-8000-000000000000', name: 'Saved', color: 'sand', kind: 'active', follow_days: null }, { id: '52000000-0000-4000-8000-000000000000', name: 'Applied', color: 'clay', kind: 'active', follow_days: 7 },
  { id: '53000000-0000-4000-8000-000000000000', name: 'Screening', color: 'ochre', kind: 'active', follow_days: null }, { id: '54000000-0000-4000-8000-000000000000', name: 'Offer', color: 'moss', kind: 'won', follow_days: null }, { id: '55000000-0000-4000-8000-000000000000', name: 'Closed', color: 'stone', kind: 'lost', follow_days: null }];
var db = { jobs: {}, todos: {}, n: 0, calls: [], failTodos: false };
function uid(p) { db.n++; return p + '0000000-0000-4000-8000-' + ('000000000000' + db.n).slice(-12); }
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  db.calls.push(n);
  if (n === 'job_list') return { stages: S, jobs: Object.keys(db.jobs).map(function (k) { return db.jobs[k]; }) };
  if (n === 'job_put') {
    var p = a.p_job, j = p.id ? db.jobs[p.id] : null, prev = j ? j.stage_id : null, k;
    if (!j) { j = db.jobs[uid('a')] = { id: null, stage_id: p.stage_id || '51000000-0000-4000-8000-000000000000', next_on: null, next_at: '', next_step: '', role: '', company: '', next_todo: null, follow_todo: null }; j.id = Object.keys(db.jobs).pop(); }
    for (k in p) if (k !== 'id') j[k] = p[k] === '' && k === 'next_on' ? null : p[k];
    return Object.assign({}, j, { prev_stage: prev });
  }
  if (n === 'job_link') { db.jobs[a.p_id].next_todo = a.p_next; db.jobs[a.p_id].follow_todo = a.p_follow; return {}; }
  if (n === 'job_get') return { job: db.jobs[a.p_id], events: [] };
  if (n === 'job_del') { delete db.jobs[a.p_id]; return { ok: true }; }
  if (n === 'todo_add') { if (db.failTodos) throw new Error('down'); var id = uid('b'); db.todos[id] = { title: a.p_title, due: a.p_due, remind: a.p_remind, cat: a.p_category, list: a.p_list }; return { id: id }; }
  if (n === 'todo_update') { if (!db.todos[a.p_id]) throw Object.assign(new Error('nf'), { code: 'P0002' }); var t = db.todos[a.p_id]; t.title = a.p_patch.title; t.due = a.p_patch.due_date; t.remind = a.p_patch.remind_time; return {}; }
  if (n === 'todo_delete') { delete db.todos[a.p_id]; return {}; }
  throw new Error('unexpected ' + n);
} } };
console.error = function () { if (process.env.DBG) console.log([].slice.call(arguments).join(" ")); };
var h = require('../api/_jobs.js'), T = h._t;
function call(method, query, body) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: method, query: query, headers: { 'x-todo-token': 'tok' }, body: body }, res); }); }
function todayLondon() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function plus(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
(async function () {
  // ---- to-do links ----
  var r = await call('POST', { jobs: '1' }, { company: 'Corvid', role: 'PM', stage_id: '51000000-0000-4000-8000-000000000000', next_step: 'Phone screen', next_on: '2026-12-01', next_at: '10:30' });
  assert.strictEqual(r.s, 201); assert.strictEqual(r.d.tasks.next, 'created'); var id = r.d.job.id;
  assert.ok(!('next_todo' in r.d.job) && !('prev_stage' in r.d.job), 'internal keys not sent to the browser');
  var tid = db.jobs[id].next_todo, t = db.todos[tid];
  assert.deepStrictEqual([t.title, t.due, t.remind, t.cat, t.list], ['Job: Phone screen · PM at Corvid', '2026-12-01', '10:30', 'Job hunt', 'personal']);
  r = await call('PATCH', { jobs: '1', id: id }, { next_on: '2026-12-03', next_at: '' }); assert.strictEqual(r.d.tasks.next, 'updated');
  assert.strictEqual(db.todos[tid].due, '2026-12-03'); assert.strictEqual(db.todos[tid].remind, '');
  r = await call('PATCH', { jobs: '1', id: id }, { notes: 'x' }); assert.deepStrictEqual(r.d.tasks, {}, 'unrelated edit touches no to-do');
  db.todos[tid] = undefined; delete db.todos[tid];
  r = await call('PATCH', { jobs: '1', id: id }, { next_step: 'Call back' }); assert.strictEqual(r.d.tasks.next, 'created', 'a deleted to-do is made again'); tid = db.jobs[id].next_todo;
  // moving into Applied (follow up after 7 days)
  r = await call('PATCH', { jobs: '1', id: id }, { stage_id: '52000000-0000-4000-8000-000000000000' }); assert.strictEqual(r.d.tasks.follow, 'created');
  var fid = db.jobs[id].follow_todo; assert.strictEqual(db.todos[fid].title, 'Follow up: PM at Corvid'); assert.strictEqual(db.todos[fid].due, plus(todayLondon(), 7));
  // moving on removes the old follow-up; Screening has no follow_days
  r = await call('PATCH', { jobs: '1', id: id }, { stage_id: '53000000-0000-4000-8000-000000000000' }); assert.strictEqual(r.d.tasks.follow, 'removed'); assert.ok(!db.todos[fid] && !db.jobs[id].follow_todo);
  // moving back in makes a fresh one; saving without a move does not duplicate it
  r = await call('PATCH', { jobs: '1', id: id }, { stage_id: '52000000-0000-4000-8000-000000000000' }); fid = db.jobs[id].follow_todo; assert.ok(fid);
  r = await call('PATCH', { jobs: '1', id: id }, { stage_id: '52000000-0000-4000-8000-000000000000', company: 'Corvid Ltd' }); assert.ok(!r.d.tasks.follow, 'same stage: no new follow-up'); assert.strictEqual(db.jobs[id].follow_todo, fid);
  assert.ok(/Corvid Ltd/.test(db.todos[db.jobs[id].next_todo].title), 'renaming the company updates the next-step to-do');
  // closed (lost) removes the next-step to-do and the follow-up
  r = await call('PATCH', { jobs: '1', id: id }, { stage_id: '55000000-0000-4000-8000-000000000000' }); assert.strictEqual(r.d.tasks.next, 'removed'); assert.ok(!db.jobs[id].next_todo); assert.ok(!db.todos[fid]);
  assert.strictEqual(Object.keys(db.todos).length, 0, 'nothing left over');
  // clearing the date removes the to-do
  r = await call('POST', { jobs: '1' }, { role: 'X', next_on: '2026-12-09' }); var id2 = r.d.job.id;
  r = await call('PATCH', { jobs: '1', id: id2 }, { next_on: '' }); assert.strictEqual(r.d.tasks.next, 'removed'); assert.strictEqual(Object.keys(db.todos).length, 0);
  // deleting a job takes its to-dos with it
  r = await call('PATCH', { jobs: '1', id: id2 }, { next_on: '2026-12-10', stage_id: '52000000-0000-4000-8000-000000000000' }); assert.strictEqual(Object.keys(db.todos).length, 2);
  r = await call('DELETE', { jobs: '1', id: id2 }); assert.strictEqual(r.s, 200); assert.strictEqual(Object.keys(db.todos).length, 0);
  // the to-do side being down never fails the save
  db.failTodos = true; r = await call('POST', { jobs: '1' }, { role: 'Y', next_on: '2026-12-11' }); assert.strictEqual(r.s, 201); assert.ok(r.d.job.id);
  db.failTodos = false;
  // bad time
  assert.strictEqual(T.clean({ next_at: '25:00' }).next_at, ''); assert.strictEqual(T.clean({ next_at: '09:05' }).next_at, '09:05');
  // quick share into a stage without follow-up makes no to-do
  var before = Object.keys(db.todos).length; r = await call('POST', { jobs: 'quick' }, { text: 'Lead at Zed https://www.linkedin.com/jobs/view/3000000001/' }); assert.strictEqual(r.s, 201); assert.strictEqual(Object.keys(db.todos).length, before);

  // ---- analytics ----
  var now = Date.parse('2026-11-18T12:00:00Z'); // a Wednesday; the week starts Mon 16 Nov
  var jobs = [
    { id: 'a', stage_id: '53000000-0000-4000-8000-000000000000', applied_on: '2026-11-17', source: 'linkedin' }, { id: 'b', stage_id: '52000000-0000-4000-8000-000000000000', applied_on: '2026-11-10', source: 'linkedin' },
    { id: 'c', stage_id: '55000000-0000-4000-8000-000000000000', applied_on: '2026-11-02', source: 'adzuna' }, { id: 'd', stage_id: '51000000-0000-4000-8000-000000000000', applied_on: null, source: 'share' }, { id: 'e', stage_id: '54000000-0000-4000-8000-000000000000', applied_on: '2026-10-05', source: 'adzuna' }];
  var ev = [
    { job_id: 'a', at: '2026-11-10T09:00:00Z', kind: 'added', text: 'Saved · linkedin' }, { job_id: 'a', at: '2026-11-17T09:00:00Z', kind: 'stage', text: 'Applied' }, { job_id: 'a', at: '2026-11-17T21:00:00Z', kind: 'stage', text: 'Screening' },
    { job_id: 'b', at: '2026-11-09T09:00:00Z', kind: 'added', text: 'Saved · linkedin' }, { job_id: 'b', at: '2026-11-10T09:00:00Z', kind: 'stage', text: 'Applied' },
    { job_id: 'c', at: '2026-11-01T09:00:00Z', kind: 'added', text: 'Saved · adzuna' }, { job_id: 'c', at: '2026-11-02T09:00:00Z', kind: 'stage', text: 'Applied' }, { job_id: 'c', at: '2026-11-05T09:00:00Z', kind: 'stage', text: 'Screening' }, { job_id: 'c', at: '2026-11-09T09:00:00Z', kind: 'stage', text: 'Closed' },
    { job_id: 'd', at: '2026-11-12T09:00:00Z', kind: 'added', text: 'Saved · share' },
    { job_id: 'e', at: '2026-10-01T09:00:00Z', kind: 'added', text: 'Saved · adzuna' }, { job_id: 'e', at: '2026-10-05T09:00:00Z', kind: 'stage', text: 'Applied' }, { job_id: 'e', at: '2026-10-20T09:00:00Z', kind: 'stage', text: 'Screening' }, { job_id: 'e', at: '2026-11-01T09:00:00Z', kind: 'stage', text: 'Offer' }];
  var st = T.computeStats({ stages: S, jobs: jobs }, ev, now);
  assert.deepStrictEqual(st.summary, { total: 5, applied: 4, heard: 3, rate: 75, offers: 1, closed: 1, active: 2 });
  assert.deepStrictEqual(st.funnel.map(function (f) { return f.name + ':' + f.count; }), ['Saved:5', 'Applied:4', 'Screening:3', 'Offer:1'], 'closed (lost) is not a funnel step; a closed job still counts for what it reached');
  assert.strictEqual(st.weeks.length, 8); assert.strictEqual(st.weeks[7].start, '2026-11-16'); assert.strictEqual(st.weeks[7].n, 1);
  assert.strictEqual(st.weeks[6].start, '2026-11-09'); assert.strictEqual(st.weeks[6].n, 1); assert.strictEqual(st.weeks[5].n, 1); assert.strictEqual(st.weeks[4].n, 0); assert.strictEqual(st.weeks[1].n, 1, 'Mon 5 Oct');
  var src = {}; st.sources.forEach(function (s) { src[s.source] = s; });
  assert.deepStrictEqual([src.linkedin.total, src.linkedin.applied, src.linkedin.heard, src.linkedin.rate], [2, 2, 1, 50]);
  assert.deepStrictEqual([src.adzuna.total, src.adzuna.heard, src.adzuna.rate], [2, 2, 100]); assert.strictEqual(src.share.rate, null);
  var tm = {}; st.time.forEach(function (t) { tm[t.name] = t; });
  // time in stage: a: Saved 7d, Applied 0.5d, Screening (now) 1d; e: Saved 4d, Applied 15d, Screening 12d; Offer is terminal (not counted)
  assert.strictEqual(tm.Saved.n, 5); assert.strictEqual(tm.Applied.n, 4); assert.strictEqual(tm.Offer, undefined);
  assert.ok(Math.abs(tm.Applied.days - (0.5 + 8.125 + 3 + 15) / 4) < 0.06, 'avg Applied days ' + tm.Applied.days);
  console.log('jobs_links_node: ok');
})().catch(function (e) { console.error = console.log; console.log(e.stack || e); process.exit(1); });
