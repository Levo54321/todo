// GET /api/todos fingerprint ("has anything changed?") without network: node tests/todos_node.js
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var h = require('../api/todos.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }

// A fake database: todo_list returns `rows`, todo_add pushes a row, bad tokens are refused.
var rows = [{ id: 'a', title: 'Call dentist', done: false }, { id: 'b', title: 'Read book', done: false }];
var acts = [], projectsJson = null, logMode = 'ok'; // write log rows, the Work project list (JSON text), and how the fake log behaves: ok | fail | missing
function dbError(code) { var e2 = new Error('db ' + code); e2.code = code; return e2; }
function fakeRpc(name, args) {
  if (args.p_token !== 'goodtoken') { var e = new Error('no'); e.code = '28000'; throw e; }
  if (name === 'todo_list') return JSON.parse(JSON.stringify(rows)); // a fresh copy each time, like a real database answer
  if (name === 'todo_add') { var r = { id: 'n' + rows.length, title: args.p_title, done: false }; rows.push(r); return r; }
  if (name === 'cfg_get') return args.p_key === 'projects' ? projectsJson : null;
  if (name === 'todo_update') { // applies the patch the way the database would for simple fields
    var row = null, i, k;
    for (i = 0; i < rows.length; i++) if (rows[i].id === args.p_id) row = rows[i];
    if (!row) throw dbError('P0002');
    for (k in args.p_patch) if (args.p_patch.hasOwnProperty(k)) { if (k === 'focus') row.focus_date = args.p_patch.focus ? todayStr : null; else row[k] = args.p_patch[k]; }
    return JSON.parse(JSON.stringify(row));
  }
  if (name === 'todo_delete') { rows = rows.filter(function (x) { return x.id !== args.p_id; }); return null; }
  if (name === 'todo_activity_log') {
    if (logMode === 'missing') throw dbError('PGRST202');
    if (logMode === 'fail') throw dbError('XX000');
    acts.unshift({ id: 'act' + acts.length, at: new Date().toISOString(), source: args.p_source, action: args.p_action, todo_id: args.p_todo_id, title: args.p_title, before: args.p_before, after: args.p_after });
    return { ok: true };
  }
  if (name === 'todo_activity_list') {
    if (logMode === 'missing') throw dbError('PGRST202');
    return acts.filter(function (a) { return (!args.p_source || a.source === args.p_source) && (!args.p_todo_id || a.todo_id === args.p_todo_id); }).slice(0, args.p_limit || 20);
  }
  throw new Error('unexpected rpc ' + name);
}
var todayStr = h.todayISO();
function plusDays(n) { var d = new Date(todayStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

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

  // ================= Jarvis: GET ?jarvis=1, ?q=, ?id=, ?activity=1 and the x-source write log =================
  function u(n) { return '00000000-0000-4000-8000-0000000000' + (n < 10 ? '0' : '') + n; }
  function mk(n, over) {
    var t = { id: u(n), title: 'Task ' + n, list: 'personal', category: null, done: false, due_date: null, remind_time: null, prio: 0, quick: false, must: false, blocked: false, paused: false, low: false,
      focus_date: null, recur: null, recur_until: null, notes: null, items: [], is_session: false, pproject_id: null, pp_backlog: false, plan_date: null, plan_order: null, created_at: '2026-11-01T10:' + (n < 10 ? '0' : '') + n + ':00+00:00' };
    for (var k in over) if (over.hasOwnProperty(k)) t[k] = over[k];
    return t;
  }
  var LONG = 'Ask the surgery about the cleaning slot and whether the hygienist can do the same day. Bring the insurance card and the old x-ray letter.';
  rows = [
    mk(1, { title: 'Book dentist appointment', due_date: todayStr, remind_time: '15:00:00', notes: LONG, items: [{ t: 'Find number', d: true }, { t: 'Ring them', d: false }], recur: 'weekly', recur_until: plusDays(90), series_id: u(99) }),
    mk(2, { title: 'Water the plants', due_date: todayStr, remind_time: '08:30:00' }),
    mk(3, { title: 'Pay council tax', due_date: todayStr, created_at: '2026-10-01T10:00:00+00:00' }),
    mk(4, { title: 'Return library books', due_date: plusDays(-1) }),
    mk(5, { title: 'Buy birthday card', due_date: plusDays(3) }),
    mk(6, { title: 'Plan far future trip', due_date: plusDays(30) }),
    mk(7, { title: 'Sort the shed' }),
    mk(8, { title: 'Learn to juggle', low: true }),
    mk(9, { title: 'Call mum', focus_date: todayStr }),
    mk(10, { title: 'Review budget', list: 'work', category: 'Marketing', due_date: todayStr, prio: 1 }),
    mk(11, { title: 'Send invoice to client', list: 'work', category: 'Marketing', due_date: todayStr, prio: 3 }),
    mk(12, { title: 'Write quarterly report', list: 'work', category: 'Ops', due_date: todayStr, prio: 3 }),
    mk(13, { title: 'Waiting for sign-off', list: 'work', category: 'Ops', blocked: true, blocked_at: '2026-11-05T09:00:00+00:00', due_date: plusDays(-2) }),
    mk(14, { title: 'Chase supplier', list: 'work', category: 'Ops', paused: true, paused_on: 'Dave', paused_at: '2026-11-04T09:00:00+00:00', due_date: plusDays(-3) }),
    mk(15, { title: 'Old finished job', done: true, done_at: new Date().toISOString() }),
    mk(16, { title: 'Idea: new site', pproject_id: u(77), pp_backlog: true })
  ];
  projectsJson = JSON.stringify([{ name: 'Marketing', status: 'active', prio: 0 }, { name: 'Ops', status: 'active', prio: 2 }]);
  function titles(r) { return r.json.tasks.map(function (x) { return x.title; }); }
  function same2(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  var fpBefore = (await call('GET', {}, T)).json.v;
  var jl = await call('GET', { jarvis: '1' }, T);
  ok('jarvis list: 200 with tasks, a total, and no fingerprint or full todos', jl.status === 200 && Array.isArray(jl.json.tasks) && jl.json.total === jl.json.shown && !('v' in jl.json) && !('todos' in jl.json) && !('same' in jl.json), jl.body.slice(0, 160));
  var t1 = jl.json.tasks.filter(function (x) { return x.id === u(1); })[0];
  ok('compact task has exactly the agreed fields', same2(Object.keys(t1).sort(), ['blocked', 'category', 'done', 'due_date', 'focus', 'id', 'items', 'list', 'low', 'must', 'notes', 'notes_len', 'overdue', 'paused', 'prio', 'quick', 'recur', 'remind_time', 'title'].sort()), Object.keys(t1).join(','));
  ok('notes are a short snippet (<= 80 chars) and notes_len gives the full length', t1.notes.length <= 80 && /…$/.test(t1.notes) && t1.notes_len === LONG.length, t1.notes.length + '/' + t1.notes_len);
  ok('items summary: count and done count', same2(t1.items, { n: 2, done: 1 }), JSON.stringify(t1.items));
  ok('remind_time is HH:MM and recur is passed through', t1.remind_time === '15:00' && t1.recur === 'weekly');
  ok('finished tasks and Personal Project backlog tasks are left out by default', titles(jl).indexOf('Old finished job') < 0 && titles(jl).indexOf('Idea: new site') < 0);
  ok('include=done / include=backlog bring them back', titles(await call('GET', { jarvis: '1', include: 'done' }, T)).indexOf('Old finished job') >= 0 && titles(await call('GET', { jarvis: '1', include: 'backlog' }, T)).indexOf('Idea: new site') >= 0 && titles(await call('GET', { jarvis: '1', include: 'done,backlog' }, T)).length === jl.json.total + 2);

  var pers = await call('GET', { jarvis: '1', list: 'personal' }, T);
  ok('Personal order: focus, overdue, today (timed first by clock, then the rest), later by date, undated, non-urgent last',
    same2(titles(pers), ['Call mum', 'Return library books', 'Water the plants', 'Book dentist appointment', 'Pay council tax', 'Buy birthday card', 'Plan far future trip', 'Sort the shed', 'Learn to juggle']), titles(pers).join(' | '));
  var work = await call('GET', { jarvis: '1', list: 'work' }, T);
  ok('Work order: priority then project priority within today; blocked after, waiting after that (no project order yet)', same2(titles(work), ['Write quarterly report', 'Send invoice to client', 'Review budget', 'Waiting for sign-off', 'Chase supplier']), titles(work).join(' | '));
  projectsJson = JSON.stringify([{ name: 'Marketing', status: 'active', prio: 0, order: [u(10), u(11)] }, { name: 'Ops', status: 'active', prio: 2 }]);
  ok('a project\'s hand-made board order is kept inside the slots its tasks hold', same2(titles(await call('GET', { jarvis: '1', list: 'work' }, T)).slice(0, 3), ['Write quarterly report', 'Review budget', 'Send invoice to client']));
  projectsJson = JSON.stringify([{ name: 'Marketing', status: 'hold', prio: 3 }, { name: 'Ops', status: 'active', prio: 0 }]);
  ok('a project on hold sorts below the others at equal task priority', same2(titles(await call('GET', { jarvis: '1', list: 'work' }, T)).slice(0, 3), ['Write quarterly report', 'Send invoice to client', 'Review budget']));
  projectsJson = JSON.stringify([{ name: 'Marketing', status: 'active', prio: 0 }, { name: 'Ops', status: 'active', prio: 2 }]);
  var both = await call('GET', { jarvis: '1' }, T);
  ok('both lists: Personal before Work inside a section', both.json.tasks.map(function (x) { return x.id; }).indexOf(u(2)) < both.json.tasks.map(function (x) { return x.id; }).indexOf(u(12)));
  ok('overdue flag: past-due open tasks yes; blocked and paused Work tasks no', jl.json.tasks.filter(function (x) { return x.id === u(4); })[0].overdue === true && jl.json.tasks.filter(function (x) { return x.id === u(13) || x.id === u(14); }).every(function (x) { return x.overdue === false; }));
  ok('focus flag and low flag are reported', jl.json.tasks.filter(function (x) { return x.id === u(9); })[0].focus === true && jl.json.tasks.filter(function (x) { return x.id === u(8); })[0].low === true);

  ok('due=today', same2(titles(await call('GET', { jarvis: '1', due: 'today', list: 'personal' }, T)).sort(), ['Book dentist appointment', 'Pay council tax', 'Water the plants']));
  ok('due=overdue leaves out blocked and paused Work tasks', same2(titles(await call('GET', { jarvis: '1', due: 'overdue' }, T)), ['Return library books']));
  ok('due=week is today..6 days ahead (not overdue, not 30 days out)', (function (r) { var t = titles(r); return t.indexOf('Buy birthday card') >= 0 && t.indexOf('Plan far future trip') < 0 && t.indexOf('Return library books') < 0 && t.indexOf('Water the plants') >= 0; })(await call('GET', { jarvis: '1', due: 'week' }, T)));
  ok('due=none = undated tasks only', titles(await call('GET', { jarvis: '1', due: 'none', list: 'personal' }, T)).every(function (x) { return ['Call mum', 'Sort the shed', 'Learn to juggle'].indexOf(x) >= 0; }));
  ok('project filter is exact but ignores capitalisation', same2(titles(await call('GET', { jarvis: '1', project: 'marketing' }, T)).sort(), ['Review budget', 'Send invoice to client']));
  var lim = await call('GET', { jarvis: '1', limit: '2' }, T);
  ok('limit cuts the list; total still counts everything', lim.json.shown === 2 && lim.json.tasks.length === 2 && lim.json.total > 2);
  ok('limit is capped at 100 and junk limit falls back to 25', (await call('GET', { jarvis: '1', limit: '9999' }, T)).status === 200 && (await call('GET', { jarvis: '1', limit: 'abc' }, T)).json.shown <= 25);
  ok('bad list / due / id are refused with 400', (await call('GET', { jarvis: '1', list: 'shop' }, T)).status === 400 && (await call('GET', { jarvis: '1', due: 'soon' }, T)).status === 400 && (await call('GET', { jarvis: '1', id: 'nope' }, T)).status === 400);

  // find by words
  var f1 = await call('GET', { jarvis: '1', q: 'dentist' }, T);
  ok('q=dentist finds the dentist task first with a score', f1.status === 200 && f1.json.tasks[0].id === u(1) && f1.json.tasks[0].score === 1 && f1.json.q === 'dentist', f1.body.slice(0, 160));
  ok('q tolerates a mis-heard letter (dentst) and a plural/stem (plants -> plant)', (await call('GET', { jarvis: '1', q: 'dentst' }, T)).json.tasks[0].id === u(1) && (await call('GET', { jarvis: '1', q: 'water plant' }, T)).json.tasks[0].id === u(2));
  ok('q ignores filler words (the, my, please, task)', (await call('GET', { jarvis: '1', q: 'please the council tax task' }, T)).json.tasks[0].id === u(3));
  var f2 = await call('GET', { jarvis: '1', q: 'marketing invoice' }, T);
  ok('q: a title word plus a project word wins (0.8); a task matching only the project word scores 0.3 and is dropped', f2.json.tasks[0].id === u(11) && f2.json.tasks[0].score === 0.8 && !f2.json.tasks.some(function (x) { return x.id === u(10); }), titles(f2).join(' | '));
  var f3 = await call('GET', { jarvis: '1', q: 'marketing' }, T);
  ok('q: a project word alone (0.6) lists that project\'s tasks', f3.json.total === 2 && f3.json.tasks.every(function (x) { return x.category === 'Marketing' && x.score === 0.6; }));
  ok('q with nothing matching returns an empty list, not an error', (await call('GET', { jarvis: '1', q: 'xylophone' }, T)).json.tasks.length === 0);
  ok('q with no usable words is a 400', (await call('GET', { jarvis: '1', q: 'the my' }, T)).status === 400 && (await call('GET', { jarvis: '1', q: '' }, T)).status !== 500);
  ok('q honours the list filter and limit (total still counts every match)', (await call('GET', { jarvis: '1', q: 'budget', list: 'personal' }, T)).json.tasks.length === 0 && (function (r) { return r.json.shown === 1 && r.json.total === 2; })(await call('GET', { jarvis: '1', q: 'marketing', limit: '1' }, T)));
  ok('q does not return finished tasks unless asked', (await call('GET', { jarvis: '1', q: 'finished job' }, T)).json.tasks.length === 0 && (await call('GET', { jarvis: '1', q: 'finished job', include: 'done' }, T)).json.tasks[0].id === u(15));

  // one task in full
  var one = await call('GET', { jarvis: '1', id: u(1) }, T);
  ok('single task: whole notes, items list, items summary, recur details', one.status === 200 && one.json.task.notes === LONG && one.json.task.items.length === 2 && one.json.task.items[0].t === 'Find number' && one.json.task.items[0].d === true && same2(one.json.task.items_summary, { n: 2, done: 1 }) && one.json.task.recur === 'weekly' && one.json.task.recur_until === plusDays(90) && one.json.task.series_id === u(99) && !('notes_len' in one.json.task), one.body.slice(0, 200));
  ok('single task: unknown id 404', (await call('GET', { jarvis: '1', id: u(50) }, T)).status === 404);
  ok('single task can be a finished one still in the list', (await call('GET', { jarvis: '1', id: u(15) }, T)).json.task.done === true);

  // auth and the old behaviour must not move
  ok('jarvis read needs the token (header or ?t=)', (await call('GET', { jarvis: '1' }, {})).status === 401 && (await call('GET', { jarvis: '1' }, { 'x-todo-token': 'nope' })).status === 401 && (await call('GET', { jarvis: '1', t: 'goodtoken' }, {})).status === 200);
  var plainAfter = await call('GET', {}, T);
  ok('plain GET is unchanged by all that: same fingerprint, full list, no jarvis fields', plainAfter.json.v === (await call('GET', {}, T)).json.v && plainAfter.json.todos.length === rows.length && plainAfter.json.todos[0].notes !== undefined && !('tasks' in plainAfter.json));
  ok('plain GET fingerprint equals the one computed straight from the list (the jarvis branch changed nothing)', plainAfter.json.v === h.fingerprint(JSON.parse(JSON.stringify(rows))));
  ok('?v= still answers "same" after jarvis calls', (await call('GET', { v: plainAfter.json.v }, T)).json.same === true);
  ok('jarvis=1 is not answered "same" even with a matching ?v=', (await call('GET', { jarvis: '1', v: plainAfter.json.v }, T)).json.same === undefined);
  ok('jarvis=0 / empty is the plain GET', (await call('GET', { jarvis: '0' }, T)).json.todos.length === rows.length && (await call('GET', { jarvis: '' }, T)).json.todos.length === rows.length);

  // ---- write log ----
  acts.length = 0;
  var JT = { 'x-todo-token': 'goodtoken', 'x-source': 'jarvis' };
  var pa = await call('PATCH', { id: u(2) }, JT, { due_date: plusDays(1), prio: 2, notes: 'bring a jug' });
  ok('tagged PATCH works as normal and says logged:true', pa.status === 200 && pa.json.todo.due_date === plusDays(1) && pa.json.logged === true, pa.body.slice(0, 120));
  ok('the log has one update row: source, action, task id, title', acts.length === 1 && acts[0].source === 'jarvis' && acts[0].action === 'update' && acts[0].todo_id === u(2) && acts[0].title === 'Water the plants', JSON.stringify(acts[0]));
  ok('the log holds only the changed fields, before and after', same2(acts[0].before, { due_date: todayStr, prio: 0, notes: null }) && same2(acts[0].after, { due_date: plusDays(1), prio: 2, notes: 'bring a jug' }) , JSON.stringify([acts[0].before, acts[0].after]));
  var pn = await call('PATCH', { id: u(2) }, T, { prio: 1 });
  ok('an untagged PATCH is not logged and its reply has no logged key', pn.status === 200 && acts.length === 1 && !('logged' in pn.json));
  var bad1 = await call('PATCH', { id: u(2) }, { 'x-todo-token': 'goodtoken', 'x-source': 'bad source!' }, { prio: 3 });
  var bad2 = await call('PATCH', { id: u(2) }, { 'x-todo-token': 'goodtoken', 'x-source': 'abcdefghijklmnopqrstu' }, { prio: 3 });
  var bad3 = await call('PATCH', { id: u(2) }, { 'x-todo-token': 'goodtoken', 'x-source': '' }, { prio: 3 });
  ok('x-source with spaces, symbols, over 20 characters or empty is ignored (not logged, no logged key)', acts.length === 1 && [bad1, bad2, bad3].every(function (r) { return r.status === 200 && !('logged' in r.json); }));
  ok('x-source of 20 characters, digits, dashes and underscores is accepted', (await call('PATCH', { id: u(2) }, { 'x-todo-token': 'goodtoken', 'x-source': 'Jarvis-2_voice' + '0123456' .slice(0, 6) }, { prio: 0 })).json.logged === true && acts[0].source === 'Jarvis-2_voice012345');
  var da = await call('DELETE', { id: u(5) }, JT);
  ok('tagged DELETE is logged with the task as it was', da.status === 200 && da.json.ok === true && da.json.logged === true && acts[0].action === 'delete' && acts[0].title === 'Buy birthday card' && acts[0].before.title === 'Buy birthday card' && acts[0].before.due_date === plusDays(3) && acts[0].after === null && !rows.some(function (x) { return x.id === u(5); }));
  var dn = await call('DELETE', { id: u(6) }, T);
  ok('untagged DELETE: same reply as before, nothing logged', dn.status === 200 && same2(Object.keys(dn.json).sort(), ['cal', 'ok']) && acts[0].action === 'delete' && acts[0].todo_id === u(5));
  var addJ = await call('POST', {}, JT, { text: 'Order flowers for mum' });
  ok('tagged add is logged as "add" with the new task in after', addJ.status === 201 && addJ.json.logged === true && acts[0].action === 'add' && acts[0].before === null && acts[0].after.title === 'Order flowers for mum');
  var addS = await call('POST', {}, T, { text: 'Buy stamps' });
  ok('Shortcut quick add (no header) is unchanged: 201, no logged key, nothing logged', addS.status === 201 && !('logged' in addS.json) && acts[0].after.title === 'Order flowers for mum');
  ok('tagged and untagged adds both answer needs_project the same way', addJ.json.needs_project === false && addS.json.needs_project === false);

  logMode = 'fail';
  var pf = await call('PATCH', { id: u(2) }, JT, { prio: 3 });
  ok('a failing log never fails the change (200, logged:false, task updated)', pf.status === 200 && pf.json.logged === false && pf.json.todo.prio === 3);
  logMode = 'missing';
  var pm = await call('PATCH', { id: u(2) }, JT, { prio: 1 });
  ok('database not updated (setup25 missing): the change still works, logged:false', pm.status === 200 && pm.json.logged === false);
  var am = await call('GET', { activity: '1' }, T);
  ok('activity list says unavailable (not an error) when setup25 is missing', am.status === 200 && am.json.unavailable === true && am.json.activity.length === 0);
  logMode = 'ok';

  var la = await call('GET', { activity: '1' }, T);
  ok('activity list: newest first, rows have before and after', la.status === 200 && la.json.activity.length === acts.length && la.json.activity[0].action === 'add' && 'before' in la.json.activity[0] && 'after' in la.json.activity[0]);
  ok('activity filters: source, task id, limit', (await call('GET', { activity: '1', source: 'nobody' }, T)).json.activity.length === 0 && (await call('GET', { activity: '1', id: u(2) }, T)).json.activity.every(function (a) { return a.todo_id === u(2); }) && (await call('GET', { activity: '1', limit: '1' }, T)).json.activity.length === 1);
  ok('activity: bad source/id 400, token needed', (await call('GET', { activity: '1', source: 'bad source!' }, T)).status === 400 && (await call('GET', { activity: '1', id: 'zzz' }, T)).status === 400 && (await call('GET', { activity: '1' }, {})).status === 401 && (await call('GET', { activity: '1' }, { 'x-todo-token': 'nope' })).status === 401);

  // helper unit checks: the diff sees side effects (as when the database clears "must" after a date move) and ignores untracked fields
  var J = require('../api/_jarvis.js');
  var dd = J.diff({ due_date: todayStr, must: true, cal_etag: 'a', title: 'x' }, { due_date: plusDays(2), must: false, cal_etag: 'b', title: 'x' });
  ok('diff: reports cascaded changes, skips untracked fields and unchanged ones', same2(dd.before, { due_date: todayStr, must: true }) && same2(dd.after, { due_date: plusDays(2), must: false }));
  ok('snapshot leaves out empty values (null, false, 0, empty text or list)', same2(J.snapshot({ title: 'T', notes: '', items: [], done: false, prio: 0, due_date: '2026-01-01' }), { title: 'T', due_date: '2026-01-01' }));
  ok('sourceOf: only a clean tag counts', J.sourceOf({ headers: { 'x-source': ' jarvis ' } }) === 'jarvis' && J.sourceOf({ headers: { 'x-source': 'a b' } }) === null && J.sourceOf({ headers: {} }) === null && J.sourceOf({ headers: { 'x-source': ['a', 'b'] } }) === null);

  global.fetch = origFetch;
  console.log(fails ? 'TODOS NODE TESTS: ' + fails + ' failed' : 'TODOS NODE TESTS: all passed'); process.exit(fails ? 1 : 0);
})();
