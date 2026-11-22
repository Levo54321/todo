// /api/projects — your active Work projects.
//   GET                 -> { projects: [{id, name}] }
//   POST {name}         -> add
//   POST {name, assign:<task id>} -> use or create the project, then put that task in it (Shortcut)
//   PATCH ?id {order:[task ids]} -> save the order of that project's tasks (the Projects board)
//   PATCH ?id {name}    -> rename (open and finished Work tasks carrying the old name follow)
//   PATCH ?id {prio:0-3} and/or {status:'active'|'hold'|'done'} -> priority (orders the board) / status.
//        'done' archives the project (off the board and pickers, kept for audit, reopen with status:'active');
//        {left_open:n} may ride along to record how many open tasks it was closed with.
//   DELETE ?id          -> remove (Work tasks carrying it lose the project)
// A task's project is simply its category on the Work list, so everything that already shows or groups by
// category (filters, insights) works for projects too. Names are unique, ignoring capitalisation.
// Storage (v33): table work_projects via RPCs wproj_list / wproj_save / wproj_delete (db/setup33.sql). Created, renamed,
// prio and status changes are logged in work_project_events. The old 'projects' config key is kept in step by the database
// for one release (fallback only; nothing reads it).
var crypto = require('crypto');
var todos = require('./todos.js');
var MAX = 40, MAXN = 30, MAXALL = 120, STATUS = ['active', 'hold', 'done'];
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
// The list lives in table work_projects (db/setup33.sql) and comes back in the old config-key shape:
// [{id, name, prio?, order?, status?, done_at?, left_open?}] in list order (keys left out when not set).
async function read(token) { var l = await todos.rpc('wproj_list', { p_token: token }); return Array.isArray(l) ? l : []; }
function save(token, id, patch) { return todos.rpc('wproj_save', { p_token: token, p_id: id, p_patch: patch }); } // -> {projects, tasks}
function newId() { return crypto.randomBytes(6).toString('hex'); }
function clean(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim().slice(0, MAX) : ''; }
function live(list) { return list.filter(function (p) { return p.status !== 'done'; }).length; }
function dupe(list, name, exceptId) {
  var low = name.toLowerCase();
  return list.some(function (p) { return p.id !== exceptId && p.name.toLowerCase() === low; });
}

module.exports = async function handler(req, res) {
  var q = req.query || {};
  var token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    var list = await read(token), name, i;
    if (req.method === 'GET') return send(res, 200, { projects: list });
    if (req.method === 'POST') {
      var pb = readBody(req), assign = typeof pb.assign === 'string' ? pb.assign : '';
      name = clean(pb.name);
      if (!name) return send(res, 400, { error: 'Give the project a name' });
      if (assign) { // Shortcut flow: use the project if it exists (any capitalisation), else create it, then put the task in it
        if (!UUID.test(assign)) return send(res, 400, { error: 'bad task id' });
        var low = name.toLowerCase(), found = null;
        list.forEach(function (p) { if (p.name.toLowerCase() === low) found = p; });
        if (found && found.status === 'done') list = (await save(token, found.id, { status: 'active' })).projects;
        if (!found) {
          if (live(list) >= MAXN || list.length >= MAXALL) return send(res, 400, { error: 'That is the most projects (' + MAXN + '), remove one first' });
          found = { name: name };
          list = (await save(token, newId(), { new: true, name: name })).projects;
        }
        await todos.rpc('todo_update', { p_token: token, p_id: assign, p_patch: { category: found.name } });
        return send(res, 201, { project: found.name, projects: list });
      }
      if (live(list) >= MAXN || list.length >= MAXALL) return send(res, 400, { error: 'That is the most projects (' + MAXN + '), complete or remove one first' });
      if (dupe(list, name, null)) {
        var ex = list.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
        return send(res, 409, { error: ex && ex.status === 'done' ? name + ' is in your completed projects. Reopen it from there.' : 'You already have a project called ' + name });
      }
      list = (await save(token, newId(), { new: true, name: name })).projects;
      return send(res, 201, { projects: list });
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      var at = -1;
      for (i = 0; i < list.length; i++) if (list[i].id === q.id) at = i;
      if (at < 0) return send(res, 404, { error: 'not found' });
      var r;
      if (req.method === 'PATCH') {
        var ob = readBody(req);
        if (Array.isArray(ob.order)) { // the board: the order of this project's tasks
          var ord = [];
          ob.order.forEach(function (x) { if (typeof x === 'string' && UUID.test(x) && ord.indexOf(x) < 0 && ord.length < 200) ord.push(x); });
          return send(res, 200, { projects: (await save(token, q.id, { order: ord })).projects });
        }
        var p = list[at], patch = {};
        if (ob.prio !== undefined) { // priority: 0 none, 1 low, 2 medium, 3 high
          var pr = Math.round(Number(ob.prio));
          if (!(pr >= 0 && pr <= 3)) return send(res, 400, { error: 'bad priority' });
          patch.prio = pr;
        }
        if (ob.status !== undefined) {
          if (STATUS.indexOf(ob.status) < 0) return send(res, 400, { error: 'bad status' });
          if (ob.status === 'active' && p.status === 'done' && live(list) >= MAXN) return send(res, 400, { error: 'That is the most active projects (' + MAXN + '), complete one first' });
          patch.status = ob.status;
          if (ob.status === 'done') { var lo = Math.round(Number(ob.left_open)); if (lo >= 0 && lo < 1000) patch.left_open = lo; }
        }
        if (ob.name === undefined && (patch.prio !== undefined || patch.status !== undefined)) return send(res, 200, { projects: (await save(token, q.id, patch)).projects });
        name = clean(ob.name);
        if (!name) return send(res, 400, { error: 'Give the project a name' });
        if (dupe(list, name, q.id)) return send(res, 409, { error: 'You already have a project called ' + name });
        patch.name = name; // a rename also moves open and finished Work tasks to the new name (in the same database call)
        r = await save(token, q.id, patch);
      } else {
        r = await todos.rpc('wproj_delete', { p_token: token, p_id: q.id });
      }
      return send(res, 200, { projects: r.projects, tasks: r.tasks || 0 });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === '23505') return send(res, 409, { error: 'You already have a project with that name' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23514') return send(res, 400, { error: 'bad value' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run the projects migration first (db/setup33.sql)' });
    console.error('projects api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
