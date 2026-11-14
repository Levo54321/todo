// Node unit test for api/_jobs.js (the Jobs tab) with a fake database. Run: node tests/jobs_node.js
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js'));
var db = { jobs: [], calls: [] };
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  db.calls.push([n, a]);
  if (a.p_token === 'bad') throw Object.assign(new Error('bad token'), { code: '28000' });
  if (n === 'job_list') return { stages: [{ id: 's1', name: 'Saved' }], jobs: db.jobs };
  if (n === 'job_put') { var j = Object.assign({ id: a.p_job.id || 'j' + (db.jobs.length + 1), source: a.p_source }, a.p_job); if (!a.p_job.id) db.jobs.push(j); return j; }
  if (n === 'job_get') { if (a.p_id === '00000000-0000-4000-8000-000000000000') throw Object.assign(new Error('nf'), { code: 'P0002' }); return { job: {}, events: [] }; }
  if (n === 'job_del') return { ok: true };
  if (n === 'job_stages_put') return { stages: a.p_stages, jobs: [] };
  throw new Error('unexpected ' + n);
} } };
var logs = []; console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
var h = require('../api/_jobs.js'), T = h._t;
function call(method, query, body, tok) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: method, query: query || {}, headers: tok === null ? {} : { 'x-todo-token': tok || 'tok' }, body: body }, res); }); }
var ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
(async function () {
  // helpers
  var p = T.parseShare({ text: 'Check out this job: Senior Human Data PM at Moorland AI https://www.linkedin.com/jobs/view/3912345678/?trackingId=abc&refId=x' });
  assert.deepStrictEqual(p.job, { role: 'Senior Human Data PM', company: 'Moorland AI', url: 'https://www.linkedin.com/jobs/view/3912345678/' }); assert.strictEqual(p.source, 'linkedin');
  p = T.parseShare({ url: 'https://www.linkedin.com/jobs/view/senior-pm-at-acme-3912345679?x=1', text: 'Data Ops Lead - Corvid' });
  assert.strictEqual(p.job.url, 'https://www.linkedin.com/jobs/view/3912345679/'); assert.strictEqual(p.job.company, 'Corvid'); assert.strictEqual(p.job.role, 'Data Ops Lead');
  p = T.parseShare({ text: 'https://www.adzuna.co.uk/jobs/land/ad/123' }); assert.strictEqual(p.job.role, 'Saved job'); assert.strictEqual(p.source, 'adzuna');
  p = T.parseShare({ text: 'javascript:alert(1) Lead' }); assert.strictEqual(p.job.url, ''); assert.strictEqual(p.source, 'share');
  assert.deepStrictEqual(T.clean({ role: ' PM ', mode: 'banana', url: 'ftp://x', next_on: '2026-13-45', stage_id: 'nope', evil: 1 }), { role: 'PM', mode: '', url: '', next_on: '', stage_id: '' }, 'only known keys, junk blanked');
  assert.deepStrictEqual(T.clean({ notes: 'x' }), { notes: 'x' }, 'only the keys sent');
  assert.strictEqual(T.clean({ company: new Array(300).join('a') }).company.length, 120);
  assert.ok(T.realDate('2026-02-28') && !T.realDate('2026-02-30'));
  assert.strictEqual(T.cleanStages([]), null); assert.strictEqual(T.cleanStages([{ name: ' ' }]), null);
  assert.strictEqual(T.cleanStages(new Array(14).join('x').split('').map(function () { return { name: 'a' }; })), null, '13 stages refused');
  assert.deepStrictEqual(T.cleanStages([{ name: ' Take-home ', color: 'rose', kind: 'weird', follow_days: '3' }, { id: ID, name: 'A', follow_days: 99 }]),
    [{ id: '', name: 'Take-home', color: 'rose', kind: 'active', follow_days: 3 }, { id: ID, name: 'A', color: 'sand', kind: 'active', follow_days: null }]);
  // endpoint
  assert.strictEqual((await call('GET', { jobs: '1' }, null, null)).s, 401, 'no token');
  assert.strictEqual((await call('GET', { jobs: '1' }, null, 'bad')).s, 401, 'bad token');
  var r = await call('POST', { jobs: '1' }, { company: 'Corvid', role: 'AI Data Ops Manager', mode: 'hybrid' }); assert.strictEqual(r.s, 201); assert.strictEqual(r.d.job.source, 'manual');
  r = await call('POST', { jobs: 'quick' }, { text: 'PM at Acme https://www.linkedin.com/jobs/view/3999999999/?a=1' }); assert.strictEqual(r.s, 201); assert.strictEqual(r.d.job.source, 'linkedin');
  r = await call('POST', { jobs: 'quick' }, 'PM at Acme https://www.linkedin.com/jobs/view/3999999999/?b=2'); assert.strictEqual(r.s, 200); assert.strictEqual(r.d.duplicate, true, 'same job is not saved twice (plain text body too)');
  assert.strictEqual(db.jobs.length, 2);
  r = await call('PATCH', { jobs: '1', id: ID }, { stage_id: ID, notes: 'hi' }); assert.strictEqual(r.s, 200); assert.strictEqual(r.d.job.id, ID); assert.strictEqual(r.d.job.notes, 'hi');
  assert.strictEqual((await call('PATCH', { jobs: '1', id: 'nope' }, {})).s, 400);
  assert.strictEqual((await call('GET', { jobs: '1', id: '00000000-0000-4000-8000-000000000000' })).s, 404, 'not found maps to 404');
  assert.strictEqual((await call('DELETE', { jobs: '1', id: ID })).d.ok, true);
  assert.strictEqual((await call('POST', { jobs: 'stages' }, { stages: [] })).s, 400);
  r = await call('POST', { jobs: 'stages' }, { stages: [{ name: 'One', color: 'sage' }] }); assert.strictEqual(r.s, 200); assert.strictEqual(r.d.stages[0].color, 'sage');
  assert.strictEqual((await call('PUT', { jobs: '1' }, {})).s, 405);
  assert.deepStrictEqual(logs, [], 'nothing logged for normal calls');
  console.log('jobs_node: ok');
})().catch(function (e) { console.error = function () {}; console.log('FAIL', e && e.stack || e); process.exit(1); });
