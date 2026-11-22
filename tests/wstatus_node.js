// Work status updates (v36) without a network: node tests/wstatus_node.js
// Part 1 = the todo-status parser (api/_wstatus.js). Part 2 = the routes in api/projects.js against a fake database.
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var ws = require('../api/_wstatus.js'), h = require('../api/projects.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }
var PROJ = [{ id: 'aaaaaaaaaaa1', name: 'Alpha' }, { id: 'aaaaaaaaaaa2', name: 'Beta Study', status: 'hold' }];
function blk(o) { return '```todo-status\n' + (typeof o === 'string' ? o : JSON.stringify(o)) + '\n```'; }
function upd(extra) { var o = { id: 'aaaaaaaaaaa1', name: 'Alpha', rag: 'amber', headline: 'On track but slipping', done: ['Sent invites'], next: ['Launch'], blockers: [], risks: ['Recruiter capacity'], decisions: [], asks: [{ who: 'Sam', what: 'Approve budget' }], sources: { slack: [{ n: 'Thread', u: 'https://x.slack.com/archives/C1/p1' }], linear: [{ n: 'ENG-1', u: 'https://linear.app/x/issue/ENG-1' }] } }; for (var k in extra) o[k] = extra[k]; return o; }
function doc(updates, v) { return { v: v === undefined ? 1 : v, exported: '2026-11-22', updates: updates }; }

// ---- parser
var r = ws.parse('Here is the update!\n\n## Alpha\nWords.\n\n' + blk(doc([upd()])) + '\n\nLet me know.', PROJ);
ok('good block with text around it', r.ok && r.entries.length === 1 && r.skipped.length === 0 && r.entries[0].by === 'id' && r.entries[0].update.rag === 'a' && r.entries[0].update.headline === 'On track but slipping', JSON.stringify(r));
ok('sections and sources are kept', r.ok && r.entries[0].update.done[0] === 'Sent invites' && r.entries[0].update.asks[0].who === 'Sam' && r.entries[0].update.sources.linear[0].u.indexOf('https://') === 0);
r = ws.parse(blk('{"v":1,"updates":[{"id":'), PROJ);
ok('broken JSON gives a plain error and no entries', !r.ok && /not valid JSON/.test(r.error) && !r.entries);
r = ws.parse('no block here at all', PROJ);
ok('no block', !r.ok && /No todo-status block/.test(r.error));
r = ws.parse('', PROJ);
ok('empty paste', !r.ok);
r = ws.parse(blk(doc([upd()], 2)), PROJ);
ok('version mismatch refuses the whole paste', !r.ok && /version 2/.test(r.error) && /reads version 1/.test(r.error));
r = ws.parse(blk({ updates: [upd()] }), PROJ);
ok('missing version refuses', !r.ok && /missing/.test(r.error));
r = ws.parse(blk(doc([upd({ id: 'ffffffffffff', name: 'Nope' }), upd({ id: 'bbbbbbbbbbbb', name: undefined })])), PROJ);
ok('unknown ids and names are listed as skipped', r.ok && r.entries.length === 0 && r.skipped.length === 2 && /no project/.test(r.skipped[0].why), JSON.stringify(r.skipped));
r = ws.parse(blk(doc([upd({ id: 'ffffffffffff', name: 'beta study' })])), PROJ);
ok('name fallback (exact name, any capitalisation) when the id is unknown', r.ok && r.entries.length === 1 && r.entries[0].by === 'name' && r.entries[0].project.id === 'aaaaaaaaaaa2');
r = ws.parse(blk(doc([upd({ id: undefined, name: 'Beta' })])), PROJ);
ok('a partial name does not match', r.ok && r.entries.length === 0 && r.skipped.length === 1);
r = ws.parse(blk(doc([upd(), upd({ headline: 'second' })])), PROJ);
ok('a second update for the same project is skipped', r.ok && r.entries.length === 1 && r.skipped.length === 1 && /second update/.test(r.skipped[0].why));
r = ws.parse(blk(doc([upd({ headline: '  ' })])), PROJ);
ok('no headline is skipped', r.ok && r.entries.length === 0 && /no headline/.test(r.skipped[0].why));
r = ws.parse(blk(doc([upd({ rag: 'purple', sources: { slack: [{ n: 'bad', u: 'http://x.com' }, { n: 'ok', u: 'https://x.com/a' }] }, done: 'one string' })])), PROJ);
ok('bad RAG is not suggested, non-https link dropped, a string becomes a list', r.ok && !r.entries[0].update.rag && r.entries[0].update.sources.slack.length === 1 && r.entries[0].update.done[0] === 'one string' && r.warnings.length === 2, JSON.stringify(r.warnings));
r = ws.parse(blk(doc([upd(), upd({ id: 'aaaaaaaaaaa2', name: 'Beta Study' })])), PROJ, { only: 'aaaaaaaaaaa2' });
ok('single-project paste skips entries for other projects', r.ok && r.entries.length === 1 && r.entries[0].project.id === 'aaaaaaaaaaa2' && /not this project/.test(r.skipped[0].why));
r = ws.parse('```\n' + JSON.stringify(doc([upd()])) + '\n```', PROJ);
ok('an untagged fence with updates in it still reads (iPhone paste lost the label)', r.ok && r.entries.length === 1);
r = ws.parse('“' + JSON.stringify(doc([upd()])).slice(0, 0) + JSON.stringify(doc([upd()])), PROJ);
ok('bare JSON still reads', r.ok && r.entries.length === 1);
r = ws.parse(blk(doc([upd({ done: new Array(30).join('x,').split(',').map(function () { return 'item'; }) })])), PROJ);
ok('lists are capped at 12', r.ok && r.entries[0].update.done.length === 12);

// the example in docs/work-status-format.md must read with the real parser
var docText = require('fs').readFileSync(__dirname + '/../docs/work-status-format.md', 'utf8');
var ex = ws.parse(docText, [{ id: '4969add1822d', name: 'Panel Refresh Study' }, { id: 'b7c1e0a9d2f4', name: 'Onboarding Survey' }]);
ok('the full example in docs/work-status-format.md parses and matches both projects', ex.ok && ex.entries.length === 2 && ex.skipped.length === 0 && ex.entries[0].update.rag === 'a' && ex.entries[1].update.rag === 'g', JSON.stringify(ex).slice(0, 200));

// export: stable hash, changes with content, not with the date
var rows = { today: '2026-11-22', people: [{ id: 'cccccccccccc', name: 'Sam Lee' }], projects: [
  { id: 'aaaaaaaaaaa1', name: 'Alpha', status: 'active', meta: { rag: 'a', owner: 'cccccccccccc', links: { slack: [{ n: 'Req', u: 'https://s.slack.com/1', init: true }], other: [{ n: 'Linear', u: 'https://linear.app/p' }] } }, last: { at: '2026-11-20', headline: 'Fine' } },
  { id: 'aaaaaaaaaaa2', name: 'Beta Study', status: 'hold', meta: {} }] };
var e1 = ws.buildExport(rows), e2 = ws.buildExport(Object.assign({}, rows, { today: '2026-11-23' }));
ok('export lists open projects with owner, links, init, last update', e1.count === 2 && /"owner":"Sam Lee"/.test(e1.text) && /"init":true/.test(e1.text) && /"headline":"Fine"/.test(e1.text) && /```todo-projects/.test(e1.text));
ok('export hash ignores the date', e1.hash === e2.hash && e1.text !== e2.text);
rows.projects[0].meta.rag = 'g';
ok('export hash changes when a project changes', ws.buildExport(rows).hash !== e1.hash);
var rt = ws.parse('x\n```todo-projects\n{"v":1}\n```', PROJ);
ok('the export block is not mistaken for an update', !rt.ok);

// ---- routes
var calls = [], lastHash = null, projects = PROJ.map(function (p) { return { id: p.id, name: p.name, status: p.status }; });
function rpc(name, a) {
  calls.push({ name: name, args: a });
  if (a.p_token !== 'goodtoken') { var e = new Error('bad'); e.code = '28000'; throw e; }
  if (name === 'wproj_list') return projects;
  if (name === 'wproj_cards') return { cards: { aaaaaaaaaaa1: { rag: 'g' } }, people: [] };
  if (name === 'wupd_add') return { saved: a.p_items.length, projects: a.p_items.map(function (i) { return i.project_id; }) };
  if (name === 'wupd_list') { if (a.p_id !== 'aaaaaaaaaaa1') { var n = new Error('nf'); n.code = 'P0002'; throw n; } return [{ id: 1, headline: 'x' }]; }
  if (name === 'wupd_export') return Object.assign({ last_hash: lastHash }, rows);
  if (name === 'wupd_copied') { lastHash = a.p_hash; return { ok: true }; }
  throw new Error('unexpected rpc ' + name);
}
global.fetch = async function (url, opt) {
  var name = String(url).split('/rpc/')[1], out, status = 200;
  try { out = rpc(name, JSON.parse(opt.body)); } catch (e) { status = e.code === '28000' ? 401 : e.code === 'P0002' ? 404 : 500; out = { message: e.message, code: e.code }; }
  return { ok: status === 200, status: status, text: async function () { return JSON.stringify(out); } };
};
function call(method, query, body, tok) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, end: function (b) { resolve({ status: this.statusCode, json: b ? JSON.parse(b) : null }); } };
    h({ method: method, query: query || {}, headers: { 'x-todo-token': tok || 'goodtoken' }, body: body }, res);
  });
}
function lastCall(n) { for (var i = calls.length - 1; i >= 0; i--) if (calls[i].name === n) return calls[i].args; return null; }
(async function () {
  var a = await call('POST', { statusparse: '1' }, { text: blk(doc([upd()])) });
  ok('route statusparse: entries carry the project\'s current RAG, nothing saved', a.status === 200 && a.json.ok && a.json.entries[0].project.rag === 'g' && !lastCall('wupd_add'));
  a = await call('POST', { statusparse: '1' }, { text: 'junk' });
  ok('route statusparse: a bad paste is 200 with ok:false', a.status === 200 && a.json.ok === false);
  a = await call('POST', { statusparse: '1' }, { text: 'x' }, 'wrong');
  ok('route statusparse: bad token is 401', a.status === 401);
  a = await call('GET', { statusparse: '1' });
  ok('route statusparse: GET refused', a.status === 405);
  a = await call('POST', { updates: '1' }, { items: [{ id: 'aaaaaaaaaaa1', accept_rag: true, update: { headline: 'H', rag: 'amber', done: ['a'], junk: 'x' } }, { id: 'aaaaaaaaaaa2', update: { headline: 'H2' } }] });
  var it = lastCall('wupd_add').p_items;
  ok('route updates: saves cleaned items, accept only where asked', a.status === 201 && a.json.saved === 2 && it[0].accept_rag === true && it[1].accept_rag === false && it[0].origin === 'claude' && it[0].update.rag === 'a' && it[0].update.junk === undefined, JSON.stringify(it));
  a = await call('POST', { updates: '1' }, { items: [{ id: 'aaaaaaaaaaa1', update: { headline: '' } }] });
  ok('route updates: an update without a headline refuses the whole save', a.status === 400);
  a = await call('POST', { updates: '1' }, { id: 'aaaaaaaaaaa1', manual: { headline: 'By hand', notes: 'Some notes\nmore' } });
  it = lastCall('wupd_add').p_items;
  ok('route updates: manual update is origin manual and never accepts RAG', a.status === 201 && it[0].origin === 'manual' && it[0].accept_rag === false && it[0].update.notes === 'Some notes\nmore');
  a = await call('POST', { updates: '1' }, { id: 'aaaaaaaaaaa1', manual: { headline: ' ' } });
  ok('route updates: manual needs a headline', a.status === 400);
  a = await call('GET', { updates: 'aaaaaaaaaaa1' });
  ok('route updates: list', a.status === 200 && a.json.updates.length === 1);
  a = await call('GET', { updates: 'aaaaaaaaaaa2' });
  ok('route updates: unknown project 404', a.status === 404);
  a = await call('GET', { updates: 'nope' });
  ok('route updates: bad id 404', a.status === 404);
  a = await call('GET', { export: '1' });
  ok('route export: changed on first copy, never copied', a.status === 200 && a.json.changed === true && a.json.ever === false && a.json.count === 2);
  var hash = a.json.hash;
  a = await call('POST', { export: '1' }, { hash: 'zz' });
  ok('route export: bad hash refused', a.status === 400);
  a = await call('POST', { export: '1' }, { hash: hash });
  ok('route export: copied recorded', a.status === 200 && lastHash === hash);
  a = await call('GET', { export: '1' });
  ok('route export: not changed after copy', a.json.changed === false && a.json.ever === true);
  rows.projects[1].meta = { rag: 'r' };
  a = await call('GET', { export: '1' });
  ok('route export: changed again after an edit', a.json.changed === true);
  a = await call('GET', {});
  ok('plain GET still lists projects', a.status === 200 && a.json.projects);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
