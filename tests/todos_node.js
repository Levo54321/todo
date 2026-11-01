// GET /api/todos fingerprint ("has anything changed?") without network: node tests/todos_node.js
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var h = require('../api/todos.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }

// A fake database: todo_list returns `rows`, todo_add pushes a row, bad tokens are refused.
var rows = [{ id: 'a', title: 'Call dentist', done: false }, { id: 'b', title: 'Read book', done: false }];
function fakeRpc(name, args) {
  if (args.p_token !== 'goodtoken') { var e = new Error('no'); e.code = '28000'; throw e; }
  if (name === 'todo_list') return JSON.parse(JSON.stringify(rows)); // a fresh copy each time, like a real database answer
  if (name === 'todo_add') { var r = { id: 'n' + rows.length, title: args.p_title, done: false }; rows.push(r); return r; }
  if (name === 'cfg_get') return null;
  throw new Error('unexpected rpc ' + name);
}

function call(method, query, headers, body) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, end: function (b) { resolve({ status: this.statusCode, headers: this.headers, body: b, json: b ? JSON.parse(b) : null }); } };
    h({ method: method, query: query || {}, headers: headers || {}, body: body }, res);
  });
}
var T = { 'x-todo-token': 'goodtoken' };

(async function () {
  // The handler calls its own rpc(), which uses fetch to reach Supabase: answer that fetch from the fake database.
  var origFetch = global.fetch;
  global.fetch = async function (url, opt) {
    var name = String(url).split('/rpc/')[1], args = JSON.parse(opt.body), out, status = 200;
    try { out = fakeRpc(name, args); } catch (e) { status = e.code === '28000' ? 401 : 500; out = { message: e.message, code: e.code }; }
    return { ok: status === 200, status: status, text: async function () { return JSON.stringify(out); } };
  };

  var first = await call('GET', {}, T);
  ok('first load: full list with a fingerprint', first.status === 200 && first.json.todos.length === 2 && typeof first.json.v === 'string' && first.json.v.length >= 16 && !first.json.same, first.body.slice(0, 120));
  ok('full reply keeps today and now', /^\d{4}-\d{2}-\d{2}$/.test(first.json.today) && !isNaN(Date.parse(first.json.now)));
  var v = first.json.v;

  var same = await call('GET', { v: v }, T);
  ok('unchanged list + matching ?v= -> { same:true, today, now } and no todos', same.status === 200 && same.json.same === true && !('todos' in same.json) && !!same.json.today && !isNaN(Date.parse(same.json.now)), same.body);
  ok('same reply is tiny (under 300 bytes) next to the full list', same.body.length < 300 && first.body.length > same.body.length, same.body.length + ' vs ' + first.body.length);
  ok('fingerprint does not depend on `now` (two full replies seconds apart carry the same v)', (await call('GET', {}, T)).json.v === v);

  rows.push({ id: 'c', title: 'New one', done: false });
  var after = await call('GET', { v: v }, T);
  ok('list changed + old ?v= -> full list again with a new fingerprint', after.status === 200 && !after.json.same && after.json.todos.length === 3 && after.json.v !== v, after.body.slice(0, 120));
  ok('the new fingerprint then matches', (await call('GET', { v: after.json.v }, T)).json.same === true);

  rows[0].title = 'Call the dentist';
  ok('an edited title changes the fingerprint', (await call('GET', { v: after.json.v }, T)).json.same !== true);
  rows[0].title = 'Call dentist'; rows.pop();

  var noV = await call('GET', {}, T);
  ok('no ?v= (old cached app, Shortcuts) -> the full list', noV.json.todos.length === 2 && !noV.json.same);
  ok('empty or junk ?v= -> the full list', (await call('GET', { v: '' }, T)).json.todos.length === 2 && (await call('GET', { v: 'nonsense' }, T)).json.todos.length === 2 && (await call('GET', { v: ['x', v] }, T)).json.todos.length === 2);
  ok('?t= still works with ?v=', (await call('GET', { t: 'goodtoken', v: v }, {})).json.same === true);

  ok('bad token is refused (also with a matching ?v=)', (await call('GET', { v: v }, { 'x-todo-token': 'nope' })).status === 401);
  ok('missing token is refused', (await call('GET', { v: v }, {})).status === 401);

  // The iPhone Shortcut: POST { text } adds a task exactly as before
  var add = await call('POST', {}, T, { text: 'Buy milk' });
  ok('Shortcut POST {text} still adds a task (201, todo returned)', add.status === 201 && add.json.todo && add.json.todo.title === 'Buy milk' && add.json.needs_project === false, add.body.slice(0, 120));
  ok('Shortcut POST with a plain-text body still works', (await call('POST', {}, T, 'Walk the dog fri')).status === 201);
  ok('adding changes the fingerprint (a stale app gets the full list next)', (await call('GET', { v: v }, T)).json.same !== true);

  global.fetch = origFetch;
  console.log(fails ? 'TODOS NODE TESTS: ' + fails + ' failed' : 'TODOS NODE TESTS: all passed'); process.exit(fails ? 1 : 0);
})();
