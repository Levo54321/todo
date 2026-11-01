// /api/vault — the per-project vault for sensitive values (environment variables, codes). POST only, so nothing
// sensitive ever travels in a URL (URLs can end up in logs). Body: { action, pass?, ... }. Auth: x-todo-token.
//   {action:'state', project_id, pass?}  -> { configured, set, locked, count, [entries:[{id,name}], pass] }
//        locked = no valid pass: only the number of entries comes back. With a valid pass: names (never values).
//   {action:'setup', password}           -> { pass }   first time only; password 10+ characters
//   {action:'unlock', password}          -> { pass }   403 wrong password; 429 {until} after 5 wrong tries (5 min)
//   {action:'get', id, pass}             -> { value, pass }   one value
//   {action:'save', id?, project_id, name, value, pass} -> { entry:{id,name}, pass }   add or replace
//   {action:'delete', id, pass}          -> { ok, pass }
//   {action:'reset', confirm:'DELETE ALL'} -> { ok, deleted }   forgotten password: wipes every entry and the password
// pass = a short-lived unlock pass (5 minutes, renewed by every call), sealed with a key only the server knows; the page
// keeps it in memory only and drops it after 5 idle minutes or when you leave the page. 401 {locked:true} = expired.
// Crypto: key = HKDF-SHA256(scrypt(password, salt, N=2^15, r=8, p=1), VAULT_PEPPER); entries are AES-256-GCM with a
// random 12-byte IV, bound (AAD) to their project and entry id. Needs env VAULT_PEPPER (32+ characters) and
// db/setup20.sql. Values, names, passwords and passes are never logged and never written to the activity log.
var crypto = require('crypto');
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var KDF = { N: 32768, r: 8, p: 1 }, KDF_TAG = 'scrypt:32768:8:1', PASS_MS = 5 * 60000, CHECK = 'luc-todo vault ok';

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  var b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) || {}; } catch (e) { return {}; }
}
function pepper() { var p = process.env.VAULT_PEPPER; return typeof p === 'string' && p.length >= 32 ? p : null; }

function deriveKey(password, saltB64, kdf) {
  var m = /^scrypt:(\d+):(\d+):(\d+)$/.exec(kdf || ''); if (!m) throw new Error('bad kdf');
  var raw = crypto.scryptSync(String(password).normalize('NFC'), Buffer.from(saltB64, 'base64'), 32, { N: +m[1], r: +m[2], p: +m[3], maxmem: 128 * 1024 * 1024 });
  return Buffer.from(crypto.hkdfSync('sha256', raw, Buffer.from(pepper(), 'utf8'), 'luc-todo vault v1', 32));
}
function seal(key, text, aad) {
  var iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  var ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1.' + iv.toString('base64') + '.' + ct.toString('base64') + '.' + c.getAuthTag().toString('base64');
}
function unseal(key, blob, aad) { // throws if the key is wrong or the blob was changed
  var p = String(blob || '').split('.');
  if (p.length !== 4 || p[0] !== 'v1') throw new Error('bad blob');
  var d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p[1], 'base64'));
  d.setAAD(Buffer.from(aad, 'utf8')); d.setAuthTag(Buffer.from(p[3], 'base64'));
  return Buffer.concat([d.update(Buffer.from(p[2], 'base64')), d.final()]).toString('utf8');
}
function passKey() { return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(pepper(), 'utf8'), Buffer.alloc(0), 'luc-todo vault pass v1', 32)); }
function makePass(key) { return seal(passKey(), JSON.stringify({ k: key.toString('base64'), e: Date.now() + PASS_MS }), 'pass'); }
function readPass(pass) { // -> key, or null when missing / expired / forged
  if (typeof pass !== 'string' || pass.length > 400) return null;
  try { var o = JSON.parse(unseal(passKey(), pass, 'pass')); return o && o.e > Date.now() ? Buffer.from(o.k, 'base64') : null; } catch (e) { return null; }
}
function okPassword(key, state) { try { return unseal(key, state.check, 'check') === CHECK; } catch (e) { return false; } }

module.exports = async function handler(req, res) {
  var token = req.headers['x-todo-token'];
  if (!token) return send(res, 401, { error: 'missing token' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'POST only' }); }
  var b = readBody(req), a = b.action;
  if (!pepper()) return send(res, 200, { configured: false });
  try {
    if (a === 'reset') {
      if (b.confirm !== 'DELETE ALL') return send(res, 400, { error: 'type DELETE ALL to confirm' });
      return send(res, 200, await todos.rpc('pvault_reset', { p_token: token }));
    }
    var st = await todos.rpc('pvault_state', { p_token: token });
    if (a === 'setup') {
      if (st.set) return send(res, 409, { error: 'the vault already has a password' });
      if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 200) return send(res, 400, { error: 'use at least 10 characters' });
      var salt = crypto.randomBytes(16).toString('base64'), k0 = deriveKey(b.password, salt, KDF_TAG);
      await todos.rpc('pvault_setup', { p_token: token, p_salt: salt, p_kdf: KDF_TAG, p_check: seal(k0, CHECK, 'check') });
      return send(res, 200, { pass: makePass(k0) });
    }
    if (a === 'unlock') {
      if (!st.set) return send(res, 409, { error: 'set a vault password first' });
      if (st.locked) return send(res, 429, { error: 'too many wrong tries, wait a few minutes', until: st.until });
      if (typeof b.password !== 'string' || !b.password || b.password.length > 200) return send(res, 400, { error: 'enter the vault password' });
      var k1 = deriveKey(b.password, st.salt, st.kdf), good = okPassword(k1, st);
      var at = await todos.rpc('pvault_attempt', { p_token: token, p_ok: good });
      if (!good) return send(res, at && at.until && Date.parse(at.until) > Date.now() ? 429 : 403, { error: at && at.until && Date.parse(at.until) > Date.now() ? 'too many wrong tries, wait a few minutes' : 'wrong password', until: at && at.until });
      return send(res, 200, { pass: makePass(k1) });
    }
    var key = st.set ? readPass(b.pass) : null;
    if (a === 'state') {
      if (typeof b.project_id !== 'string' || !UUID.test(b.project_id)) return send(res, 400, { error: 'bad project' });
      var rows = (await todos.rpc('pvault_list', { p_token: token, p_project: b.project_id })) || [];
      var out = { configured: true, set: !!st.set, locked: !key, count: rows.length };
      if (key) {
        out.entries = rows.map(function (r) { var n; try { n = unseal(key, r.name, 'name:' + b.project_id + ':' + r.id); } catch (e) { n = '(cannot read)'; } return { id: r.id, name: n }; });
        out.pass = makePass(key);
      }
      return send(res, 200, out);
    }
    if (!key) return send(res, 401, { locked: true, error: 'the vault is locked' });
    if (a === 'get') {
      if (typeof b.id !== 'string' || !UUID.test(b.id)) return send(res, 400, { error: 'bad id' });
      var e = await todos.rpc('pvault_value', { p_token: token, p_id: b.id });
      return send(res, 200, { value: unseal(key, e.value, 'value:' + e.project_id + ':' + e.id), pass: makePass(key) });
    }
    if (a === 'save') {
      var id = b.id ? String(b.id) : crypto.randomUUID();
      var name = typeof b.name === 'string' ? b.name.trim() : '', value = typeof b.value === 'string' ? b.value : '';
      if (!UUID.test(id) || typeof b.project_id !== 'string' || !UUID.test(b.project_id)) return send(res, 400, { error: 'bad id' });
      if (!name || name.length > 100) return send(res, 400, { error: 'give it a name (up to 100 characters)' });
      if (!value || value.length > 8000) return send(res, 400, { error: 'enter a value (up to 8000 characters)' });
      await todos.rpc('pvault_save', { p_token: token, p_id: id, p_project: b.project_id,
        p_name: seal(key, name, 'name:' + b.project_id + ':' + id), p_value: seal(key, value, 'value:' + b.project_id + ':' + id) });
      return send(res, 200, { entry: { id: id, name: name }, pass: makePass(key) });
    }
    if (a === 'delete') {
      if (typeof b.id !== 'string' || !UUID.test(b.id)) return send(res, 400, { error: 'bad id' });
      await todos.rpc('pvault_delete', { p_token: token, p_id: b.id });
      return send(res, 200, { ok: true, pass: makePass(key) });
    }
    return send(res, 400, { error: 'unknown action' });
  } catch (err) {
    if (err.code === '28000') return send(res, 401, { error: 'bad token' });
    if (err.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (err.code === '23514') return send(res, 400, { error: 'too many values in this project' });
    if (err.code === 'PGRST202') return send(res, 409, { error: 'run setup20.sql first' });
    console.error('vault api error', err.code || 'internal'); // never the message: it could echo input
    return send(res, 502, { error: 'something went wrong' });
  }
};
module.exports._t = { deriveKey: deriveKey, seal: seal, unseal: unseal, makePass: makePass, readPass: readPass }; // local tests
