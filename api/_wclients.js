// Work clients (v35, db/setup35.sql): the list a Work project can be "for" (meta.client = client id; none = Internal),
// each with an optional icon. Used by api/projects.js; the leading _ means this is not a serverless function of its own.
// Routes (all inside /api/projects, contract in that file's header):
//   GET ?clients=1 -> {clients:[{id,name,n,icon_at?}]} (n = projects using it) · POST ?clients=1 {name} -> add (201)
//   PATCH ?clients=<id> {name} -> rename · DELETE ?clients=<id> -> {clients, reset} (projects using it go back to Internal)
//   GET ?clienticon=<id>[&v=<icon_at>]&t=<token> -> the image · POST ?clienticon=<id> {data,mime} -> store · DELETE -> remove
var todos = require('./todos.js');
var crypto = require('crypto');
var wp = require('./_wpmeta.js');
var ICON_MAX = 200000, MAXCLIENTS = 60;

function line(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function clientName(v) { return line(v, 40).replace(/^#+/, '').trim(); }
// What the bytes really are: PNG, JPEG, GIF or WebP. Never SVG (it can carry script) and never what the caller claims.
function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// h = {send, readBody}
async function handle(req, res, q, token, h) {
  var m = req.method, id, b, list, nm, r;
  if (q.clienticon !== undefined) {
    id = String(q.clienticon);
    if (!wp.PID.test(id)) return h.send(res, 404, { error: 'not found' });
    if (m === 'GET') {
      var ic = await todos.rpc('wclient_icon_get', { p_token: token, p_id: id });
      res.statusCode = 200;
      res.setHeader('Content-Type', ic.mime || 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); // the page adds &v=<icon_at>: a new icon gets a new address
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.end(Buffer.from(ic.data, 'base64'));
    }
    if (m === 'DELETE') return h.send(res, 200, { clients: await todos.rpc('wclient_icon_set', { p_token: token, p_id: id, p_mime: null, p_data: null }) });
    if (m !== 'POST') { res.setHeader('Allow', 'GET, POST, DELETE'); return h.send(res, 405, { error: 'method not allowed' }); }
    b = h.readBody(req);
    if (typeof b.data !== 'string' || !b.data) return h.send(res, 400, { error: 'send an image' });
    var buf = Buffer.from(b.data, 'base64');
    if (!buf.length || buf.length > ICON_MAX) return h.send(res, 400, { error: 'that image is too big' });
    var mime = sniff(buf); // by content, not by what was claimed
    if (!mime) return h.send(res, 400, { error: 'that is not a PNG, JPEG, GIF or WebP image' });
    return h.send(res, 200, { clients: await todos.rpc('wclient_icon_set', { p_token: token, p_id: id, p_mime: mime, p_data: buf.toString('base64') }) });
  }
  // the client list
  if (m === 'GET') return h.send(res, 200, { clients: await todos.rpc('wclient_list', { p_token: token }) });
  if (m === 'DELETE') {
    id = String(q.clients);
    if (!wp.PID.test(id)) return h.send(res, 404, { error: 'not found' });
    r = await todos.rpc('wclient_remove', { p_token: token, p_id: id });
    return h.send(res, 200, { clients: r.clients, reset: r.reset || 0 });
  }
  if (m === 'POST' || m === 'PATCH') {
    nm = clientName(h.readBody(req).name);
    if (!nm) return h.send(res, 400, { error: 'Give the client a name' });
    id = m === 'POST' ? crypto.randomBytes(6).toString('hex') : String(q.clients);
    if (m === 'PATCH' && !wp.PID.test(id)) return h.send(res, 404, { error: 'not found' });
    list = (await todos.rpc('wclient_list', { p_token: token })) || [];
    if (list.some(function (x) { return x.id !== id && x.name.toLowerCase() === nm.toLowerCase(); })) return h.send(res, 409, { error: nm + ' is already in the list' });
    if (m === 'PATCH' && !list.some(function (x) { return x.id === id; })) return h.send(res, 404, { error: 'not found' });
    if (m === 'POST' && list.length >= MAXCLIENTS) return h.send(res, 400, { error: 'That is the most clients (' + MAXCLIENTS + '), remove one first' });
    return h.send(res, m === 'POST' ? 201 : 200, { clients: await todos.rpc('wclient_save', { p_token: token, p_id: id, p_name: nm }) });
  }
  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return h.send(res, 405, { error: 'method not allowed' });
}
module.exports = { handle: handle, sniff: sniff, ICON_MAX: ICON_MAX };
