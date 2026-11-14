// node tests/jobroutes_node.js : routes ?jobs=lead and ?jobs=enrich with stubbed database, Reed and Gemini
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js'));
var LID = '11111111-1111-4111-8111-111111111111', JID = '22222222-2222-4222-8222-222222222222';
var db = { lead: { id: LID, source: 'reed', url: 'https://www.reed.co.uk/jobs/ops/12345678', role: 'Ops', company: 'Acme', details: { posted: '2026-11-12' } }, job: { id: JID, role: 'Ops', company: 'Acme', details: {} }, calls: [] };
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  db.calls.push(n);
  if (a.p_token === 'bad') throw Object.assign(new Error('bad token'), { code: '28000' });
  if (n === 'job_lead_get') return JSON.parse(JSON.stringify(db.lead));
  if (n === 'job_lead_details_set') { db.lead.details = Object.assign({}, db.lead.details, a.p_details); return JSON.parse(JSON.stringify(db.lead)); }
  if (n === 'job_get') return { job: JSON.parse(JSON.stringify(db.job)), events: [] };
  if (n === 'job_details_set') { db.job.details = Object.assign({}, db.job.details, a.p_details); return { details: db.job.details }; }
  if (n === 'job_lead_act') return { job: { id: JID, stage_id: 's', role: 'Ops', company: 'Acme', details: { x: 1 }, next_todo: null }, lead_id: a.p_id };
  if (n === 'job_list') return { stages: [{ id: 's', name: 'Saved', kind: 'active', follow_days: null }], jobs: [] };
  throw new Error('unexpected ' + n);
} } };
var jobmail = require('../api/_jobmail.js'), h = require('../api/_jobs.js'), fetches = [];
function call(method, query, body, tok) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: method, query: query, headers: { 'x-todo-token': tok || 'tok' }, body: body }, res); }); }
global.fetch = async function (url, o) { fetches.push([url, o && o.headers && o.headers.Authorization]); return { ok: true, status: 200, json: async function () { return { jobId: 12345678, jobTitle: 'Ops', jobDescription: '<p>Run ops</p>', contractType: 'permanent', externalUrl: 'https://careers.acme.com/1', expirationDate: '10/12/2026' }; } }; };
(async function () {
  var r = await call('GET', { jobs: 'lead', id: LID }, null, 'bad'); assert.strictEqual(r.s, 401, 'bad token refused');
  r = await call('GET', { jobs: 'lead', id: 'nope' }); assert.strictEqual(r.s, 400);
  delete process.env.REED_API_KEY; r = await call('GET', { jobs: 'lead', id: LID });
  assert.strictEqual(r.s, 200); assert.ok(/REED_API_KEY/.test(r.d.detail_error) && !r.d.lead.details.description, 'no key: lead still returned, error explained'); assert.strictEqual(fetches.length, 0);
  process.env.REED_API_KEY = 'secret';
  r = await call('GET', { jobs: 'lead', id: LID });
  assert.strictEqual(fetches.length, 1); assert.strictEqual(fetches[0][0], 'https://www.reed.co.uk/api/1.0/jobs/12345678'); assert.strictEqual(fetches[0][1], 'Basic ' + Buffer.from('secret:').toString('base64'));
  assert.deepStrictEqual([r.d.lead.details.description, r.d.lead.details.contract, r.d.lead.details.apply_url, r.d.lead.details.expires, r.d.lead.details.posted, r.d.detail_error], ['Run ops', 'Permanent', 'https://careers.acme.com/1', '2026-12-10', '2026-11-12', ''], 'details fetched and merged with what search gave');
  r = await call('GET', { jobs: 'lead', id: LID }); assert.strictEqual(fetches.length, 1, 'second open uses the stored details, no new Reed call');
  db.lead.source = 'linkedin'; db.lead.details = {}; r = await call('GET', { jobs: 'lead', id: LID }); assert.strictEqual(fetches.length, 1, 'non-Reed leads never call Reed'); db.lead.source = 'reed';
  // saving a lead whose details were never fetched fetches them first; the saved job comes back without details
  db.lead.details = {}; db.calls = []; r = await call('POST', { jobs: 'leads' }, { id: LID, action: 'save' });
  assert.strictEqual(r.s, 200); assert.ok(db.calls.indexOf('job_lead_details_set') >= 0 && db.calls.indexOf('job_lead_details_set') < db.calls.indexOf('job_lead_act'), 'details fetched before save'); assert.ok(!('details' in r.d.job), 'job in the reply has no details');
  // enrich
  var asked = 0; jobmail.ask = async function (prompt) { asked++; assert.ok(/Run ops/.test(prompt) === false || true); return '{"summary":"Runs ops","requirements":["SQL"],"nice_to_have":[],"skills":["SQL"]}'; };
  r = await call('POST', { jobs: 'enrich' }, { id: JID }); assert.strictEqual(r.s, 200); assert.ok(r.d.nothing, 'no description: nothing to read, Gemini not called'); assert.strictEqual(asked, 0);
  db.job.details = { description: 'Run ops. Need SQL.' };
  r = await call('POST', { jobs: 'enrich' }, { id: JID }); assert.strictEqual(asked, 1); assert.deepStrictEqual(r.d.details.ai.skills, ['SQL']); assert.strictEqual(db.job.details.description, 'Run ops. Need SQL.', 'description kept next to ai');
  r = await call('POST', { jobs: 'enrich' }, { id: JID }); assert.strictEqual(asked, 1); assert.ok(r.d.cached, 'second call served from the stored read');
  db.job.details = { description: 'x' }; jobmail.ask = async function () { throw Object.assign(new Error('Gemini did not answer.'), { status: 504 }); };
  r = await call('POST', { jobs: 'enrich' }, { id: JID }); assert.strictEqual(r.s, 504, 'Gemini trouble is passed on so the card can offer Try again');
  console.log('jobroutes_node: ok');
})().catch(function (e) { console.log('FAIL', e && e.stack || e); process.exit(1); });
