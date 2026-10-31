// /api/history?days=N — completed-task history for the Insights view (token-gated, read-only).
var todos = require('./todos.js');

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t;
  if (!token) return send(res, 401, { error: 'missing token' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method not allowed' }); }
  var days = parseInt(q.days, 10);
  if (!isFinite(days) || days < 1) days = 120;
  if (days > 400) days = 400;
  try {
    var rows = await todos.rpc('todo_history', { p_token: token, p_days: days });
    return send(res, 200, { rows: rows || [] });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup6.sql first' });
    console.error('history api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
