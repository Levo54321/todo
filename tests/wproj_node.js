// /api/projects on the work_projects table (db/setup33.sql), without network: node tests/wproj_node.js
// The fake database below copies what the wproj_* SQL functions do (list shape, status rules, rename moving tasks),
// so this checks the API's mapping: which RPC it calls with what, and that every reply keeps the old shape.
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var h = require('../api/projects.js'), fails = 0, calls = [];
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }
function dbError(code, m) { var e = new Error(m || 'db ' + code); e.code = code; return e; }

// rows as the table holds them; tasks = Work tasks by category
var rows, tasks, events;
function reset() {
  rows = [
    { id: 'aaaaaaaaaaa1', name: 'Firstwork', prio: 1, status: 'active', pos: 1, task_order: ['8fb8da5d-f79c-4b8a-b98e-a5cb22b306d4'], left_open: null, done_at: null },
    { id: 'aaaaaaaaaaa2', name: 'Admin', prio: 0, status: 'active', pos: 2, task_order: [], left_open: null, done_at: null },
    { id: 'aaaaaaaaaaa3', name: 'Ai-Studio', prio: 0, status: 'done', pos: 3, task_order: [], left_open: 0, done_at: '2026-10-29T14:16:11.882Z' },
    { id: 'aaaaaaaaaaa4', name: 'Paused one', prio: 2, status: 'hold', pos: 4, task_order: [], left_open: null, done_at: null }
  ];
  tasks = [{ id: 't1', category: 'Admin', done: false }, { id: 't2', category: 'Admin', done: true }, { id: 't3', category: 'Firstwork', done: false }];
  events = []; calls = [];
}
function json() { // wproj_json: old config-key shape, keys left out when not set, list order
  return rows.slice().sort(function (a, b) { return a.pos - b.pos; }).map(function (r) {
    var o = { id: r.id, name: r.name };
    if (r.prio) o.prio = r.prio;
    if (r.task_order.length) o.order = r.task_order.slice();
    if (r.status !== 'active') o.status = r.status;
    if (r.done_at) o.done_at = r.done_at;
    if (r.left_open != null) o.left_open = r.left_open;
    return o;
  });
}
function byId(id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
function clash(name, id) { return rows.some(function (r) { return r.id !== id && r.name.toLowerCase() === name.toLowerCase(); }); }
function fakeRpc(name, a) {
  calls.push({ name: name, args: a });
  if (a.p_token !== 'goodtoken') throw dbError('28000');
  var r, n = 0, p = a.p_patch;
  if (name === 'cfg_get' || name === 'cfg_set') throw new Error('the config key must not be read or written by the API any more');
  if (name === 'wproj_list') return json();
  if (name === 'wproj_save') {
    if (p.new) {
      if (clash(p.name, null)) throw dbError('23505');
      rows.push({ id: a.p_id, name: p.name, prio: 0, status: 'active', pos: 99, task_order: [], left_open: null, done_at: null });
      events.push({ id: a.p_id, kind: 'created' });
      return { projects: json(), tasks: 0 };
    }
    r = byId(a.p_id); if (!r) throw dbError('P0002');
    if (p.order) r.task_order = p.order;
    if (p.prio !== undefined && p.prio !== r.prio) { r.prio = p.prio; events.push({ id: r.id, kind: 'prio' }); }
    if (p.status !== undefined && p.status !== r.status) {
      if (p.status === 'done') { r.done_at = new Date().toISOString(); r.left_open = p.left_open === undefined ? null : p.left_open; }
      else { r.done_at = null; r.left_open = null; }
      r.status = p.status; events.push({ id: r.id, kind: 'status' });
    }
    if (p.name !== undefined && p.name !== r.name) {
      if (clash(p.name, r.id)) throw dbError('23505');
      tasks.forEach(function (t) { if (t.category === r.name) { t.category = p.name; n++; } });
      r.name = p.name; events.push({ id: r.id, kind: 'renamed' });
    }
    return { projects: json(), tasks: n };
  }
  if (name === 'wproj_delete') {
    r = byId(a.p_id); if (!r) throw dbError('P0002');
    rows = rows.filter(function (x) { return x !== r; });
    tasks.forEach(function (t) { if (t.category === r.name) { t.category = null; n++; } });
    return { projects: json(), tasks: n };
  }
  if (name === 'todo_update') { tasks.push({ id: a.p_id, category: a.p_patch.category, done: false }); return { id: a.p_id }; }
  throw new Error('unexpected rpc ' + name);
}
function call(method, query, body, headers) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, end: function (b) { resolve({ status: this.statusCode, json: b ? JSON.parse(b) : null }); } };
    h({ method: method, query: query || {}, headers: headers || { 'x-todo-token': 'goodtoken' }, body: body }, res);
  });
}
function last(name) { for (var i = calls.length - 1; i >= 0; i--) if (calls[i].name === name) return calls[i].args; return null; }
var U = '11111111-2222-4333-8444-555555555555';

(async function () {
  global.fetch = async function (url, opt) {
    var name = String(url).split('/rpc/')[1], out, status = 200;
    try { out = fakeRpc(name, JSON.parse(opt.body)); } catch (e) { status = e.code === '28000' ? 401 : 500; out = { message: e.message, code: e.code }; }
    return { ok: status === 200, status: status, text: async function () { return JSON.stringify(out); } };
  };

  reset();
  var g = await call('GET');
  ok('GET: list in the old shape and order', g.status === 200 && JSON.stringify(g.json) === JSON.stringify({ projects: [
    { id: 'aaaaaaaaaaa1', name: 'Firstwork', prio: 1, order: ['8fb8da5d-f79c-4b8a-b98e-a5cb22b306d4'] },
    { id: 'aaaaaaaaaaa2', name: 'Admin' },
    { id: 'aaaaaaaaaaa3', name: 'Ai-Studio', status: 'done', done_at: '2026-10-29T14:16:11.882Z', left_open: 0 },
    { id: 'aaaaaaaaaaa4', name: 'Paused one', prio: 2, status: 'hold' }] }), JSON.stringify(g.json));
  ok('GET: reads the table, never the config key', calls.length === 1 && calls[0].name === 'wproj_list');
  ok('no token -> 401', (await call('GET', {}, null, {})).status === 401);
  ok('bad token -> 401', (await call('GET', {}, null, { 'x-todo-token': 'nope' })).status === 401);

  reset();
  var c = await call('POST', {}, { name: '  #New   thing ' });
  var sv = last('wproj_save');
  ok('POST {name}: creates with a fresh 12-hex id and the cleaned name', c.status === 201 && /^[0-9a-f]{12}$/.test(sv.p_id) && sv.p_patch.new === true && sv.p_patch.name === 'New thing', JSON.stringify(sv));
  ok('POST {name}: reply {projects} includes it', c.json.projects.length === 5 && c.json.projects[4].name === 'New thing' && !('tasks' in c.json));
  ok('POST duplicate (any case) -> 409', (await call('POST', {}, { name: 'admin' })).status === 409);
  var dd = await call('POST', {}, { name: 'ai-studio' });
  ok('POST name of a completed project -> 409 with the reopen hint', dd.status === 409 && /completed projects/.test(dd.json.error));
  ok('POST empty name -> 400', (await call('POST', {}, { name: '  ' })).status === 400);

  reset(); // Shortcut assign
  var as = await call('POST', {}, { name: 'ADMIN', assign: U });
  ok('assign to an existing project: uses its exact name, no new project', as.status === 201 && as.json.project === 'Admin' && rows.length === 4 && last('todo_update').p_patch.category === 'Admin');
  as = await call('POST', {}, { name: 'ai-studio', assign: U });
  ok('assign to a completed project reopens it', as.json.project === 'Ai-Studio' && byId('aaaaaaaaaaa3').status === 'active' && !as.json.projects[2].status && !as.json.projects[2].done_at, JSON.stringify(as.json.projects[2]));
  as = await call('POST', {}, { name: 'Brand new', assign: U });
  ok('assign to a new name creates it and files the task', as.status === 201 && as.json.project === 'Brand new' && rows.length === 5 && last('todo_update').p_patch.category === 'Brand new');
  ok('assign with a bad task id -> 400', (await call('POST', {}, { name: 'Admin', assign: 'x' })).status === 400);

  reset(); // limits: 30 live, 120 total
  var k; for (k = 0; k < 27; k++) rows.push({ id: 'b' + ('0000000000' + k).slice(-11), name: 'L' + k, prio: 0, status: 'active', pos: 10 + k, task_order: [], left_open: null, done_at: null });
  ok('limit: 30 live projects (done ones do not count)', (await call('POST', {}, { name: 'One more' })).status === 400 && rows.length === 31);
  ok('limit: the Shortcut cannot pass it either', (await call('POST', {}, { name: 'One more', assign: U })).status === 400);
  ok('limit: reopening a done one past 30 -> 400', (await call('PATCH', { id: 'aaaaaaaaaaa3' }, { status: 'active' })).status === 400);
  reset(); for (k = 0; k < 116; k++) rows.push({ id: 'c' + ('0000000000' + k).slice(-11), name: 'D' + k, prio: 0, status: 'done', pos: 10 + k, task_order: [], left_open: 0, done_at: '2026-01-01T00:00:00.000Z' });
  ok('limit: 120 in total', (await call('POST', {}, { name: 'One more' })).status === 400);

  reset(); // board order
  var o = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { order: [U, 'not-a-uuid', U] });
  ok('PATCH {order}: only valid, unique task ids are saved', o.status === 200 && JSON.stringify(last('wproj_save').p_patch) === JSON.stringify({ order: [U] }) && o.json.projects[1].order[0] === U && !('tasks' in o.json));
  o = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { order: [] });
  ok('PATCH {order:[]} clears it (no order key in the reply)', !('order' in o.json.projects[1]));

  reset(); // prio and status
  var pp = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { prio: 3 });
  ok('PATCH {prio} -> {projects} with the new priority', pp.status === 200 && pp.json.projects[1].prio === 3 && !('tasks' in pp.json));
  pp = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { prio: 0 });
  ok('PATCH {prio:0} leaves the prio key out', !('prio' in pp.json.projects[1]));
  ok('PATCH {prio:7} -> 400', (await call('PATCH', { id: 'aaaaaaaaaaa2' }, { prio: 7 })).status === 400);
  pp = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { status: 'done', left_open: 2 });
  ok('PATCH {status:done, left_open}: done_at set, left_open kept', pp.json.projects[1].status === 'done' && /Z$/.test(pp.json.projects[1].done_at) && pp.json.projects[1].left_open === 2, JSON.stringify(pp.json.projects[1]));
  pp = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { status: 'active' });
  ok('PATCH {status:active} reopens (no status/done_at/left_open keys)', JSON.stringify(pp.json.projects[1]) === '{"id":"aaaaaaaaaaa2","name":"Admin"}');
  pp = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { status: 'hold' });
  ok('PATCH {status:hold} pauses', pp.json.projects[1].status === 'hold');
  ok('PATCH bad status -> 400', (await call('PATCH', { id: 'aaaaaaaaaaa2' }, { status: 'gone' })).status === 400);
  ok('PATCH unknown id -> 404', (await call('PATCH', { id: 'ffffffffffff' }, { prio: 1 })).status === 404);
  ok('PATCH with nothing to change -> 400', (await call('PATCH', { id: 'aaaaaaaaaaa2' }, {})).status === 400);

  reset(); // rename moves open and finished tasks
  var rn = await call('PATCH', { id: 'aaaaaaaaaaa2' }, { name: 'Admin & ops' });
  ok('rename: reply {projects, tasks} counts moved tasks', rn.status === 200 && rn.json.tasks === 2 && rn.json.projects[1].name === 'Admin & ops', JSON.stringify(rn.json));
  ok('rename: open and finished Work tasks carry the new name', tasks[0].category === 'Admin & ops' && tasks[1].category === 'Admin & ops' && tasks[2].category === 'Firstwork');
  ok('rename to another project\'s name (any case) -> 409', (await call('PATCH', { id: 'aaaaaaaaaaa2' }, { name: 'FIRSTWORK' })).status === 409);
  rn = await call('PATCH', { id: 'aaaaaaaaaaa1' }, { name: 'Firstwork', prio: 2 });
  ok('rename to the same name with prio: prio saved, tasks 0', rn.json.tasks === 0 && rn.json.projects[0].prio === 2);
  ok('events logged for rename and prio', events.map(function (e) { return e.kind; }).join() === 'renamed,prio');

  reset(); // delete
  var dl = await call('DELETE', { id: 'aaaaaaaaaaa2' });
  ok('DELETE: removed, its tasks lose the project, {projects, tasks}', dl.status === 200 && dl.json.tasks === 2 && dl.json.projects.length === 3 && tasks[0].category === null);
  ok('DELETE unknown -> 404', (await call('DELETE', { id: 'ffffffffffff' })).status === 404);
  ok('PUT -> 405', (await call('PUT')).status === 405);

  console.log(fails ? 'WPROJ NODE TESTS: ' + fails + ' failed' : 'WPROJ NODE TESTS: all passed');
  process.exit(fails ? 1 : 0);
})();
