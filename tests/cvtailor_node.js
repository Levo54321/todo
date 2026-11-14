// node tests/cvtailor_node.js : Tailor my CV. Gemini only proposes; code drops anything not backed by the profile. Dummy data only.
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js'));
var JID = '22222222-2222-4222-8222-222222222222';
var P = { name: { first: 'Test', last: 'Person' }, title: 'Program Manager', contact: { phone: '0700 111 222', email: 'a@b.c', address: 'London' }, profile: 'Runs data programs for AI clients with 50 people.',
  highlights: ['Grew pool by 400% using agents'], experience: [
    { type: 'role', title: 'Lead', company: 'Acme', location: 'London', start: 'May 2025', end: 'Present', bullets: ['Directed delivery across a portfolio of AI contracts, owning SLA performance.', 'Built dashboards in Metabase tracking margin and risk.'] },
    { type: 'milestone', date: 'May 2025', title: 'Promoted', company: 'Acme' },
    { type: 'role', title: 'Analyst', company: 'Beta', location: 'Cardiff', start: 'Jan 2020', end: 'May 2025', bullets: ['Managed annotation quality for 7 people.'] }],
  core_skills: ['SQL', 'Stakeholder management', 'Quality governance'], software: [{ name: 'Excel', level: 80 }], domains: ['AI'], qualifications: [], additional_experience: [], references: [{ name: 'Ref Person', lines: ['Org', '+44 7000 000000'] }] };
var db = { job: { id: JID, role: 'Ops Lead', company: 'Corvid', details: { description: 'Lead delivery, own SLA. Need red teaming experience and SQL.' } }, profile: P, calls: [], puts: [] };
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  db.calls.push(n);
  if (a.p_token === 'bad') throw Object.assign(new Error('bad token'), { code: '28000' });
  if (n === 'job_get') return { job: JSON.parse(JSON.stringify(db.job)), events: [] };
  if (n === 'career_get') return { data: db.profile, updated_at: 't' };
  if (n === 'job_details_set') { db.job.details = Object.assign({}, db.job.details, a.p_details); return { details: db.job.details }; }
  if (n === 'job_put') { db.puts.push(a.p_job); return { id: JID }; }
  throw new Error('unexpected ' + n);
} } };
var jobmail = require('../api/_jobmail.js'), ct = require('../api/_cvtailor.js'), h = require('../api/_jobs.js'), prompts = [];
function call(method, query, body) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: method, query: query, headers: { 'x-todo-token': 'tok' }, body: body }, res); }); }
var GOOD = { kind: 'bullet', role: 0, bullet: 0, after: 'Directed delivery across a portfolio of AI contracts, owning SLA performance and risk.', why: 'SLA ownership', evidence: 'Directed delivery across a portfolio of AI contracts, owning SLA performance.' };
var answer = { keywords: [{ term: 'SLA', synonyms: [], importance: 'must' }, { term: 'red teaming', synonyms: ['adversarial testing'], importance: 'must' }, { term: 'SQL', importance: 'nice' }, { term: 'Metabase', importance: 'nice' }, { term: 'Stakeholder management', importance: 'nice' }],
  changes: [GOOD,
    { kind: 'bullet', role: 0, bullet: 1, after: 'Built dashboards in Metabase tracking margin and risk for 120 clients.', why: 'x', evidence: 'Built dashboards in Metabase tracking margin and risk.' },      // new number
    { kind: 'bullet', role: 0, bullet: 1, after: 'Built Snowflake dashboards tracking margin and risk.', why: 'x', evidence: 'Built dashboards in Metabase tracking margin and risk.' },         // new tool name
    { kind: 'bullet', role: 2, bullet: 0, after: 'Managed annotation quality for 7 people.', why: 'x', evidence: 'Managed annotation quality for 7 people.' },                              // unchanged
    { kind: 'bullet', role: 1, bullet: 0, after: 'Whatever.', why: 'x', evidence: 'Promoted something something' },                                                                // milestone, not a role
    { kind: 'bullet', role: 2, bullet: 0, after: 'Led annotation quality for 7 people across the team.', why: 'x', evidence: 'An invented sentence that is not in the CV at all' },     // evidence not in profile
    { kind: 'profile', after: 'Runs data programs for AI clients with 50 people, owning SLA performance.', why: 'summary', evidence: 'Runs data programs for AI clients with 50 people.' },
    { kind: 'skills_order', after: ['SQL', 'Quality governance', 'Stakeholder management'], why: 'SQL first', evidence: '' },
    { kind: 'skills_order', after: ['SQL', 'Invented skill', 'Stakeholder management'], why: 'bad', evidence: '' },
    { kind: 'title', after: 'Operations Lead', why: 'title', evidence: 'Lead Acme Directed delivery across a portfolio of AI contracts' }] };
jobmail.ask = async function (p) { prompts.push(p); return JSON.stringify(answer); };
(async function () {
  var r = await call('POST', { jobs: 'tailor' }, { id: JID });
  assert.strictEqual(r.s, 200); var cv = r.d.cv;
  assert.deepStrictEqual(cv.changes.map(function (c) { return c.kind; }), ['bullet', 'profile', 'skills_order'], 'only changes backed by the profile survive: ' + JSON.stringify(cv.changes.map(function (c) { return c.kind + ':' + c.after.slice(0, 30); })));
  assert.strictEqual(cv.dropped, 7, 'invented number, tool name, unchanged, milestone, bad evidence, bad skills, title with weak evidence');
  assert.strictEqual(cv.changes[0].before, P.experience[0].bullets[0], 'before text comes from the profile');
  assert.deepStrictEqual(cv.coverage.map(function (c) { return c.term + ':' + c.status; }), ['SLA:covered', 'red teaming:missing', 'SQL:skills_only', 'Metabase:covered', 'Stakeholder management:skills_only']);
  assert.strictEqual(cv.questions.length, 1); assert.ok(/red teaming/.test(cv.questions[0].question), 'one question per missing must-have');
  var pr = prompts[0]; ['Test', 'Person', '0700', 'a@b.c', 'Ref Person', '7000'].forEach(function (s) { assert.ok(pr.indexOf(s) < 0, 'prompt must not hold ' + s); });
  assert.ok(pr.indexOf('Metabase') > 0 && pr.indexOf('Lead delivery, own SLA') > 0, 'prompt has the bullets and the advert');
  // Luc's typed answer becomes usable: a number he typed is allowed, one he did not is not
  answer = { keywords: [], changes: [{ kind: 'profile', after: 'Runs data programs for AI clients with 50 people, plus ran 3 red teaming exercises.', why: 'x', evidence: 'Runs data programs for AI clients with 50 people.' }] };
  r = await call('POST', { jobs: 'tailor' }, { id: JID }); assert.strictEqual(r.d.cv.changes.length, 0, 'without his answer the new number is dropped');
  r = await call('POST', { jobs: 'tailor' }, { id: JID, answers: { 'red teaming': 'I ran 3 red teaming exercises at Acme' } });
  assert.strictEqual(r.d.cv.changes.length, 1, 'with his answer it is allowed'); assert.ok(/red teaming exercises at Acme/.test(prompts[prompts.length - 1]), 'answer reaches the prompt');
  // apply
  answer = { keywords: [{ term: 'SLA', importance: 'must' }], changes: [GOOD, { kind: 'skills_order', after: ['SQL', 'Quality governance', 'Stakeholder management'], why: 'w', evidence: '' }] };
  r = await call('POST', { jobs: 'tailor' }, { id: JID }); var ids = r.d.cv.changes.map(function (c) { return c.id; });
  r = await call('POST', { jobs: 'tailor' }, { id: JID, apply: [] }); assert.strictEqual(r.s, 400, 'nothing ticked');
  r = await call('POST', { jobs: 'tailor' }, { id: JID, apply: [ids[0]] }); assert.strictEqual(r.s, 200);
  assert.strictEqual(r.d.cv_variant, 'Tailored for Corvid'); assert.deepStrictEqual(db.puts[db.puts.length - 1], { id: JID, cv_variant: 'Tailored for Corvid' });
  var sv = db.job.details.cv.saved.tailored; assert.ok(/risk\.$/.test(sv.experience[0].bullets[0]) && sv.core_skills[0] === 'SQL' && sv.core_skills[1] === 'Stakeholder management', 'only the ticked change applied: ' + JSON.stringify(sv.core_skills));
  assert.strictEqual(P.experience[0].bullets[0].slice(-12), 'performance.', 'the profile itself is untouched');
  // re-running keeps the saved copy
  r = await call('POST', { jobs: 'tailor' }, { id: JID }); assert.ok(r.d.cv.saved && r.d.cv.saved.tailored, 'a new proposal keeps the saved tailored copy');
  // exports
  r = await call('GET', { jobs: 'cv', id: JID }); assert.strictEqual(r.s, 200); assert.ok(r.d.tailored && r.d.json.contact.phone === '0700 111 222' && /owning SLA performance and risk/.test(r.d.ats_text));
  assert.ok(/^TEST PERSON\nProgram Manager\n0700 111 222 \| a@b.c \| London/.test(r.d.ats_text) && /PROFESSIONAL EXPERIENCE/.test(r.d.ats_text) && /<h2>PROFESSIONAL EXPERIENCE<\/h2>/.test(r.d.ats_html) && /<li>/.test(r.d.ats_html));
  r = await call('GET', { jobs: 'cv', id: JID, which: 'base' }); assert.ok(!r.d.tailored && /performance\./.test(r.d.ats_text) && !/performance and risk/.test(r.d.ats_text), 'which=base ignores the tailored copy');
  // guards
  db.job.details = {}; r = await call('POST', { jobs: 'tailor' }, { id: JID }); assert.strictEqual(r.s, 400, 'no advert text');
  db.job.details = { description: 'x' }; db.profile = {}; r = await call('POST', { jobs: 'tailor' }, { id: JID }); assert.strictEqual(r.s, 400, 'empty profile'); db.profile = P;
  jobmail.ask = async function () { throw Object.assign(new Error('Gemini error 429'), { status: 429 }); }; r = await call('POST', { jobs: 'tailor' }, { id: JID }); assert.strictEqual(r.s, 429);
  jobmail.ask = async function () { return 'not json'; }; r = await call('POST', { jobs: 'tailor' }, { id: JID }); assert.strictEqual(r.s, 502);
  console.log('PASS cvtailor_node');
})().catch(function (e) { console.error('FAIL', e); process.exit(1); });
