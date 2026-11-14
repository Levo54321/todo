// Jobs tab handler, reached as /api/pprojects?jobs=... (api/pprojects.js hands the request over). The file name starts with
// "_" so Vercel does not count it as a function (the Hobby plan allows 12 per deployment). Auth: x-todo-token (or ?t=).
// Needs db/setup26.sql. A "job" is one posting/application; stages are the pipeline columns (editable).
//   GET   ?jobs=1                 -> { stages:[{id,name,color,kind,follow_days,pos}], jobs:[{id,company,role,location,mode,
//                                    salary,url,source,stage_id,contact,cv_variant,notes,next_step,next_on,applied_on,pos,
//                                    created_at,updated_at}] }   the first call creates the default stages
//                                    (Saved, Applied, Screening, Interview, Offer, Closed). jobs are in column order.
//   GET   ?jobs=1&id=<uuid>       -> { job, events:[{at,kind,text}] }   kind 'added' | 'stage', newest first
//   POST  ?jobs=1 {company?, role?, location?, mode?, salary?, url?, contact?, cv_variant?, notes?, next_step?, next_on?,
//                  applied_on?, stage_id?}           -> 201 { job }   goes to the top of stage_id (default: first stage)
//   PATCH ?jobs=1&id=<uuid> {same fields}            -> { job }   only the fields sent change; a new stage_id moves the card
//                                    to the top of that column, logs the move and sets applied_on the first time a job
//                                    leaves the first stage
//   DELETE ?jobs=1&id=<uuid>      -> { ok:true }
//   POST  ?jobs=stages {stages:[{id?, name, color, kind, follow_days?}]}  -> { stages, jobs }   replaces the whole list in
//                                    this order (1 to 12). Entries without an id are new; stages left out are removed and
//                                    their jobs move to the stage before. color: sand clay ochre sage moss stone rose slate;
//                                    kind: active | won | lost (won/lost end the pipeline); follow_days 1 to 60 or null.
//   POST  ?jobs=quick {url?, text?}                  -> 201 { job } or 200 { job, duplicate:true }   for the iPhone "Save to Jobs"
//                                    Shortcut (Share sheet). The link is taken from url or from text; the rest of text becomes
//                                    the role ("Role at Company" and "Role - Company" are split). A LinkedIn job link is cleaned
//                                    to its short form so the same job is not saved twice. source = linkedin | adzuna | share.
// mode: remote | hybrid | onsite | '' ; url must be http(s); dates YYYY-MM-DD or '' (clears). Text fields are cut to their
// column sizes (company 120, role 160, location 120, salary 60, contact 120, cv_variant 80, notes 4000, next_step 120).
var todos = require('./todos.js');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var TEXT = { company: 120, role: 160, location: 120, salary: 60, contact: 120, cv_variant: 80, notes: 4000, next_step: 120 };
var COLORS = ['sand', 'clay', 'ochre', 'sage', 'moss', 'stone', 'rose', 'slate'], KINDS = ['active', 'won', 'lost'];

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  var b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  var s = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
  try { var j = JSON.parse(s); return (j && typeof j === 'object') ? j : { text: String(j) }; }
  catch (e) { return { text: s }; } // plain text body (handy for Shortcuts)
}
function realDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function cleanUrl(u) {
  u = typeof u === 'string' ? u.trim() : '';
  return /^https?:\/\/\S+$/i.test(u) ? u.slice(0, 1000) : '';
}
// only the keys that were sent are returned, so a PATCH never blanks the rest
function clean(b) {
  var out = {}, k;
  for (k in TEXT) if (Object.prototype.hasOwnProperty.call(TEXT, k) && k in b) out[k] = typeof b[k] === 'string' ? b[k].trim().slice(0, TEXT[k]) : '';
  if ('mode' in b) out.mode = ['remote', 'hybrid', 'onsite'].indexOf(b.mode) >= 0 ? b.mode : '';
  if ('url' in b) out.url = cleanUrl(b.url);
  if ('next_on' in b) out.next_on = realDate(b.next_on) ? b.next_on : '';
  if ('applied_on' in b) out.applied_on = realDate(b.applied_on) ? b.applied_on : '';
  if ('stage_id' in b) out.stage_id = typeof b.stage_id === 'string' && UUID.test(b.stage_id) ? b.stage_id : '';
  return out;
}
function cleanStages(a) {
  if (!Array.isArray(a) || a.length < 1 || a.length > 12) return null;
  var out = [], i, s, name, fd;
  for (i = 0; i < a.length; i++) {
    s = a[i] || {};
    name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name || name.length > 40) return null;
    fd = parseInt(s.follow_days, 10);
    out.push({
      id: typeof s.id === 'string' && UUID.test(s.id) ? s.id : '', name: name,
      color: COLORS.indexOf(s.color) >= 0 ? s.color : 'sand', kind: KINDS.indexOf(s.kind) >= 0 ? s.kind : 'active',
      follow_days: fd >= 1 && fd <= 60 ? fd : null
    });
  }
  return out;
}
// "Role at Company", "Role - Company", plus the link, from what the Share sheet sends
function parseShare(b) {
  var text = typeof b.text === 'string' ? b.text : '', url = cleanUrl(b.url);
  var m = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (m) text = text.replace(m[0], ' ');
  if (!url && m) url = cleanUrl(m[0]);
  var lm = /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^\/?#]*-)?(\d{6,})/i.exec(url);
  if (lm) url = 'https://www.linkedin.com/jobs/view/' + lm[1] + '/';
  text = text.replace(/\s+/g, ' ').replace(/^check out (?:this|the) job(?: posting)?:?\s*/i, '').replace(/^[\s:|–—-]+|[\s:|–—-]+$/g, '');
  var role = text, company = '';
  var p = /^(.{3,160}?)\s+(?:at|@)\s+(.{2,120})$/i.exec(text) || /^(.{3,160}?)\s+[|–—-]\s+(.{2,120})$/.exec(text);
  if (p) { role = p[1]; company = p[2]; }
  var source = /linkedin\.com/i.test(url) ? 'linkedin' : /adzuna\./i.test(url) ? 'adzuna' : 'share';
  return { job: { role: (role || 'Saved job').slice(0, 160), company: company.slice(0, 120), url: url }, source: source };
}

module.exports = async function handler(req, res) {
  var q = req.query || {}, token = req.headers['x-todo-token'] || q.t, what = String(q.jobs || '1'), m = req.method, id, b, job;
  if (!token) return send(res, 401, { error: 'missing token' });
  try {
    if (what === 'quick') {
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var sh = parseShare(readBody(req));
      if (sh.job.url) {
        var all = await todos.rpc('job_list', { p_token: token }), i;
        for (i = 0; i < ((all && all.jobs) || []).length; i++) if (all.jobs[i].url === sh.job.url) return send(res, 200, { job: all.jobs[i], duplicate: true });
      }
      return send(res, 201, { job: await todos.rpc('job_put', { p_token: token, p_job: sh.job, p_source: sh.source }) });
    }
    if (what === 'stages') {
      if (m !== 'POST') return send(res, 405, { error: 'method not allowed' });
      var st = cleanStages(readBody(req).stages);
      if (!st) return send(res, 400, { error: 'stages must be 1 to 12 entries with a name of up to 40 characters' });
      return send(res, 200, await todos.rpc('job_stages_put', { p_token: token, p_stages: st }));
    }
    if (m === 'GET') {
      if (q.id !== undefined) {
        if (!UUID.test(String(q.id))) return send(res, 400, { error: 'bad id' });
        return send(res, 200, await todos.rpc('job_get', { p_token: token, p_id: String(q.id) }));
      }
      return send(res, 200, await todos.rpc('job_list', { p_token: token }));
    }
    if (m === 'POST') {
      return send(res, 201, { job: await todos.rpc('job_put', { p_token: token, p_job: clean(readBody(req)), p_source: 'manual' }) });
    }
    if (m === 'PATCH' || m === 'DELETE') {
      id = String(q.id || '');
      if (!UUID.test(id)) return send(res, 400, { error: 'bad id' });
      if (m === 'DELETE') return send(res, 200, await todos.rpc('job_del', { p_token: token, p_id: id }));
      b = readBody(req); job = clean(b); job.id = id;
      return send(res, 200, { job: await todos.rpc('job_put', { p_token: token, p_job: job, p_source: 'manual' }) });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.code === '28000') return send(res, 401, { error: 'bad token' });
    if (e.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (e.code === '23514' || e.code === '22P02' || e.code === '22007' || e.code === '22008') return send(res, 400, { error: 'invalid input' });
    if (e.code === 'PGRST202') return send(res, 409, { error: 'run setup26.sql first' });
    console.error('jobs api error', e.code, e.message);
    return send(res, 502, { error: 'upstream error' });
  }
};
module.exports._t = { clean: clean, cleanStages: cleanStages, parseShare: parseShare, realDate: realDate };
