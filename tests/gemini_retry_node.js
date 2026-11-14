// node tests/gemini_retry_node.js : Gemini 503 is retried, then a lighter model is tried; other errors are not retried
var assert = require('assert'), jm = require('../api/_jobmail.js'); jm._setWait(5);
process.env.GEMINI_API_KEY = 'k'; delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODEL;
var plan = [], urls = [];
global.fetch = async function (url) { urls.push(url.split('/models/')[1].split(':')[0]); var s = plan.shift();
  return { ok: s === 200, status: s, text: async function () { return s === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }) : '{}'; } }; };
(async function () {
  plan = [503, 200]; assert.strictEqual(await jm.ask('p'), '{"ok":1}'); assert.deepStrictEqual(urls, ['gemini-3.8-flash', 'gemini-3.8-flash'], 'one retry on the same model');
  urls = []; plan = [503, 503, 200]; assert.strictEqual(await jm.ask('p'), '{"ok":1}'); assert.deepStrictEqual(urls, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'], 'then the lighter model');
  urls = []; plan = [503, 503, 503]; await assert.rejects(jm.ask('p'), function (e) { return e.status === 502 && /busy right now/.test(e.message); }); assert.strictEqual(urls.length, 3);
  urls = []; plan = [429]; await assert.rejects(jm.ask('p'), function (e) { return e.status === 429; }); assert.strictEqual(urls.length, 1, 'quota errors are not retried');
  urls = []; plan = [400]; await assert.rejects(jm.ask('p'), function (e) { return e.status === 502; }); assert.strictEqual(urls.length, 1);
  process.env.GEMINI_MODEL = 'gemini-x'; process.env.GEMINI_FALLBACK_MODEL = 'gemini-x'; urls = []; plan = [503, 503]; await assert.rejects(jm.ask('p')); assert.strictEqual(urls.length, 2, 'no pointless third try on the same model');
  console.log('PASS gemini_retry_node');
})().catch(function (e) { console.error('FAIL', e); process.exit(1); });
