// /api/saver — screensaver photos (resized in the browser, stored in the database).
// GET             -> { images: [{id,w,h,kb}] }
// GET ?id=<uuid>  -> the image itself (cached hard; token via header or ?t=)
// POST {data (base64), mime, w, h} -> adds a photo
// DELETE ?id=<uuid>
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  var q = req.query || {};
  var token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      if (q.id) {
        if (!UUID.test(q.id)) return send(res, 400, { error: 'bad id' });
        var img = await todos.rpc('saver_get', { p_token: token, p_id: q.id });
        res.statusCode = 200;
        res.setHeader('Content-Type', img.mime || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        return res.end(Buffer.from(img.data, 'base64'));
      }
      return send(res, 200, { images: (await todos.rpc('saver_list', { p_token: token })) || [] });
    }
    if (req.method === 'POST') {
      var b = readBody(req);
      if (typeof b.data !== 'string') return send(res, 400, { error: 'no image' });
      var data = b.data.replace(/^data:[^,]*,/, '');
      var row = await todos.rpc('saver_add', { p_token: token, p_data: data, p_mime: b.mime === 'image/png' ? 'image/png' : 'image/jpeg', p_w: parseInt(b.w, 10) || null, p_h: parseInt(b.h, 10) || null });
      return send(res, 201, { image: row });
    }
    if (req.method === 'DELETE') {
      if (!q.id || !UUID.test(q.id)) return send(res, 400, { error: 'bad id' });
      await todos.rpc('saver_delete', { p_token: token, p_id: q.id });
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === 'PGRST202' || e.code === '42P01') return send(res, 409, { error: 'run setup6.sql first' });
    if (e.code === '23514') return send(res, 400, { error: /limit/.test(e.message || '') ? 'photo limit reached (100)' : 'invalid image' });
    console.error('saver api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
