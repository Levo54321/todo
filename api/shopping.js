// /api/shopping — LEGACY beta, unused. The Shopping tab is now an iframe of the separate holmlodge-shop project. Do not extend; safe to delete.
// GET        -> { data: { items, trip, log } | null }
// PUT {data} -> saves the whole list (validated and size-capped)
var todos = require('./todos.js');
var ISO = /^\d{4}-\d{2}-\d{2}$/;

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
function str(v, n) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : ''; }

// Keep only the fields we know about, with sane limits.
function clean(d) {
  var out = { items: [], trip: null, log: [] }, i, seen = {};
  if (!d || typeof d !== 'object') return out;
  var items = Array.isArray(d.items) ? d.items : [];
  for (i = 0; i < items.length && out.items.length < 300; i++) {
    var it = items[i] || {}, id = str(it.i, 16), t = str(it.t, 80);
    if (!id || !t || seen[id]) continue;
    seen[id] = true;
    out.items.push({ i: id, t: t, c: str(it.c, 24) || 'Other', w: it.w ? 1 : 0 });
  }
  if (d.trip && typeof d.trip === 'object') {
    var g = [], gs = Array.isArray(d.trip.g) ? d.trip.g : [];
    for (i = 0; i < gs.length && g.length < 300; i++) if (typeof gs[i] === 'string' && seen[gs[i]]) g.push(gs[i]);
    out.trip = { s: str(d.trip.s, 32), g: g };
  }
  var log = Array.isArray(d.log) ? d.log : [];
  for (i = 0; i < log.length && out.log.length < 30; i++) {
    var l = log[i] || {}, m = [], ms = Array.isArray(l.m) ? l.m : [], k;
    if (!ISO.test(l.d || '')) continue;
    for (k = 0; k < ms.length && m.length < 20; k++) { var n = str(ms[k], 40); if (n) m.push(n); }
    out.log.push({ d: l.d, b: Math.max(0, parseInt(l.b, 10) || 0), t: Math.max(0, parseInt(l.t, 10) || 0), m: m });
  }
  return out;
}

module.exports = async function handler(req, res) {
  var token = req.headers['x-todo-token'] || (req.query || {}).t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      var raw = await todos.rpc('cfg_get', { p_token: token, p_key: 'shop' }), data = null;
      try { data = raw ? clean(JSON.parse(raw)) : null; } catch (e) { data = null; }
      return send(res, 200, { data: data });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      var b = readBody(req);
      if (!b.data || typeof b.data !== 'object') return send(res, 400, { error: 'nothing to save' });
      var s = JSON.stringify(clean(b.data));
      if (s.length > 50000) return send(res, 400, { error: 'list too large' });
      await todos.rpc('cfg_set', { p_token: token, p_key: 'shop', p_value: s });
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, PUT, POST');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup7.sql first' });
    if (e.code === '23514') return send(res, 409, { error: 'run setup7.sql first' });
    console.error('shopping api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
module.exports.clean = clean;
