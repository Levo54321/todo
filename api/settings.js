// /api/settings — GET returns settings (the calendar link itself is never sent back); POST/PATCH updates them.
// Stored in the database behind the same token. City is geocoded here (Open-Meteo) to lat/lon.
var todos = require('./todos.js');

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function view(s) {
  s = s || {};
  return {
    city: s.city || '', place: s.place || '', units: s.units === 'f' ? 'f' : 'c',
    calendar_set: !!s.cal_url, stale_days: s.stale_days || 14,
    night_start: s.night_start === undefined ? 22 : s.night_start, night_end: s.night_end === undefined ? 6 : s.night_end,
    theme: s.theme || 'auto'
  };
}
function readBody(req) {
  var b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) || {}; } catch (e) { return {}; }
}
function int(v, lo, hi) { var n = parseInt(v, 10); return isNaN(n) || n < lo || n > hi ? null : n; }

module.exports = async function handler(req, res) {
  var token = req.headers['x-todo-token'] || (req.query || {}).t;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (req.method === 'GET') {
      return send(res, 200, { settings: view(await todos.rpc('todo_settings_get', { p_token: token })) });
    }
    if (req.method !== 'POST' && req.method !== 'PATCH') return send(res, 405, { error: 'method not allowed' });
    var b = readBody(req), patch = {}, v;
    if ('city' in b) {
      var city = typeof b.city === 'string' ? b.city.trim().slice(0, 80) : '';
      if (!city) { patch.city = null; patch.place = null; patch.lat = null; patch.lon = null; }
      else {
        var r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(city), { signal: AbortSignal.timeout(6000) });
        var j = r.ok ? await r.json() : null;
        var hit = j && j.results && j.results[0];
        if (!hit) return send(res, 422, { error: 'city not found' });
        patch.city = city; patch.lat = hit.latitude; patch.lon = hit.longitude;
        patch.place = hit.name + (hit.admin1 && hit.admin1 !== hit.name ? ', ' + hit.admin1 : '') + (hit.country_code ? ' (' + hit.country_code + ')' : '');
      }
    }
    if ('units' in b) { if (b.units !== 'c' && b.units !== 'f') return send(res, 400, { error: 'bad units' }); patch.units = b.units; }
    if ('theme' in b) { if (['auto', 'night', 'day'].indexOf(b.theme) < 0) return send(res, 400, { error: 'bad theme' }); patch.theme = b.theme; }
    if ('stale_days' in b) { v = int(b.stale_days, 3, 120); if (v === null) return send(res, 400, { error: 'bad days' }); patch.stale_days = v; }
    if ('night_start' in b) { v = int(b.night_start, 0, 23); if (v === null) return send(res, 400, { error: 'bad hour' }); patch.night_start = v; }
    if ('night_end' in b) { v = int(b.night_end, 0, 23); if (v === null) return send(res, 400, { error: 'bad hour' }); patch.night_end = v; }
    if ('calendar_url' in b) {
      var u = typeof b.calendar_url === 'string' ? b.calendar_url.trim() : '';
      if (!u) patch.cal_url = null;
      else if (/^(https:|webcal:)\/\/\S+$/i.test(u) && u.length < 1500) patch.cal_url = u;
      else return send(res, 400, { error: 'calendar link must start with https:// or webcal://' });
    }
    return send(res, 200, { settings: view(await todos.rpc('todo_settings_set', { p_token: token, p_patch: patch })) });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === '23514') return send(res, 400, { error: 'invalid input' });
    console.error('settings api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
