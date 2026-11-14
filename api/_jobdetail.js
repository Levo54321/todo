// Job details for the Jobs tab: Reed's job-details call (full description, contract, closing date, apply link) and a Gemini read of the description
// (summary, requirements, nice-to-haves, skills). Not an endpoint: used by api/_jobs.js (routes ?jobs=lead and ?jobs=enrich).
// Reed documents the details fields only by label (not JSON key names), so every field is read defensively under its likely names.
'use strict';

var DETAIL_URL = 'https://www.reed.co.uk/api/1.0/jobs/', TIMEOUT_MS = 12000, MAX_DESC = 15000;

function decode(s) {
  var map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', bull: '•' };
  return String(s).replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&([a-z]+);/gi, function (m, n) { return map[n.toLowerCase()] !== undefined ? map[n.toLowerCase()] : m; });
}
// Reed descriptions are HTML: keep paragraphs and bullets, drop everything else
function htmlToText(h) {
  var s = String(h == null ? '' : h);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(p|div|ul|ol|h[1-6]|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  s = decode(s).replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > MAX_DESC ? s.slice(0, MAX_DESC) + '…' : s;
}
function isoDate(v) {                                   // Reed gives dd/mm/yyyy, sometimes ISO
  var s = String(v == null ? '' : v), m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
}
function pick(o, names) { var i; for (i = 0; i < names.length; i++) if (o[names[i]] !== undefined && o[names[i]] !== null && o[names[i]] !== '') return o[names[i]]; return undefined; }
function money(n) { n = Number(n); return n >= 1000 ? '£' + Math.round(n / 1000) + 'k' : '£' + Math.round(n); }
function human(s) { return String(s == null ? '' : s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase(); }
function cap(s) { s = human(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// raw = Reed /jobs/{id} JSON -> the small object kept in details
function parseReed(raw) {
  var r = raw || {}, o = {}, v, lo, hi;
  if (!r || (!r.jobDescription && !r.jobTitle && !r.jobId)) return null;        // a blank job is returned for an unknown id
  v = pick(r, ['jobDescription', 'description']); if (v) o.description = htmlToText(v);
  v = pick(r, ['contractType', 'contract']); if (v) o.contract = cap(v);
  v = pick(r, ['jobType']); if (v) o.job_type = cap(v);
  else if (r.fullTime === true) o.job_type = 'Full time'; else if (r.partTime === true) o.job_type = 'Part time';
  v = pick(r, ['salaryType']); if (v) o.salary_type = human(v);
  lo = Number(pick(r, ['yearlyMinimumSalary'])); hi = Number(pick(r, ['yearlyMaximumSalary']));
  if ((lo > 0 || hi > 0) && String(r.currency || 'GBP') === 'GBP') o.salary_year = lo > 0 && hi > 0 && hi !== lo ? money(lo) + '-' + money(hi) : money(hi > 0 ? hi : lo);
  v = isoDate(pick(r, ['datePosted', 'date'])); if (v) o.posted = v;
  v = isoDate(pick(r, ['expirationDate'])); if (v) o.expires = v;
  v = pick(r, ['applicationCount', 'applications']); if (v !== undefined && !isNaN(Number(v))) o.applicants = Number(v);
  v = pick(r, ['externalUrl']); if (typeof v === 'string' && /^https?:\/\/\S+$/.test(v)) o.apply_url = v.slice(0, 1000);
  v = pick(r, ['employerId']); if (v) o.employer_id = String(v).slice(0, 20);
  return o;
}
function reedId(url) { var m = /\/(\d{4,12})(?:[/?#].*)?$/.exec(String(url || '')); return m ? m[1] : ''; }
function authHeader(key) { return 'Basic ' + Buffer.from(String(key) + ':').toString('base64'); }
async function reedGet(id, key) {
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, TIMEOUT_MS), res;
  try { res = await fetch(DETAIL_URL + id, { headers: { Authorization: authHeader(key), Accept: 'application/json' }, signal: ac.signal }); }
  finally { clearTimeout(t); }
  if (!res.ok) { var e = new Error('Reed answered ' + res.status); e.status = 502; throw e; }
  return res.json();
}
async function fetchReed(url, key, getFn) {
  var id = reedId(url);
  if (!id) return null;
  return parseReed(await (getFn || reedGet)(id, key));
}

/* ---------- Gemini read of the description ---------- */
function buildPrompt(role, company, desc) {
  return 'You read one UK job advert so a candidate can decide whether to apply and tailor a CV. Use ONLY what the advert says; never invent.\n' +
    'Return JSON with exactly these keys:\n' +
    '"summary": one or two plain sentences (max 280 characters) on what the job really is;\n' +
    '"requirements": array of up to 12 short must-have requirements, in the advert\'s own terms;\n' +
    '"nice_to_have": array of up to 8 short desirable extras (empty if none);\n' +
    '"skills": array of up to 15 short skill or tool keywords a CV should mention.\n' +
    'Each string under 120 characters. Empty arrays if the advert says nothing.\n\nRole: ' + String(role).slice(0, 160) + '\nCompany: ' + String(company).slice(0, 120) + '\nAdvert:\n' + String(desc).slice(0, 12000);
}
function strs(a, n) { var o = [], i, s; if (!Array.isArray(a)) return o; for (i = 0; i < a.length && o.length < n; i++) { s = String(a[i] == null ? '' : a[i]).replace(/\s+/g, ' ').trim().slice(0, 120); if (s && o.indexOf(s) < 0) o.push(s); } return o; }
function parseAi(text) {
  var d; try { d = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { return null; }
  if (!d || typeof d !== 'object') return null;
  return { summary: String(d.summary || '').replace(/\s+/g, ' ').trim().slice(0, 300), requirements: strs(d.requirements, 12), nice_to_have: strs(d.nice_to_have, 8), skills: strs(d.skills, 15) };
}
async function analyse(role, company, desc, askFn) {
  var out = parseAi(await askFn(buildPrompt(role, company, desc)));
  if (!out) { var e = new Error('Gemini sent back something unreadable'); e.status = 502; throw e; }
  return out;
}

module.exports = { fetchReed: fetchReed, analyse: analyse, reedId: reedId, _t: { htmlToText: htmlToText, isoDate: isoDate, parseReed: parseReed, parseAi: parseAi, buildPrompt: buildPrompt } };
