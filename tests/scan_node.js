// Photo-of-notes scan, server side, no network: node tests/scan_node.js
// A fake Supabase and a fake Gemini answer fetch(); the REAL api/todos.js route and api/_scan.js run.
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var KEY = 'AQ.fake-gemini-key-for-tests';
process.env.GEMINI_API_KEY = KEY;
var h = require('../api/todos.js'), scan = require('../api/_scan.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }

var scans = [], geminiCalls = [], gemini = null;
var CSV = 'title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks\nGuidelines,work,Graphical Abstract,,,,,,,,\nPool health,work,GenMedia,,,,,,,,\n"Access, roles?",work,Human Signal,,,,,,,,';
function fakeRpc(name, args) {
  if (args.p_token !== 'goodtoken') { var e = new Error('no'); e.code = '28000'; throw e; }
  if (name === 'cfg_get') return args.p_key === 'projects' ? JSON.stringify([{ name: 'Google Health Request' }, { name: 'Human Signal' }]) : null;
  if (name === 'todo_scan_latest') { var r = scans.filter(function (s) { return s.status === 'ready'; }).pop(); return r ? { id: r.id, csv: r.csv, n: r.n, created_at: 'now' } : null; }
  if (name === 'todo_scan_save') { scans.forEach(function (s) { s.status = 'done'; }); var id = '11111111-1111-4111-8111-11111111111' + scans.length; scans.push({ id: id, csv: args.p_csv, n: args.p_n, status: 'ready' }); return { ok: true, id: id }; }
  if (name === 'todo_scan_done') { scans.forEach(function (s) { if (s.id === args.p_id) s.status = 'done'; }); return { ok: true }; }
  throw new Error('unexpected rpc ' + name);
}
function call(method, query, headers, body) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, end: function (b) { resolve({ status: this.statusCode, body: b, json: b ? JSON.parse(b) : null }); } };
    h({ method: method, query: query || {}, headers: headers || {}, body: body }, res);
  });
}
var T = { 'x-todo-token': 'goodtoken' };
function jpeg(n) { var b = Buffer.alloc(n || 400, 7); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xE0; return b; }
function reply(text, extra) { return { status: 200, body: { candidates: [{ content: { parts: (extra || []).concat([{ text: text }]) } }] } }; }

(async function () {
  var origErr = console.error; console.error = function () {}; // the route logs failures on purpose
  var origFetch = global.fetch;
  global.fetch = async function (url, opt) {
    url = String(url);
    if (url.indexOf('generativelanguage.googleapis.com') >= 0) {
      geminiCalls.push({ url: url, headers: opt.headers, body: JSON.parse(opt.body) });
      var g = gemini ? gemini() : reply(CSV);
      return { ok: g.status === 200, status: g.status, text: async function () { return JSON.stringify(g.body); } };
    }
    var name = url.split('/rpc/')[1], args = JSON.parse(opt.body), out, status = 200;
    try { out = fakeRpc(name, args); } catch (e) { status = e.code === '28000' ? 401 : 500; out = { message: e.message, code: e.code }; }
    return { ok: status === 200, status: status, text: async function () { return JSON.stringify(out); } };
  };

  // helpers
  ok('countRows: header only = 0', scan.countRows(scan.HEADER) === 0);
  ok('countRows: quoted line break stays one task', scan.countRows(scan.HEADER + '\n"a\nb",work\nc,work\n') === 2);
  ok('cleanCsv strips ``` fences and a BOM', scan.cleanCsv('﻿```csv\n' + CSV + '\n```').split('\n')[0].indexOf('title,list') === 0);
  var bad = null; try { scan.cleanCsv('Sorry, I cannot read this.'); } catch (e) { bad = e; }
  ok('cleanCsv refuses a reply that is not a task list (502)', bad && bad.status === 502);
  ok('sniff knows jpeg and refuses text', scan.sniff(jpeg()) === 'image/jpeg' && scan.sniff(Buffer.from('hello world, not a photo')) === null);
  var p = scan.buildPrompt('2026-11-07', 'personal');
  ok('prompt has today, the JSON fields, the forced list and no project names', p.indexOf('today is 2026-11-07') > 0 && p.indexOf('JSON array') > 0 && p.indexOf('subtasks (array') > 0 && p.indexOf('list is always personal') > 0 && p.indexOf('Google Health Request') < 0);

  // route: token first
  var r = await call('POST', { scan: '1' }, { 'x-todo-token': 'wrong' }, jpeg());
  ok('bad token -> 401 and Gemini is NOT called', r.status === 401 && geminiCalls.length === 0, r.status + ' calls=' + geminiCalls.length);

  // route: happy path with the raw photo, as the Shortcut sends it; a thought part must be ignored
  gemini = function () { return reply('```csv\n' + CSV + '\n```', [{ text: 'thinking out loud', thought: true }]); };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('photo -> 200 with 3 rows and a scan id', r.status === 200 && r.json.ok === true && r.json.rows === 3 && /^[0-9a-f-]{36}$/.test(r.json.id), r.body);
  ok('Gemini got the key in a header, jpeg mime, temperature 0, today, and no project names', geminiCalls.length === 1 && geminiCalls[0].headers['x-goog-api-key'] === KEY && geminiCalls[0].body.contents[0].parts[1].inline_data.mime_type === 'image/jpeg' && geminiCalls[0].body.generationConfig.temperature === 0 && /today is \d{4}-\d{2}-\d{2}/.test(geminiCalls[0].body.contents[0].parts[0].text) && geminiCalls[0].body.contents[0].parts[0].text.indexOf('Human Signal') < 0);
  ok('the key is not in the URL or the reply', geminiCalls[0].url.indexOf(KEY) < 0 && r.body.indexOf(KEY) < 0);
  ok('saved CSV is clean (no fence, no thought text)', scans.length === 1 && scans[0].csv.indexOf('```') < 0 && scans[0].csv.indexOf('thinking') < 0 && scans[0].csv.indexOf('"Access, roles?"') > 0);

  // GET and done
  var g1 = await call('GET', { scan: '1' }, T);
  ok('GET ?scan=1 returns the waiting scan', g1.status === 200 && g1.json.scan && g1.json.scan.id === r.json.id && g1.json.scan.csv.indexOf('Guidelines') > 0, g1.body);
  var dn = await call('POST', { scan_done: r.json.id }, T, {});
  var g2 = await call('GET', { scan: '1' }, T);
  ok('scan_done -> nothing waiting any more', dn.status === 200 && g2.json.scan === null, g2.body);
  ok('scan_done with a bad id -> 400', (await call('POST', { scan_done: 'nope' }, T, {})).status === 400);
  ok('GET ?scan=1 needs the token', (await call('GET', { scan: '1' }, { 'x-todo-token': 'x' })).status === 401);

  // other body shapes
  var before = geminiCalls.length;
  r = await call('POST', { scan: '1' }, T, { image: jpeg().toString('base64') });
  ok('JSON { image: base64 } works', r.status === 200 && r.json.rows === 3 && geminiCalls.length === before + 1, r.body);
  r = await call('POST', { scan: '1' }, T, jpeg().toString('base64'));
  ok('base64 text body works', r.status === 200 && r.json.rows === 3, r.body);
  r = await call('POST', { scan: '1' }, T, Buffer.from(jpeg().toString('base64'), 'latin1'));
  ok('base64 text sent as raw bytes works', r.status === 200 && r.json.rows === 3, r.body);
  before = geminiCalls.length;
  r = await call('POST', { scan: '1' }, T, Buffer.from('this is plain text and not a photo at all, sorry'));
  ok('not a photo -> 400, Gemini not called', r.status === 400 && geminiCalls.length === before, r.body);
  r = await call('POST', { scan: '1' }, T, undefined);
  ok('empty body -> 400', r.status === 400, r.body);
  r = await call('POST', { scan: '1' }, T, jpeg(5000000));
  ok('over 3.5 MB -> 413, Gemini not called', r.status === 413 && geminiCalls.length === before, r.body);

  // Gemini trouble
  gemini = function () { return { status: 429, body: { error: { message: 'quota' } } }; };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('Gemini 429 -> 429 with a plain message', r.status === 429 && /busy|limit/i.test(r.json.error), r.body);
  gemini = function () { return { status: 500, body: { error: { message: 'boom' } } }; };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('Gemini 500 -> 502', r.status === 502, r.body);
  gemini = function () { return { status: 404, body: { error: { message: 'model gone' } } }; };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('Gemini 404 -> tells you to set GEMINI_MODEL', r.status === 502 && /GEMINI_MODEL/.test(r.json.error), r.body);
  gemini = function () { return { status: 200, body: { candidates: [] } }; };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('empty Gemini reply -> 502', r.status === 502, r.body);
  gemini = function () { return reply('I could not read this photo.'); };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('Gemini answers in words, not CSV -> 502', r.status === 502, r.body);
  var n0 = scans.length;
  gemini = function () { return reply(scan.HEADER); };
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('nothing readable (header only) -> ok with 0 rows and nothing saved', r.status === 200 && r.json.rows === 0 && r.json.id === null && scans.length === n0, r.body);

  delete process.env.GEMINI_API_KEY; gemini = null;
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('no GEMINI_API_KEY -> 503 with a plain message', r.status === 503 && /GEMINI_API_KEY/.test(r.json.error), r.body);
  process.env.GEMINI_API_KEY = KEY;
  process.env.GEMINI_MODEL = 'gemini-test-model'; gemini = null; geminiCalls.length = 0;
  await call('POST', { scan: '1' }, T, jpeg());
  ok('GEMINI_MODEL picks the model', geminiCalls[0] && geminiCalls[0].url.indexOf('/models/gemini-test-model:generateContent') > 0);


{
  var c = scan.forceList('title,list,category\nA,work,Proj\n"B, with comma",,\n', 'personal').split('\n');
  ok('forceList sets list on every row, keeps header and quoting', c[0] === 'title,list,category' && c[1].indexOf('A,personal,Proj') === 0 && c[2].indexOf('"B, with comma",personal,') === 0);
  ok('forceList leaves csv alone when no list given', scan.forceList('title,list\nA,work', '') === 'title,list\nA,work');
}


  gemini = function () { return reply('title,list,category\nCall dentist,work,Health'); }; geminiCalls.length = 0;
  r = await call('POST', { scan: '1', list: 'personal' }, T, jpeg());
  ok('?list=personal is told to Gemini and forced on the saved row', r.status === 200 && geminiCalls[0].body.contents[0].parts[0].text.indexOf('list is always personal') > 0, r.body);

  {
    var T0 = '2026-11-07'; // a Saturday
    var f = scan.fixDateCategories('title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks\nA,work,Tomorrow,,,,,,,,\nB,work,Fri,,,,,,,,\nC,work,Today,2026-11-09,,,,,,,\nD,work,Calls,,,,,,,,\nE,work,Thursday,,,,,,,,', T0).split('\n');
    ok('date headings filed as category become due dates', f[1].indexOf('A,work,,2026-11-08') === 0 && f[2].indexOf('B,work,,2026-11-13') === 0 && f[5].indexOf('E,work,,2026-11-12') === 0);
    ok('an existing due date is kept and a real heading stays', f[3].indexOf('C,work,,2026-11-09') === 0 && f[4].indexOf('D,work,Calls,') === 0);
    var m = scan.matchProjects('title,list,category,due_date,remind_time,repeat,priority,quick,must_today,notes,subtasks\nupdate Firstwork data,work,Calls,,,,,,,,\nbuy milk,work,,,,,,,,,\nFirstwork lunch,personal,,,,,,,,,\nsync with the Firstwork team,work,,,,,,,,,', ['Firstwork', 'First', 'Human Signal']).split('\n');
    ok('a Work task naming a real project goes to it (longest name wins)', m[1].indexOf('update Firstwork data,work,Firstwork,') === 0 && m[2].indexOf('buy milk,work,,') === 0 && m[3].indexOf('Firstwork lunch,personal,,') === 0 && m[4].indexOf(',work,Firstwork,') > 0);
    var pr = scan.buildPrompt(T0, 'work');
    ok('prompt covers date headings, dates and times in titles, wrapped lines, priority marks', pr.indexOf('(saturday)') > 0 && pr.indexOf('is a day or date') > 0 && pr.indexOf('remove those date words') > 0 && pr.indexOf('SAME task title') > 0 && pr.indexOf('!!! is 3') > 0);
  }

  {
    var J = scan.jsonToCsv(JSON.stringify([
      { raw: '!!! Chase invoice (ask for PO number)', title: 'Chase invoice (ask for PO number)', list: 'work', due_date: '2026-11-08', priority: null, quick: false, must_today: false, notes: '', subtasks: [] },
      { raw: 'Quick call with Dave', title: 'Quick call with Dave', list: 'work', priority: null, quick: false, must_today: false, subtasks: [] },
      { raw: 'Put bins out \u26A1', title: 'Put bins out', list: 'personal', priority: null, subtasks: [] },
      { raw: 'Reply to Dan MDT', title: 'Reply to Dan MDT', list: 'work', priority: null, subtasks: [] },
      { raw: 'Plan Q1 priorities high', title: 'Plan Q1 priorities', list: 'work', priority: 2, subtasks: ['- list 3 goals', 'check budget'] },
      { raw: 'Say well done!', title: 'Say well done!', list: 'work', priority: null, subtasks: [] }
    ])).split('\n');
    ok('JSON: !!! becomes priority 3 and the bracket note is kept, both out of the title', J[1].indexOf('Chase invoice,work,,2026-11-08,,,3,,,ask for PO number,') === 0);
    ok('JSON: the word quick and the lightning bolt both set quick (in the quick column)', J[2].split(',')[7] === 'yes' && J[3].split(',')[7] === 'yes' && J[3].indexOf('Put bins out,personal') === 0);
    ok('JSON: MDT sets must_today and leaves the title', J[4].indexOf('Reply to Dan,work') === 0 && J[4].split(',')[8] === 'yes');
    ok('JSON: indented bullets arrive as sub-tasks joined with |', J[5].split(',')[10] === 'list 3 goals|check budget' && J[5].split(',')[6] === '2');
    ok('JSON: a trailing ! in normal text is not a priority mark', J[6].split(',')[6] === '');
    var bad = false; try { scan.jsonToCsv('not json'); } catch (e) { bad = e.status === 502; }
    ok('JSON: garbage reply is a clear 502', bad);
  }

  gemini = function () { return reply('[{"raw":"Chase invoice !!!","title":"Chase invoice","list":"work","priority":null,"quick":false,"must_today":false,"subtasks":[]}]'); }; geminiCalls.length = 0;
  r = await call('POST', { scan: '1' }, T, jpeg());
  ok('a JSON reply is accepted end to end and asked for as JSON', r.status === 200 && r.json.rows === 1 && geminiCalls[0].body.generationConfig.responseMimeType === 'application/json', r.body);

  global.fetch = origFetch; console.error = origErr;
  console.log(fails ? fails + ' FAIL' : '0 FAIL');
  process.exit(fails ? 1 : 0);
})();
