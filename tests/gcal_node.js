// Google sign-in start/state without network: node tests/gcal_node.js
process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec'; process.env.SUPABASE_KEY = 'test-key-not-real';
var todos = require('../api/todos.js');
todos.rpc = async function (name, args) { if (args.p_token !== 'goodtoken') { var e = new Error('no'); e.code = '28000'; throw e; } return null; };
var h = require('../api/gcal.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }
function call(method, query, headers, body) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, end: function (b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); } };
    var req = { method: method, query: query || {}, headers: headers || {}, body: body };
    h(req, res);
  });
}
(async function () {
  var r = await call('POST', {}, { 'x-todo-token': 'goodtoken' }, { start: true });
  var j = JSON.parse(r.body);
  ok('POST start returns a Google url', r.status === 200 && /^https:\/\/accounts\.google\.com\//.test(j.url), r.body.slice(0, 80));
  ok('token is not in the url (plain, base64 or url-encoded)', j.url.indexOf('goodtoken') < 0 && j.url.indexOf(Buffer.from('goodtoken').toString('base64').replace(/=+$/, '')) < 0);
  var state = new URL(j.url).searchParams.get('state');
  var cb = await call('GET', { code: 'abc', state: state });
  ok('valid state is accepted by the callback (fails later at Google, not as expired)', cb.status !== 400, cb.status);
  ok('tampered state is refused', (await call('GET', { code: 'abc', state: state.slice(0, -3) + 'AAA' })).status === 400);
  ok('garbage state is refused', (await call('GET', { code: 'abc', state: 'x.y' })).status === 400);
  ok('bad token cannot start sign-in', (await call('POST', {}, { 'x-todo-token': 'nope' }, { start: true })).status === 401);
  ok('missing token cannot start sign-in', (await call('POST', {}, {}, { start: true })).status === 401);
  var old = await call('GET', { action: 'start', t: 'goodtoken' });
  ok('old GET ?action=start&t= is retired (no redirect)', old.status === 410 && !old.headers.location);
  console.log(fails ? 'GCAL NODE TESTS: ' + fails + ' failed' : 'GCAL NODE TESTS: all passed'); process.exit(fails ? 1 : 0);
})();
