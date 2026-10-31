// /api/pause?id=<task uuid> — pause or resume a Work task you are waiting on someone else for.
//   POST {paused:true, on:'who or what'}  -> pause (leaves Overdue and the counts; "on" is optional)
//   POST {paused:false}                   -> resume (the deadline moves out by the whole days it was paused)
// Returns { todo }. Paused time is also left out of "time to finish" in Insights (see todo_history).
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
function soon(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]); }

module.exports = async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method not allowed' }); }
  var id = q.id;
  if (typeof id !== 'string' || !UUID.test(id)) return send(res, 400, { error: 'bad id' });
  var b = readBody(req);
  if (typeof b.paused !== 'boolean') return send(res, 400, { error: 'paused must be true or false' });
  try {
    var before = b.paused ? null : await todos.rpc('todo_list', { p_token: token });
    var row = await todos.rpc('todo_pause', { p_token: token, p_id: id, p_paused: b.paused, p_on: typeof b.on === 'string' ? b.on.slice(0, 300) : null });
    if (!b.paused) {
      // Resuming moves the deadline, so keep Apple/Google calendars in step (best effort).
      var old = null, i;
      for (i = 0; before && i < before.length; i++) if (before[i].id === id) old = before[i];
      if (old && row && old.due_date !== row.due_date) {
        try { await soon(require('./cal.js').syncIfEnabled(token), 8000); } catch (e) { console.error('cal sync', e.message); }
        try { await soon(require('./gcal.js').syncTask(token, id, false), 6000); } catch (e) { console.error('gcal sync', e.message); }
      }
    }
    return send(res, 200, { todo: row });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23514') return send(res, 400, { error: 'only open Work tasks can be paused' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup12.sql first' });
    console.error('pause api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
