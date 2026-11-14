// Node test for the LinkedIn alert-email reader (api/_jobmail.js) and the leads routes. Run: node tests/jobmail_node.js
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js'));
var db = { leads: [], calls: [] };
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  db.calls.push(n);
  if (a.p_token === 'bad') throw Object.assign(new Error('bad token'), { code: '28000' });
  if (n === 'job_leads_add') { a.p_leads.forEach(function (l) { db.leads.push(l); }); return { added: a.p_leads.length, skipped: 0 }; }
  if (n === 'job_leads_list') return db.leads;
  if (n === 'job_lead_act') { if (a.p_action === 'save') return { job: { id: 'jj', stage_id: 'sx', role: 'PM', company: 'Acme', next_todo: null }, lead_id: a.p_id }; return { ok: true, lead_id: a.p_id }; }
  if (n === 'job_lead_get') return { id: a.p_id, source: 'linkedin', url: '', role: 'PM', company: 'Acme', details: {}, vote: 0 };
  if (n === 'job_feed_get') return { learn: {} };
  if (n === 'job_learn_put') return {};
  if (n === 'job_list') return { stages: [{ id: 'sx', name: 'Saved', kind: 'active', follow_days: null }], jobs: [] };
  throw new Error('unexpected ' + n);
} } };
var M = require('../api/_jobmail.js'), h = require('../api/_jobs.js');
function call(method, query, body, tok) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: method, query: query, headers: { 'x-todo-token': tok || 'tok' }, body: body }, res); }); }
(async function () {
  assert.strictEqual(M.jobUrl('https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=x&refId=y'), 'https://www.linkedin.com/jobs/view/3912345678/');
  assert.strictEqual(M.jobUrl('https://uk.linkedin.com/jobs/view/senior-pm-at-acme-3912345679?x=1'), 'https://www.linkedin.com/jobs/view/3912345679/');
  assert.strictEqual(M.jobUrl('https://www.linkedin.com/in/someone'), ''); assert.strictEqual(M.jobUrl('https://evil.com/?u=linkedin.com/jobs/view/1234567'), ''); assert.strictEqual(M.jobUrl('javascript:alert(1)'), '');
  var links = M.cleanLinks([{ url: 'https://www.linkedin.com/comm/jobs/view/1111111111?a=1', text: ' Data Ops Lead ' }, { url: 'https://www.linkedin.com/jobs/view/1111111111/', text: '' }, { url: 'https://www.linkedin.com/comm/jobs/view/2222222222', text: 'AI PM' },
    { url: 'https://www.linkedin.com/comm/jobs/view/3333333333', text: 'Remote Eval Lead' }, { url: 'https://www.linkedin.com/comm/jobs/view/4444444444', text: 'Manchester role' }, { url: 'https://www.linkedin.com/feed/', text: 'x' }]);
  assert.strictEqual(links.length, 4, 'job links only, duplicates merged'); assert.strictEqual(links[0].text, 'Data Ops Lead');
  assert.ok(/\[0\] https:\/\/www\.linkedin\.com\/jobs\/view\/1111111111\//.test(M.buildPrompt('hello', links)));
  assert.deepStrictEqual(M.parseJobs('```json\n{"jobs":[{"link":0}]}\n```'), [{ link: 0 }]); assert.strictEqual(M.parseJobs('nope'), null); assert.deepStrictEqual(M.parseJobs('[{"link":1}]'), [{ link: 1 }]);
  assert.ok(M.okPlace('London, England, United Kingdom') && M.okPlace('Greater London Area') && M.okPlace('United Kingdom (Remote)') && M.okPlace('') && M.okPlace('Leeds', true));
  assert.ok(!M.okPlace('Manchester, England') && !M.okPlace('New York'));
  var fake = async function () { return JSON.stringify({ jobs: [
    { link: 0, role: 'Data Ops Lead', company: 'Corvid', location: 'London, England', remote: false }, { link: 1, role: 'AI PM', company: 'Moor', location: 'United Kingdom (Remote)', remote: false },
    { link: 2, role: 'Eval Lead', company: 'Cloudy', location: 'Anywhere', remote: true }, { link: 3, role: 'Ops', company: 'North', location: 'Manchester', remote: false },
    { link: 9, role: 'Made up', company: 'Ghost', location: 'London' }, { link: 0, role: 'Dup', company: 'Corvid', location: 'London' }] }); };
  var rd = await M.read({ text: 'Your job alert', links: [{ url: 'https://www.linkedin.com/comm/jobs/view/1111111111', text: 'a' }, { url: 'https://www.linkedin.com/comm/jobs/view/2222222222', text: 'b' }, { url: 'https://www.linkedin.com/comm/jobs/view/3333333333', text: 'c' }, { url: 'https://www.linkedin.com/comm/jobs/view/4444444444', text: 'd' }] }, fake);
  assert.deepStrictEqual(rd.leads.map(function (l) { return l.company + '|' + l.mode + '|' + l.url.slice(-12); }), ['Corvid||/1111111111/', 'Moor|remote|/2222222222/', 'Cloudy|remote|/3333333333/'], 'Manchester dropped, invented link dropped, duplicate dropped, remote kept');
  assert.strictEqual((await M.read({ text: 'x', links: [{ url: 'https://www.linkedin.com/feed/' }] }, fake)).leads.length, 0, 'no job links: Gemini not needed');
  await assert.rejects(M.read({ text: 'x', links: [{ url: 'https://www.linkedin.com/jobs/view/1234567/' }] }, async function () { return 'not json'; }), /not understood/);
  // routes
  assert.strictEqual((await call('POST', { jobs: 'email' }, { text: 'x', links: [] }, 'bad')).s, 401, 'bad token is refused before Gemini');
  var r = await call('POST', { jobs: 'email' }, { text: 'x', links: [] }); assert.strictEqual(r.s, 200); assert.deepStrictEqual([r.d.added, r.d.seen], [0, 0]);
  delete process.env.GEMINI_API_KEY; r = await call('POST', { jobs: 'email' }, { text: 'x', links: [{ url: 'https://www.linkedin.com/jobs/view/1234567/', text: 'a' }] }); assert.strictEqual(r.s, 503, 'no key: the script gets a retryable answer');
  assert.strictEqual((await call('GET', { jobs: 'leads' })).s, 200);
  assert.strictEqual((await call('POST', { jobs: 'leads' }, { id: 'nope', action: 'save' })).s, 400);
  assert.strictEqual((await call('POST', { jobs: 'leads' }, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'zap' })).s, 400);
  r = await call('POST', { jobs: 'leads' }, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'save' }); assert.strictEqual(r.s, 200); assert.strictEqual(r.d.job.company, 'Acme'); assert.ok(!('next_todo' in r.d.job));
  r = await call('POST', { jobs: 'leads' }, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'dismiss' }); assert.deepStrictEqual(r.d.ok, true);
  console.log('jobmail_node: ok');
})().catch(function (e) { console.log(e.stack || e); process.exit(1); });
