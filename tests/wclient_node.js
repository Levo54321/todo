// Work clients API (api/_wclients.js, routes in api/projects.js) without a network: node tests/wclient_node.js
// Checks the server rules: names (clean, unique ignoring case, limit), the image bytes (PNG/JPEG/GIF/WebP only, never SVG, by content,
// size cap), the icon response headers, removal reply, meta.client cleaning, and that the old routes are untouched.
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_KEY = 'test-key-not-real';
var h = require('../api/projects.js'), wc = require('../api/_wclients.js'), wp = require('../api/_wpmeta.js'), fails = 0, calls = [];
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }
function dbError(code, m) { var e = new Error(m || 'db ' + code); e.code = code; return e; }
var clients = [], icons = {}, reset = 0;
function list() { return clients.slice().sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }).map(function (c) { var o = { id: c.id, name: c.name, n: 0 }; if (icons[c.id]) o.icon_at = icons[c.id].at; return o; }); }
function fakeRpc(name, a) {
  calls.push({ name: name, args: a });
  if (a.p_token !== 'goodtoken') throw dbError('28000');
  if (name === 'wclient_list') return list();
  if (name === 'wclient_save') { var c = clients.filter(function (x) { return x.id === a.p_id; })[0]; if (c) c.name = a.p_name; else clients.push({ id: a.p_id, name: a.p_name }); return list(); }
  if (name === 'wclient_remove') { if (!clients.some(function (x) { return x.id === a.p_id; })) throw dbError('P0002'); clients = clients.filter(function (x) { return x.id !== a.p_id; }); delete icons[a.p_id]; return { clients: list(), reset: reset }; }
  if (name === 'wclient_icon_get') { if (!icons[a.p_id]) throw dbError('P0002'); return { mime: icons[a.p_id].mime, data: icons[a.p_id].data }; }
  if (name === 'wclient_icon_set') { if (!clients.some(function (x) { return x.id === a.p_id; })) throw dbError('P0002'); if (a.p_data === null) delete icons[a.p_id]; else icons[a.p_id] = { mime: a.p_mime, data: a.p_data, at: 1700000000000 }; return list(); }
  if (name === 'wproj_meta_put') { if (a.p_patch.client && a.p_patch.client !== 'cccccccccc01') throw dbError('23514', 'bad client'); return { id: a.p_id, meta: a.p_patch, events: [], people: [], clients: list() }; }
  if (name === 'wproj_list') return [];
  throw new Error('unexpected rpc ' + name);
}
function call(method, query, body, headers) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, end: function (b) { var j = null; try { j = b && !Buffer.isBuffer(b) ? JSON.parse(b) : null; } catch (e) {} resolve({ status: this.statusCode, json: j, raw: b, headers: this.headers }); } };
    h({ method: method, query: query || {}, headers: headers || { 'x-todo-token': 'goodtoken' }, body: body }, res);
  });
}
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
var JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
var GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 3)]);
var WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40, 4)]);
var SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

(async function () {
  global.fetch = async function (url, opt) {
    var name = String(url).split('/rpc/')[1], out, status = 200;
    try { out = fakeRpc(name, JSON.parse(opt.body)); } catch (e) { status = e.code === '28000' ? 401 : 500; out = { message: e.message, code: e.code }; }
    return { ok: status === 200, status: status, text: async function () { return JSON.stringify(out); } };
  };
  ok('sniff: PNG/JPEG/GIF/WebP by bytes', wc.sniff(PNG) === 'image/png' && wc.sniff(JPG) === 'image/jpeg' && wc.sniff(GIF) === 'image/gif' && wc.sniff(WEBP) === 'image/webp');
  ok('sniff: SVG and junk are never an image', wc.sniff(SVG) === null && wc.sniff(Buffer.from('hello world, not an image')) === null && wc.sniff(Buffer.alloc(0)) === null);

  var a = await call('POST', { clients: '1' }, { name: '  #Acme   Corp ' });
  ok('add: cleaned name, 12-hex id, 201', a.status === 201 && a.json.clients[0].name === 'Acme Corp' && /^[0-9a-f]{12}$/.test(a.json.clients[0].id), JSON.stringify(a.json));
  var id = a.json.clients[0].id;
  ok('add: duplicate ignoring case -> 409', (await call('POST', { clients: '1' }, { name: 'ACME corp' })).status === 409);
  ok('add: empty name -> 400', (await call('POST', { clients: '1' }, { name: '  ' })).status === 400);
  ok('add: name cut to 40 characters', (await call('POST', { clients: '1' }, { name: new Array(60).join('x') })).json.clients.some(function (c) { return c.name.length === 40; }));
  ok('rename', (await call('PATCH', { clients: id }, { name: 'Acme' })).json.clients.some(function (c) { return c.name === 'Acme'; }));
  ok('rename to another client\'s name -> 409', (await call('PATCH', { clients: id }, { name: new Array(60).join('x') })).status === 409);
  ok('rename keeping its own name (different case) is fine', (await call('PATCH', { clients: id }, { name: 'ACME' })).status === 200);
  ok('rename unknown -> 404', (await call('PATCH', { clients: 'ffffffffffff' }, { name: 'Q' })).status === 404);
  ok('rename with a bad id -> 404', (await call('PATCH', { clients: 'nope' }, { name: 'Q' })).status === 404);
  ok('GET list', (await call('GET', { clients: '1' })).json.clients.length === 2);
  ok('list needs the token', (await call('GET', { clients: '1' }, null, { 'x-todo-token': 'bad' })).status === 401);
  ok('PUT -> 405', (await call('PUT', { clients: '1' })).status === 405);

  // icons
  var u = await call('POST', { clienticon: id }, { data: PNG.toString('base64'), mime: 'image/png' });
  ok('icon: PNG stored with the sniffed type', u.status === 200 && icons[id].mime === 'image/png' && u.json.clients.filter(function (c) { return c.id === id; })[0].icon_at === 1700000000000);
  ok('icon: JPEG, GIF, WebP accepted', (await call('POST', { clienticon: id }, { data: JPG.toString('base64') })).status === 200 && (await call('POST', { clienticon: id }, { data: GIF.toString('base64') })).status === 200 && (await call('POST', { clienticon: id }, { data: WEBP.toString('base64') })).status === 200);
  ok('icon: the type is taken from the bytes, not the claim', (await call('POST', { clienticon: id }, { data: JPG.toString('base64'), mime: 'image/png' })).status === 200 && icons[id].mime === 'image/jpeg');
  ok('icon: SVG refused even when claimed as PNG', (await call('POST', { clienticon: id }, { data: SVG.toString('base64'), mime: 'image/png' })).status === 400 && icons[id].mime === 'image/jpeg');
  ok('icon: text refused', (await call('POST', { clienticon: id }, { data: Buffer.from('hello there, plain text').toString('base64') })).status === 400);
  ok('icon: over 200 KB refused', (await call('POST', { clienticon: id }, { data: Buffer.concat([PNG, Buffer.alloc(200001)]).toString('base64') })).status === 400);
  ok('icon: nothing sent -> 400', (await call('POST', { clienticon: id }, {})).status === 400);
  ok('icon: unknown client -> 404', (await call('POST', { clienticon: 'ffffffffffff' }, { data: PNG.toString('base64') })).status === 404);
  var n0 = calls.length, bi = await call('POST', { clienticon: '../x' }, { data: PNG.toString('base64') });
  ok('icon: bad id -> 404 and no database call', bi.status === 404 && calls.length === n0);
  await call('POST', { clienticon: id }, { data: PNG.toString('base64') });
  var g = await call('GET', { clienticon: id, v: '1700000000000', t: 'goodtoken' }, null, {});
  ok('icon GET (token in ?t= for <img>): image bytes with safe headers', g.status === 200 && Buffer.isBuffer(g.raw) && g.raw.equals(PNG) && g.headers['content-type'] === 'image/png' &&
    g.headers['x-content-type-options'] === 'nosniff' && /sandbox/.test(g.headers['content-security-policy']) && /immutable/.test(g.headers['cache-control']), JSON.stringify(g.headers));
  ok('icon GET without a token -> 401', (await call('GET', { clienticon: id }, null, {})).status === 401);
  ok('icon GET when none stored -> 404', (await call('GET', { clienticon: (await call('POST', { clients: '1' }, { name: 'Plain' })).json.clients.filter(function (c) { return c.name === 'Plain'; })[0].id }, null)).status === 404);
  ok('icon remove', (await call('DELETE', { clienticon: id })).status === 200 && !icons[id]);

  // removal
  reset = 3;
  var d = await call('DELETE', { clients: id });
  ok('remove: reply carries the list and how many projects went back to Internal', d.status === 200 && d.json.reset === 3 && !d.json.clients.some(function (c) { return c.id === id; }));
  ok('remove unknown -> 404', (await call('DELETE', { clients: 'ffffffffffff' })).status === 404);

  // meta.client cleaning + the database refusing an unknown client
  ok('meta.client: id accepted, null/empty clear it', wp.cleanMeta({ client: 'cccccccccc01' }).client === 'cccccccccc01' && wp.cleanMeta({ client: null }).client === null && wp.cleanMeta({ client: '' }).client === null);
  ok('meta.client: not an id -> error', (function () { try { wp.cleanMeta({ client: 'Acme' }); } catch (e) { return !!e.bad; } return false; })() && (function () { try { wp.cleanMeta({ client: 5 }); } catch (e) { return !!e.bad; } return false; })());
  ok('meta.client: key left out stays out (a rag-only save does not touch it)', !('client' in wp.cleanMeta({ goal: 'x' })));
  var mp = await call('PATCH', { id: 'aaaaaaaaaaa1', meta: '1' }, { meta: { client: 'cccccccccc01' } });
  ok('PATCH meta with a client passes the id on', mp.status === 200 && calls[calls.length - 1].args.p_patch.client === 'cccccccccc01');
  var mb = await call('PATCH', { id: 'aaaaaaaaaaa1', meta: '1' }, { meta: { client: 'dddddddddd02' } });
  ok('PATCH meta with a client that is gone -> 400 with a readable message', mb.status === 400 && /not in the list/.test(mb.json.error), JSON.stringify(mb.json));
  ok('plain GET still returns the old shape only', JSON.stringify(Object.keys((await call('GET')).json)) === '["projects"]');

  console.log(fails ? 'WCLIENT NODE TESTS: ' + fails + ' failed' : 'WCLIENT NODE TESTS: all passed');
  process.exit(fails ? 1 : 0);
})();
