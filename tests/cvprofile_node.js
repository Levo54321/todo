// node tests/cvprofile_node.js : career profile cleaner, Gemini privacy filter and route ?jobs=profile (stubbed database)
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js')), store = { data: {}, at: 't0' };
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  if (a.p_token === 'bad') throw Object.assign(new Error('bad token'), { code: '28000' });
  if (n === 'career_get') return { data: store.data, updated_at: store.at };
  if (n === 'career_put') { store.data = a.p_data; store.at = 't1'; return { data: store.data, updated_at: store.at }; }
  throw new Error('unexpected ' + n);
} } };
var cv = require('../api/_cvprofile.js'), h = require('../api/_jobs.js');
function call(method, query, body, tok) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: method, query: query, headers: { 'x-todo-token': tok || 'tok' }, body: body }, res); }); }
var P = { name: { first: ' Test ', last: 'Person' }, title: 'PM', contact: { phone: '0700', email: 'a@b.c', address: 'London', linkedin: 'https://www.linkedin.com/in/x' }, profile: 'Hello',
  highlights: ['one', '', 'two'], experience: [{ type: 'role', title: 'Lead', company: 'Acme', start: 'May 2025', end: 'Present', bullets: ['did a', ' ', 'did b'] }, { type: 'milestone', date: 'May 2025', title: 'Promoted', company: 'Acme' }, { type: 'role' }, 'junk'],
  core_skills: ['SQL'], software: [{ name: 'Excel', level: 250 }, { name: 'Py' }, { level: 3 }], qualifications: [{ title: 'Q', org: 'O', years: '2020' }, { org: 'no title' }],
  domains: ['D'], references: [{ name: 'Ref Person', lines: ['Org', 'Role', '+44 7000 000000'] }], references_note: '*more', extra_main: [{ heading: 'X', text: 't' }], evil: 'dropped' };
(async function () {
  var c = cv.clean(P);
  assert.strictEqual(c.name.first, 'Test'); assert.strictEqual(c.contact.linkedin, 'linkedin.com/in/x'); assert.deepStrictEqual(c.highlights, ['one', 'two']);
  assert.strictEqual(c.experience.length, 2, 'empty role and junk dropped'); assert.deepStrictEqual(c.experience[0].bullets, ['did a', 'did b']);
  assert.deepStrictEqual(c.software.map(function (s) { return s.level; }), [100, 60], 'level capped, default 60, nameless dropped');
  assert.strictEqual(c.qualifications.length, 1); assert.ok(!('evil' in c)); assert.ok(c.extra_main && c.extra_main[0].heading === 'X', 'skill layout keys pass through');
  assert.throws(function () { cv.clean([]); }); assert.throws(function () { cv.clean(null); });
  assert.throws(function () { cv.clean({ extra_main: [{ t: new Array(120000).join('x') }] }); }, /too large/);
  var g = JSON.stringify(cv.forGemini(c));
  ['Test', 'Person', '0700', 'a@b.c', 'London', 'linkedin', 'Ref Person', '7000'].forEach(function (s) { assert.ok(g.indexOf(s) < 0, 'Gemini copy must not hold ' + s); });
  assert.ok(g.indexOf('did a') > 0 && g.indexOf('Acme') > 0 && g.indexOf('SQL') > 0, 'but it keeps roles, bullets and skills');
  var r = await call('GET', { jobs: 'profile' }, null, 'bad'); assert.strictEqual(r.s, 401);
  r = await call('GET', { jobs: 'profile' }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.d.profile, {});
  r = await call('POST', { jobs: 'profile' }, { profile: P }); assert.strictEqual(r.s, 200); assert.strictEqual(r.d.profile.title, 'PM'); assert.ok(!('evil' in store.data));
  r = await call('POST', { jobs: 'profile' }, { profile: 'nope' }); assert.strictEqual(r.s, 400);
  r = await call('DELETE', { jobs: 'profile' }); assert.strictEqual(r.s, 405);
  console.log('PASS cvprofile_node');
})().catch(function (e) { console.error('FAIL', e); process.exit(1); });
