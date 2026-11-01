// /api/pprojects — Personal Projects (your apps, home projects ...). Separate from Work projects (/api/projects).
//   GET                      -> { projects: [{id, name, status, created_at, open, done, done_old}] }   all-time task counts;
//                               done_old = finished more than 7 days ago (not in GET /api/todos)
//   POST {name, status?}     -> create                                                        -> { project }
//   PATCH ?id {name?, status?} -> rename and/or change status                                   -> { project }
//   DELETE ?id               -> remove (its tasks stay, they just lose the link)
// status: 'active' | 'paused' | 'not_pursued' | 'shut_down'. Tasks in a project that is not active stay out of
// Overdue and the counts (handled in the app). Link a task with PATCH /api/todos?id {pproject_id}.
// Names are unique ignoring capitalisation (max 60 characters). Needs db/setup14.sql.
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var STATUS = ['active', 'paused', 'not_pursued', 'shut_down'];

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
function cleanName(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : ''; }

module.exports = async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      return send(res, 200, { projects: (await todos.rpc('pproj_list', { p_token: token })) || [] });
    }
    var b = readBody(req);
    if (b.status !== undefined && STATUS.indexOf(b.status) < 0) return send(res, 400, { error: 'bad status' });
    if (req.method === 'POST') {
      var name = cleanName(b.name);
      if (!name) return send(res, 400, { error: 'name required' });
      var made = await todos.rpc('pproj_save', { p_token: token, p_id: null, p_name: name, p_status: b.status || 'active' });
      return send(res, 201, { project: made });
    }
    var id = q.id;
    if (typeof id !== 'string' || !UUID.test(id)) return send(res, 400, { error: 'bad id' });
    if (req.method === 'PATCH') {
      var nn = b.name !== undefined ? cleanName(b.name) : null;
      if (b.name !== undefined && !nn) return send(res, 400, { error: 'name required' });
      var row = await todos.rpc('pproj_save', { p_token: token, p_id: id, p_name: nn, p_status: b.status || null });
      return send(res, 200, { project: row });
    }
    if (req.method === 'DELETE') {
      await todos.rpc('pproj_delete', { p_token: token, p_id: id });
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23505') return send(res, 409, { error: 'a project with that name already exists' });
    if (e.code === '23514') return send(res, 400, { error: 'invalid input' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup14.sql first' });
    console.error('pprojects api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
