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
async function read(token) {
  var raw = await todos.rpc('cfg_get', { p_token: token, p_key: 'projects' });
  try { var l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
function write(token, list) { return todos.rpc('cfg_set', { p_token: token, p_key: 'projects', p_value: list.length ? JSON.stringify(list) : null }); }
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
        if (found && found.status === 'done') { delete found.status; delete found.done_at; delete found.left_open; await write(token, list); }
        if (!found) {
          if (live(list) >= MAXN || list.length >= MAXALL) return send(res, 400, { error: 'That is the most projects (' + MAXN + '), remove one first' });
          found = { id: crypto.randomBytes(6).toString('hex'), name: name };
          list.push(found);
          await write(token, list);
        }
        await todos.rpc('todo_update', { p_token: token, p_id: assign, p_patch: { category: found.name } });
        return send(res, 201, { project: found.name, projects: list });
      }
      if (live(list) >= MAXN || list.length >= MAXALL) return send(res, 400, { error: 'That is the most projects (' + MAXN + '), complete or remove one first' });
      if (dupe(list, name, null)) {
        var ex = list.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
        return send(res, 409, { error: ex && ex.status === 'done' ? name + ' is in your completed projects. Reopen it from there.' : 'You already have a project called ' + name });
      }
      list.push({ id: crypto.randomBytes(6).toString('hex'), name: name });
      await write(token, list);
      return send(res, 201, { projects: list });
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      var at = -1;
      for (i = 0; i < list.length; i++) if (list[i].id === q.id) at = i;
      if (at < 0) return send(res, 404, { error: 'not found' });
      var old = list[at].name, moved = 0;
      if (req.method === 'PATCH') {
        var ob = readBody(req);
        if (Array.isArray(ob.order)) { // the board: the order of this project's tasks
          var ord = [];
          ob.order.forEach(function (x) { if (typeof x === 'string' && UUID.test(x) && ord.indexOf(x) < 0 && ord.length < 200) ord.push(x); });
          if (ord.length) list[at].order = ord; else delete list[at].order;
          await write(token, list);
          return send(res, 200, { projects: list });
        }
        var p = list[at], touched = false;
        if (ob.prio !== undefined) { // priority: 0 none, 1 low, 2 medium, 3 high
          var pr = Math.round(Number(ob.prio));
          if (!(pr >= 0 && pr <= 3)) return send(res, 400, { error: 'bad priority' });
          if (pr) p.prio = pr; else delete p.prio;
          touched = true;
        }
        if (ob.status !== undefined) {
          if (STATUS.indexOf(ob.status) < 0) return send(res, 400, { error: 'bad status' });
          if (ob.status === 'active' && p.status === 'done' && live(list) >= MAXN) return send(res, 400, { error: 'That is the most active projects (' + MAXN + '), complete one first' });
          if (ob.status === 'active') { delete p.status; delete p.done_at; delete p.left_open; }
          else {
            if (ob.status === 'done' && p.status !== 'done') {
              p.done_at = new Date().toISOString();
              var lo = Math.round(Number(ob.left_open));
              if (lo >= 0 && lo < 1000) p.left_open = lo; else delete p.left_open;
            } else if (ob.status === 'hold') { delete p.done_at; delete p.left_open; }
            p.status = ob.status;
          }
          touched = true;
        }
        if (touched && ob.name === undefined) { await write(token, list); return send(res, 200, { projects: list }); }
        name = clean(ob.name);
        if (!name) return send(res, 400, { error: 'Give the project a name' });
        if (dupe(list, name, q.id)) return send(res, 409, { error: 'You already have a project called ' + name });
        p.name = name;
        await write(token, list);
        if (name !== old) moved = await todos.rpc('project_rename', { p_token: token, p_old: old, p_new: name });
      } else {
        list.splice(at, 1);
        await write(token, list);
        moved = await todos.rpc('project_clear', { p_token: token, p_name: old });
      }
      return send(res, 200, { projects: list, tasks: moved || 0 });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === '23514' || e.code === 'PGRST202') return send(res, 409, { error: 'run the projects migration first' });
    console.error('projects api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
