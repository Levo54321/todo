// node tests/joblearn_node.js : "More like this" weights, ranking and the leads routes (stubbed database)
var assert = require('assert'), path = require('path'), L = require('../api/_joblearn.js');
assert.deepStrictEqual(L.terms({ role: 'Senior RLHF Programme Manager (London)', company: ' Acme   Ltd ' }), ['senior', 'rlhf', 'programme', 'manager', 'co:acme ltd'], 'title words, stop words and short words dropped, company kept');
var w = L.learn({}, { role: 'RLHF Programme Lead', company: 'Acme' }, 'like'); assert.strictEqual(w.rlhf, 3);
w = L.learn(w, { role: 'RLHF Programme Lead', company: 'Acme' }, 'dismiss'); assert.strictEqual(w.rlhf, 2, 'dismiss takes a little back');
w = L.learn(w, { role: 'RLHF Programme Lead', company: 'Acme' }, 'dislike'); assert.strictEqual(w.rlhf, -1, 'not for me pushes it down');
assert.deepStrictEqual(L.learn({ x: 1 }, { role: 'Chef' }, 'bogus'), { x: 1 }, 'unknown action changes nothing');
var big = {}, i; for (i = 0; i < 20; i++) big = L.learn(big, { role: 'rlhf' }, 'like'); assert.strictEqual(big.rlhf, 15, 'weights are capped');
var many = {}; for (i = 0; i < 310; i++) many['t' + i] = 1; many.keep = 15; assert.ok(Object.keys(L.learn(many, { role: 'zzz' }, 'like')).length <= 300 && L.learn(many, { role: 'zzz' }, 'like').keep === 15, 'weakest terms are forgotten first');
var liked = L.learn({}, { role: 'RLHF Programme Manager', company: 'Acme' }, 'like');
assert.strictEqual(L.boost(liked, { role: 'Chef', company: 'x' }), 0); assert.ok(L.boost(liked, { role: 'RLHF Programme Lead', company: 'Other' }) > 0);
assert.strictEqual(L.boost({ a1b: 99 }, { role: 'a1b' }), 25, 'boost is capped at 25');
var r = L.rank([{ id: 1, fit: 50, role: 'Chef', created_at: '2026-11-13' }, { id: 2, fit: 48, role: 'RLHF Programme Manager', company: 'Acme', created_at: '2026-11-12' }, { id: 3, fit: null, role: 'RLHF Lead', created_at: '2026-11-14' }], liked);
assert.deepStrictEqual(r.map(function (x) { return x.id; }), [2, 1, 3], 'liked-like role overtakes; no-fit leads stay last'); assert.ok(r[0].fit > 48 && r[0].boost > 0 && r[1].boost === 0 && r[2].fit === null);

// routes
var tp = require.resolve(path.join(__dirname, '../api/todos.js')), LID = '11111111-1111-4111-8111-111111111111';
var db = { lead: { id: LID, source: 'reed', url: 'https://www.reed.co.uk/jobs/x/12345678', role: 'RLHF Programme Lead', company: 'Acme', vote: 0, details: { description: 'x' } }, learn: {}, calls: [], votes: [] };
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  db.calls.push(n);
  if (n === 'job_lead_get') return JSON.parse(JSON.stringify(db.lead));
  if (n === 'job_lead_vote') { db.lead.vote = a.p_vote; db.votes.push(a.p_vote); return { id: LID, vote: a.p_vote }; }
  if (n === 'job_feed_get') return { learn: JSON.parse(JSON.stringify(db.learn)) };
  if (n === 'job_learn_put') { db.learn = a.p_learn; return {}; }
  if (n === 'job_lead_act') return a.p_action === 'save' ? { job: { id: 'j', stage_id: 's', role: 'x', company: 'y', details: {}, next_todo: null }, lead_id: LID } : { ok: true, lead_id: LID };
  if (n === 'job_leads_list') return [{ id: LID, fit: 40, role: 'RLHF Lead', created_at: 'a' }];
  if (n === 'job_list') return { stages: [{ id: 's', name: 'Saved', kind: 'active', follow_days: null }], jobs: [] };
  throw new Error('unexpected ' + n);
} } };
var h = require('../api/_jobs.js');
function call(method, query, body) { return new Promise(function (res) { var rs = { statusCode: 0, setHeader: function () {}, end: function (s) { res({ s: rs.statusCode, d: JSON.parse(s) }); } }; h({ method: method, query: query, headers: { 'x-todo-token': 't' }, body: body }, rs); }); }
(async function () {
  var x = await call('POST', { jobs: 'leads' }, { id: LID, action: 'like' }); assert.deepStrictEqual([x.s, x.d.vote], [200, 1]); assert.ok(db.learn.rlhf === 3, 'like teaches');
  await call('POST', { jobs: 'leads' }, { id: LID, action: 'like' }); assert.strictEqual(db.votes.length, 1); assert.strictEqual(db.learn.rlhf, 3, 'liking twice teaches once');
  x = await call('GET', { jobs: 'leads' }); assert.ok(x.d.leads[0].boost > 0 && x.d.leads[0].fit > 40, 'list shows the boost');
  db.calls = []; x = await call('POST', { jobs: 'leads' }, { id: LID, action: 'dislike' }); assert.strictEqual(x.s, 200); assert.ok(db.learn.rlhf === 0 || db.learn.rlhf === undefined, 'not for me undoes the like');
  assert.ok(db.calls.indexOf('job_lead_act') >= 0, 'not for me also removes the lead from the list');
  x = await call('POST', { jobs: 'leads' }, { id: LID, action: 'save' }); assert.strictEqual(x.s, 200); assert.strictEqual(db.learn.rlhf, 3, 'saving teaches');
  console.log('joblearn_node: ok');
})().catch(function (e) { console.log(e.stack || e); process.exit(1); });
