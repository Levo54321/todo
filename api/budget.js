// /api/budget — token-gated access to the budget config and entries.
// GET            -> { config, entries: [{d,k,a}] }
// POST {config}  -> saves the config object
// POST {entry:{d,k,a}} -> saves one balance / pay entry (one per date + kind)
// DELETE ?d=YYYY-MM-DD&k=kind -> removes an entry
var todos = require('./todos.js');
var ISO = /^\d{4}-\d{2}-\d{2}$/;
var KINDS = ['pay', 'open', 'current', 'rent', 'deposit'];

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

module.exports = async function handler(req, res) {
  var token = req.headers['x-todo-token'] || (req.query || {}).t;
  if (!token) return send(res, 401, { error: 'missing token' });
  var q = req.query || {};
  try {
    if (req.method === 'GET') {
      var raw = await todos.rpc('cfg_get', { p_token: token, p_key: 'budget' }), cfg = null;
      try { cfg = raw ? JSON.parse(raw) : null; } catch (e) { cfg = null; }
      var entries = await todos.rpc('budget_list', { p_token: token });
      return send(res, 200, { config: cfg, entries: entries || [] });
    }
    if (req.method === 'POST') {
      var b = readBody(req);
      if (b.config && typeof b.config === 'object') {
        var s = JSON.stringify(b.config);
        if (s.length > 30000) return send(res, 400, { error: 'config too large' });
        await todos.rpc('cfg_set', { p_token: token, p_key: 'budget', p_value: s });
        return send(res, 200, { ok: true });
      }
      if (b.entry) {
        var e = b.entry, amt = Number(e.a);
        if (!ISO.test(e.d || '') || KINDS.indexOf(e.k) < 0 || !isFinite(amt)) return send(res, 400, { error: 'bad entry' });
        await todos.rpc('budget_save', { p_token: token, p_date: e.d, p_kind: e.k, p_amount: amt });
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: 'nothing to save' });
    }
    if (req.method === 'DELETE') {
      if (!ISO.test(q.d || '') || KINDS.indexOf(q.k) < 0) return send(res, 400, { error: 'bad entry' });
      await todos.rpc('budget_delete', { p_token: token, p_date: q.d, p_kind: q.k });
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'PGRST202' || e.code === '42P01') return send(res, 409, { error: 'run setup6.sql first' });
    if (e.code === '23514' || e.code === '22007' || e.code === '22P02') return send(res, 400, { error: 'invalid input' });
    console.error('budget api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
