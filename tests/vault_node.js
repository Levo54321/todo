// Node unit test for api/_vault.js with an in-memory database stand-in. Run: node tests/vault_node.js
var assert = require('assert'), path = require('path');
var tp = require.resolve(path.join(__dirname, '../api/todos.js'));
var db = { lock: null, entries: {}, proj: { 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': 1 } };
var rpcLog = [];
require.cache[tp] = { id: tp, filename: tp, loaded: true, exports: { rpc: async function (n, a) {
  rpcLog.push(JSON.stringify(a));
  if (n === 'pvault_state') { var l = db.lock; return l ? { set: true, salt: l.salt, kdf: l.kdf, check: l.check, fails: l.fails, locked: !!(l.until && l.until > Date.now()), until: l.until ? new Date(l.until).toISOString() : null } : { set: false }; }
  if (n === 'pvault_setup') { db.lock = { salt: a.p_salt, kdf: a.p_kdf, check: a.p_check, fails: 0, until: null }; return { ok: true }; }
  if (n === 'pvault_attempt') { if (a.p_ok) { db.lock.fails = 0; db.lock.until = null; } else { db.lock.fails++; if (db.lock.fails >= 5) db.lock.until = Date.now() + 300000; } return { fails: db.lock.fails, until: db.lock.until ? new Date(db.lock.until).toISOString() : null }; }
  if (n === 'pvault_list') return Object.keys(db.entries).filter(function (k) { return db.entries[k].project === a.p_project; }).map(function (k) { return { id: k, name: db.entries[k].name }; });
  if (n === 'pvault_value') { var e = db.entries[a.p_id]; if (!e) throw Object.assign(new Error('nf'), { code: 'P0002' }); return { id: a.p_id, project_id: e.project, name: e.name, value: e.value }; }
  if (n === 'pvault_save') { db.entries[a.p_id] = { project: a.p_project, name: a.p_name, value: a.p_value }; return { id: a.p_id }; }
  if (n === 'pvault_delete') { delete db.entries[a.p_id]; return { ok: true }; }
  if (n === 'pvault_reset') { var c = Object.keys(db.entries).length; db.entries = {}; db.lock = null; return { ok: true, deleted: c }; }
  throw new Error('unexpected ' + n);
} } };
var logs = []; console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
var h = require('../api/_vault.js');
function call(body, tok) { return new Promise(function (r) { var res = { statusCode: 0, setHeader: function () {}, end: function (s) { r({ s: res.statusCode, d: JSON.parse(s) }); } };
  h({ method: 'POST', headers: { 'x-todo-token': tok || 'tok' }, body: body }, res); }); }
var P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', Q = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SECRET = 'sk_live_SUPER-secret-value-123';
(async function () {
  delete process.env.VAULT_PEPPER;
  assert.deepStrictEqual((await call({ action: 'state', project_id: P })).d, { configured: false }, 'no pepper -> not configured');
  process.env.VAULT_PEPPER = require('crypto').randomBytes(32).toString('hex'); // throwaway test value, never printed
  var r = await call({ action: 'state', project_id: P });
  assert.strictEqual(r.d.set, false); assert.strictEqual(r.d.locked, true);
  assert.strictEqual((await call({ action: 'setup', password: 'short' })).s, 400, 'short password refused');
  r = await call({ action: 'setup', password: 'correct horse battery' }); assert.strictEqual(r.s, 200); var pass = r.d.pass; assert.ok(pass);
  assert.strictEqual((await call({ action: 'setup', password: 'another long one' })).s, 409, 'setup only once');
  r = await call({ action: 'save', project_id: P, name: 'STRIPE_KEY', value: SECRET, pass: pass }); assert.strictEqual(r.s, 200); var id = r.d.entry.id; pass = r.d.pass;
  var stored = JSON.stringify(db);
  assert.ok(stored.indexOf(SECRET) < 0 && stored.indexOf('STRIPE_KEY') < 0, 'database holds ciphertext only');
  r = await call({ action: 'state', project_id: P });
  assert.deepStrictEqual(Object.keys(r.d).sort(), ['configured', 'count', 'locked', 'set'], 'locked state shows only a count');
  assert.strictEqual(r.d.count, 1); assert.strictEqual(r.d.locked, true);
  assert.strictEqual((await call({ action: 'get', id: id })).s, 401, 'no pass -> locked');
  assert.strictEqual((await call({ action: 'get', id: id, pass: 'v1.AAAA.BBBB.CCCC' })).s, 401, 'forged pass -> locked');
  r = await call({ action: 'state', project_id: P, pass: pass });
  assert.deepStrictEqual(r.d.entries, [{ id: id, name: 'STRIPE_KEY' }]); assert.ok(JSON.stringify(r.d).indexOf(SECRET) < 0, 'list never has values');
  r = await call({ action: 'get', id: id, pass: pass }); assert.strictEqual(r.d.value, SECRET, 'reveal one value');
  // blob swapped to another project fails (bound to project + id)
  db.entries[id].project = Q; assert.strictEqual((await call({ action: 'get', id: id, pass: pass })).s, 502, 'moved blob does not decrypt'); db.entries[id].project = P;
  // expired pass
  var t = require('../api/_vault.js')._t, key = t.readPass(pass); assert.ok(key);
  var realNow = Date.now; Date.now = function () { return realNow() + 6 * 60000; };
  assert.strictEqual((await call({ action: 'get', id: id, pass: pass })).s, 401, 'pass expires after 5 minutes'); Date.now = realNow;
  // wrong passwords: 4x 403, 5th -> 429, then locked even with the right one
  for (var i = 0; i < 4; i++) assert.strictEqual((await call({ action: 'unlock', password: 'wrong guess ' + i })).s, 403);
  assert.strictEqual((await call({ action: 'unlock', password: 'wrong guess 5' })).s, 429, '5th wrong -> locked out');
  assert.strictEqual((await call({ action: 'unlock', password: 'correct horse battery' })).s, 429, 'lockout holds');
  db.lock.until = Date.now() - 1;
  r = await call({ action: 'unlock', password: 'correct horse battery' }); assert.strictEqual(r.s, 200, 'right password after lockout'); assert.strictEqual(db.lock.fails, 0);
  // a different pepper cannot open anything
  var good = process.env.VAULT_PEPPER; process.env.VAULT_PEPPER = require('crypto').randomBytes(32).toString('hex');
  assert.strictEqual((await call({ action: 'unlock', password: 'correct horse battery' })).s, 403, 'other pepper -> wrong'); process.env.VAULT_PEPPER = good; db.lock.fails = 0; db.lock.until = null;
  r = await call({ action: 'unlock', password: 'correct horse battery' }); pass = r.d.pass;
  r = await call({ action: 'delete', id: id, pass: pass }); assert.strictEqual(r.s, 200); assert.strictEqual(Object.keys(db.entries).length, 0);
  await call({ action: 'save', project_id: P, name: 'A', value: 'x', pass: r.d.pass });
  assert.strictEqual((await call({ action: 'reset', confirm: 'yes' })).s, 400, 'reset needs DELETE ALL');
  r = await call({ action: 'reset', confirm: 'DELETE ALL' }); assert.strictEqual(r.d.deleted, 1); assert.strictEqual(db.lock, null);
  var all = logs.join('\n');
  assert.ok(all.indexOf(SECRET) < 0 && all.indexOf('correct horse') < 0 && all.indexOf('STRIPE') < 0, 'nothing sensitive in logs');
  console.log('VAULT NODE TESTS: all passed (' + logs.length + ' log lines, none sensitive)');
})().catch(function (e) { console.log('VAULT NODE TESTS FAILED:', e.message); process.exit(1); });
