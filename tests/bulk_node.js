// CSV import rules + POST /api/todos?bulk=1 without a network: node tests/bulk_node.js
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var h = require('../api/todos.js'), B = require('../api/_bulk.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }
var TODAY = '2026-11-07';
function v(o) { return B.validateRow(o, TODAY); }

// ---- row rules
ok('title only is valid, defaults personal/no date', v({ title: 'Buy milk' }).errors.length === 0 && v({ title: 'Buy milk' }).value.list === 'personal' && v({ title: 'x' }).value.due_date === null);
ok('blank title refused', v({ title: '  ' }).errors[0] === 'title is required');
ok('title over 500 refused', v({ title: new Array(502).join('a') }).errors.length === 1);
ok('list: Work (any case) ok, junk refused', v({ title: 'a', list: 'WORK' }).value.list === 'work' && v({ title: 'a', list: 'home' }).errors.length === 1);
ok('date ISO ok', v({ title: 'a', due_date: '2026-11-24' }).value.due_date === '2026-11-24');
ok('date UK DD/MM/YYYY converted', v({ title: 'a', due_date: '24/11/2026' }).value.due_date === '2026-11-24' && v({ title: 'a', due_date: '4/1/2027' }).value.due_date === '2027-01-04');
ok('impossible / US-style / short dates refused', ['2026-02-30', '31/04/2026', '11/24/2026', '24/11/26', 'tomorrow', '2026-1-5'].every(function (d) { return v({ title: 'a', due_date: d }).errors.length === 1; }));
ok('time HH:MM ok, 9:05 padded, junk refused', v({ title: 'a', remind_time: '09:30' }).value.remind_time === '09:30' && v({ title: 'a', remind_time: '9:05' }).value.remind_time === '09:05' && ['24:00', '9:60', '9am', '0930'].every(function (t) { return v({ title: 'a', remind_time: t }).errors.length === 1; }));
ok('reminder with no date starts today', v({ title: 'a', remind_time: '10:00' }).value.due_date === TODAY);
ok('repeat values ok (any case), junk refused, no date -> today', v({ title: 'a', repeat: 'Weekly' }).value.recur === 'weekly' && v({ title: 'a', repeat: 'weekly' }).value.due_date === TODAY && v({ title: 'a', repeat: 'hourly' }).errors.length === 1);
ok('priority 0-3 only', v({ title: 'a', priority: '3' }).value.prio === 3 && ['4', '-1', 'high', '1.5'].every(function (p) { return v({ title: 'a', priority: p }).errors.length === 1; }));
ok('yes/no flags', v({ title: 'a', quick: 'Yes' }).value.quick === true && v({ title: 'a', quick: 'n' }).value.quick === false && v({ title: 'a', quick: 'maybe' }).errors.length === 1 && v({ title: 'a', must_today: 'TRUE' }).value.must === true);
ok('must_today with no date -> today; later date refused; earlier ok', v({ title: 'a', must_today: 'yes' }).value.due_date === TODAY && v({ title: 'a', must_today: 'yes', due_date: '2026-11-20' }).errors.length === 1 && v({ title: 'a', must_today: 'yes', due_date: '2026-11-01' }).errors.length === 0);
ok('several faults all reported for one row', v({ title: '', due_date: 'x', priority: '9' }).errors.length === 3);
ok('notes over 2000 refused; unknown keys ignored', v({ title: 'a', notes: new Array(2002).join('n') }).errors.length === 1 && v({ title: 'a', bogus: 'x' }).errors.length === 0);

ok('subtasks split on | and line breaks, [x] marks done, bullets stripped', JSON.stringify(v({ title: 'a', subtasks: 'One|[x] Two\n- Three|  | ' }).value.subtasks) === JSON.stringify([{ t: 'One', d: false }, { t: 'Two', d: true }, { t: 'Three', d: false }]));
ok('subtask over 200 chars refused; over 100 refused', v({ title: 'a', subtasks: new Array(202).join('x') }).errors.length === 1 && v({ title: 'a', subtasks: new Array(102).join('s|') }).errors.length === 1);
// ---- endpoint
var rows = [], patches = [], fail = false, imports = [], failLog = false;
function fakeRpc(name, args) {
  if (args.p_token !== 'goodtoken') { var e = new Error('no'); e.code = '28000'; throw e; }
  if (name === 'todo_add') { if (fail && rows.length >= 2) throw new Error('db down'); var r = { id: 'n' + rows.length, title: args.p_title, args: args }; rows.push(r); return r; }
  if (name === 'todo_update') { patches.push(args); return {}; }
  if (name === 'todo_import_log') { if (failLog) throw new Error('log down'); var bt = imports.filter(function (x) { return x.id === args.p_batch; })[0]; if (bt) bt.ids = bt.ids.concat(args.p_ids); else imports.push({ id: args.p_batch, name: args.p_name, ids: args.p_ids.slice(), undone: false }); return { ok: true }; }
  if (name === 'todo_import_csv_set') { var cs = imports.filter(function (x) { return x.id === args.p_batch; })[0]; if (cs && !cs.csv) cs.csv = args.p_csv; return { ok: true }; }
  if (name === 'todo_import_csv_get') { var cg = imports.filter(function (x) { return x.id === args.p_id; })[0]; if (!cg) { var e3 = new Error('no such import'); e3.code = 'P0002'; throw e3; } return { name: cg.name, csv: cg.csv || null }; }
  if (name === 'todo_import_list') return imports.map(function (x) { return { id: x.id, name: x.name, n: x.ids.length, alive: x.ids.length, undone_at: x.undone ? 'x' : null }; });
  if (name === 'todo_import_undo') { var u = imports.filter(function (x) { return x.id === args.p_id; })[0]; if (!u) { var e1 = new Error('no such import'); e1.code = 'P0002'; throw e1; } if (u.undone) { var e2 = new Error('already undone'); e2.code = '23505'; throw e2; } u.undone = true; return { ok: true, removed: u.ids.length, added: u.ids.length }; }
  if (name === 'cfg_get') return JSON.stringify([{ name: 'Alpha' }]);
  if (name === 'proj_list' || name === 'project_list') return [{ name: 'Alpha' }];
  throw new Error('unexpected rpc ' + name);
}
function call(method, query, body) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, vv) { this.headers[k.toLowerCase()] = vv; }, end: function (b) { resolve({ status: this.statusCode, json: b ? JSON.parse(b) : null }); } };
    h({ method: method, query: query, headers: { 'x-todo-token': 'goodtoken' }, body: body }, res);
  });
}
(async function () {
  global.fetch = async function (url, opt) {
    var name = String(url).split('/rpc/')[1], args = JSON.parse(opt.body), out, status = 200;
    try { out = fakeRpc(name, args); } catch (e) { status = e.code === '28000' ? 401 : 500; out = { message: e.message, code: e.code }; }
    return { ok: status === 200, status: status, text: async function () { return JSON.stringify(out); } };
  };
  var good = [{ row: 2, title: 'One', list: 'personal', due_date: '24/11/2026', notes: 'hello', subtasks: 'A|B' }, { row: 3, title: 'Two', list: 'work', category: 'alpha', priority: '2', quick: 'yes' }, { row: 4, title: 'Three' }];
  var r = await call('POST', { bulk: '1' }, { rows: good, dry: true });
  ok('dry run: 200, nothing written', r.status === 200 && r.json.dry === true && r.json.count === 3 && rows.length === 0, JSON.stringify(r.json));
  ok('dry run returns a preview of how each row was understood', r.json.preview.length === 3 && r.json.preview[0].row === 2 && r.json.preview[0].value.due_date === '2026-11-24' && r.json.preview[1].value.prio === 2 && r.json.preview[1].value.quick === true && r.json.preview[1].value.list === 'work', JSON.stringify(r.json.preview[1]));
  r = await call('POST', { bulk: '1' }, { rows: good.concat([{ row: 5, title: '', due_date: 'zzz' }]) });
  ok('one bad row: 400 with its line number, NOTHING added, preview still shown', r.status === 400 && r.json.preview.length === 4 && r.json.preview[3].errors.length === 2 && r.json.errors.length === 1 && r.json.errors[0].row === 5 && r.json.errors[0].messages.length === 2 && rows.length === 0, JSON.stringify(r.json));
  var BATCH = '11111111-1111-4111-8111-111111111111';
  r = await call('POST', { bulk: '1' }, { rows: good, batch: BATCH, name: 'my file.csv', csv: 'title\r\nOne\r\n' });
  ok('real run: 201, three added', r.status === 201 && r.json.added === 3 && rows.length === 3, JSON.stringify(r.json));
  ok('real run logged under its batch with the 3 new ids', r.json.logged === true && imports.length === 1 && imports[0].name === 'my file.csv' && imports[0].ids.length === 3, JSON.stringify(imports));
  ok('UK date arrives as ISO; notes saved by update', rows[0].args.p_due === '2026-11-24' && patches.length === 1 && patches[0].p_patch.notes === 'hello' && patches[0].p_patch.items.length === 2 && patches[0].p_patch.items[1].t === 'B');
  ok('work category matched to the real project name; tags sent', rows[1].args.p_category === 'Alpha' && rows[1].args.p_list === 'work' && rows[1].args.p_prio === 2 && rows[1].args.p_quick === true);
  ok('plain row sends no tag arguments', !('p_prio' in rows[2].args));
  var l = await call('GET', { imports: '1' }, null);
  ok('history list', l.status === 200 && l.json.imports.length === 1 && l.json.imports[0].name === 'my file.csv', JSON.stringify(l.json));
  var g1 = await call('GET', { import_csv: BATCH }, null);
  ok('saved CSV copy comes back with its name', g1.status === 200 && g1.json.csv === 'title\r\nOne\r\n' && g1.json.name === 'my file.csv', JSON.stringify(g1.json));
  var g2 = await call('GET', { import_csv: '22222222-2222-4222-8222-222222222222' }, null);
  ok('copy of an unknown import: 404', g2.status === 404, g2.status);
  var g3 = await call('GET', { import_csv: 'nope' }, null);
  ok('bad id: 400', g3.status === 400);
  var u1 = await call('POST', { import_undo: BATCH }, { go: 1 });
  ok('undo: 200 with counts', u1.status === 200 && u1.json.ok === true && u1.json.removed === 3, JSON.stringify(u1.json));
  var u2 = await call('POST', { import_undo: BATCH }, { go: 1 });
  ok('second undo: 409', u2.status === 409);
  var u3 = await call('POST', { import_undo: '22222222-2222-4222-8222-222222222222' }, { go: 1 });
  ok('unknown import: 404', u3.status === 404);
  var u4 = await call('POST', { import_undo: 'nope' }, { go: 1 });
  ok('bad id: 400', u4.status === 400);
  failLog = true;
  var rl = await call('POST', { bulk: '1' }, { rows: [{ title: 'z' }], batch: '33333333-3333-4333-8333-333333333333' });
  ok('history log failing never fails the import (logged:false)', rl.status === 201 && rl.json.added === 1 && rl.json.logged === false, JSON.stringify(rl.json));
  failLog = false; rows.length = 0;
  r = await call('POST', { bulk: '1' }, { rows: [] });
  ok('no rows -> 400', r.status === 400);
  var many = []; for (var i = 0; i < 101; i++) many.push({ title: 't' + i });
  r = await call('POST', { bulk: '1' }, { rows: many });
  ok('101 rows -> 400', r.status === 400);
  r = await call('POST', {}, { text: 'buy stamps fri' });
  ok('quick add (Shortcut) unchanged', r.status === 201 && r.json.todo && /^buy stamps/i.test(r.json.todo.title), JSON.stringify(r.json));
  rows.length = 0; fail = true;
  r = await call('POST', { bulk: '1' }, { rows: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }] });
  ok('database failing part-way: 500 and says how many were added', r.status === 500 && r.json.added === 2, JSON.stringify(r.json));
  fail = false;
  rows.length = 0;
  var bad = await new Promise(function (resolve) { var res = { statusCode: 0, setHeader: function () {}, end: function () { resolve(this.statusCode); } }; h({ method: 'POST', query: { bulk: '1' }, headers: { 'x-todo-token': 'wrong' }, body: { rows: [{ title: 'a' }] } }, res); });
  ok('bad token: nothing added on a real import', (bad === 401 || bad === 500) && rows.length === 0, bad);
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
