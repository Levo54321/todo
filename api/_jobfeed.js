// Reed job feed for the Jobs tab (Discover). Not an endpoint: used by api/_jobs.js (routes ?jobs=feed and ?jobs=feedcfg).
// Reed Jobseeker API: GET https://www.reed.co.uk/api/1.0/search, basic auth with REED_API_KEY as the user name and an empty password.
// London (15 miles) plus a "remote" search per keyword; no remote filter exists, so remote hits are recognised from the text.
// Fit score = how many of Luc's skills appear in the title/snippet (6 or more = 100). Pure functions here; the network call is injectable for tests.
'use strict';

var BASE = 'https://www.reed.co.uk/api/1.0/search';
var MAX_KEYWORDS = 8, TAKE = 25, MAX_NEW = 40, TIMEOUT_MS = 12000;

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function has(text, term) {
  var t = String(term || '').trim();
  if (!t) return false;
  return new RegExp('(^|[^a-z0-9])' + esc(t.toLowerCase()) + '([^a-z0-9]|$)').test(text);
}
function isRemote(r) {
  var t = (String(r.jobTitle || '') + ' ' + String(r.locationName || '') + ' ' + String(r.jobDescription || '')).toLowerCase();
  return /\bremote(ly)?\b|work(ing)? from home|\bwfh\b|home[- ]based|fully remote/.test(t) && !/\bnot remote\b|no remote/.test(t);
}
function expired(r, today) {            // Reed gives dd/mm/yyyy; today is YYYY-MM-DD
  var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r.expirationDate || ''));
  return !!m && (m[3] + '-' + m[2] + '-' + m[1]) < today;
}
function money(n) { return n >= 1000 ? '£' + Math.round(n / 1000) + 'k' : '£' + Math.round(n); }
function salary(r) {
  var lo = Number(r.minimumSalary), hi = Number(r.maximumSalary);
  if (String(r.currency || 'GBP') !== 'GBP' || !(lo > 0 || hi > 0)) return '';
  if (lo > 0 && hi > 0 && hi !== lo) return money(lo) + '-' + money(hi);
  return money(hi > 0 ? hi : lo);
}
function isoDate(v) { var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
function searchDetails(r) {            // what the search result already tells us (the full text is fetched when a card is opened)
  var o = {}, p = isoDate(r.date), x = isoDate(r.expirationDate);
  if (p) o.posted = p; if (x) o.expires = x;
  if (r.applications !== undefined && r.applications !== null && !isNaN(Number(r.applications))) o.applicants = Number(r.applications);
  return o;
}
function score(r, skills) {
  var text = (String(r.jobTitle || '') + ' ' + String(r.jobDescription || '')).toLowerCase(), hit = [], i;
  for (i = 0; i < skills.length; i++) if (has(text, skills[i]) && hit.indexOf(skills[i]) < 0) hit.push(skills[i]);
  return { fit: Math.min(100, Math.round(hit.length / 6 * 100)), why: hit.slice(0, 8).join(', '), n: hit.length };
}
// results = [{r, remote}] already de-duplicated; returns leads for job_leads_add
function toLeads(items, skills, today) {
  var out = [], seen = {}, i, r, sc;
  for (i = 0; i < items.length; i++) {
    r = items[i].r;
    if (!r || !r.jobId || seen[r.jobId] || expired(r, today)) continue;
    if (typeof r.jobUrl !== 'string' || r.jobUrl.indexOf('https://www.reed.co.uk/') !== 0) continue;
    seen[r.jobId] = 1;
    sc = score(r, skills);
    if (!sc.n) continue;
    out.push({
      role: String(r.jobTitle || '').slice(0, 160), company: String(r.employerName || '').slice(0, 120),
      location: items[i].remote && !/london/i.test(String(r.locationName || '')) ? 'Remote' : String(r.locationName || '').slice(0, 120),
      mode: items[i].remote ? 'remote' : '', url: r.jobUrl, fit: sc.fit, why: sc.why, salary: salary(r), details: searchDetails(r)
    });
  }
  out.sort(function (a, b) { return b.fit - a.fit; });
  return out.slice(0, MAX_NEW);
}
function authHeader(key) { return 'Basic ' + Buffer.from(String(key) + ':').toString('base64'); }
async function realGet(url, key) {
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, TIMEOUT_MS), res;
  try { res = await fetch(url, { headers: { Authorization: authHeader(key), Accept: 'application/json' }, signal: ac.signal }); }
  finally { clearTimeout(t); }
  if (res.status === 401 || res.status === 403) { var e = new Error('Reed refused the key'); e.status = 502; throw e; }
  if (!res.ok) { var e2 = new Error('Reed answered ' + res.status); e2.status = 502; throw e2; }
  return res.json();
}
// Returns { leads, calls, failed }. Throws only when EVERY call failed.
async function search(cfg, key, today, getFn) {
  var get = getFn || realGet, kws = (cfg.keywords || []).slice(0, MAX_KEYWORDS), jobs = [], i;
  for (i = 0; i < kws.length; i++) {
    jobs.push({ remote: false, url: BASE + '?keywords=' + encodeURIComponent(kws[i]) + '&locationName=London&distanceFromLocation=15&resultsToTake=' + TAKE });
    jobs.push({ remote: true, url: BASE + '?keywords=' + encodeURIComponent(kws[i] + ' remote') + '&resultsToTake=' + TAKE });
  }
  var settled = await Promise.all(jobs.map(function (j) {
    return Promise.resolve().then(function () { return get(j.url, key); }).then(function (d) { return { ok: true, j: j, d: d }; }, function (e) { return { ok: false, e: e }; });
  }));
  var items = [], failed = 0, lastErr = null, k, s, r;
  for (i = 0; i < settled.length; i++) {
    s = settled[i];
    if (!s.ok) { failed++; lastErr = s.e; continue; }
    var list = (s.d && s.d.results) || [];
    for (k = 0; k < list.length; k++) {
      r = list[k];
      if (s.j.remote && !isRemote(r)) continue;          // the remote search only counts postings that say so
      items.push({ r: r, remote: s.j.remote || isRemote(r) });
    }
  }
  if (jobs.length && failed === jobs.length) { var e3 = new Error(lastErr && lastErr.message ? lastErr.message : 'Reed unreachable'); e3.status = (lastErr && lastErr.status) || 502; throw e3; }
  return { leads: toLeads(items, cfg.skills || [], today), calls: jobs.length, failed: failed };
}
function stale(cfg, nowMs) { return !cfg.last_run || nowMs - Date.parse(cfg.last_run) > 20 * 3600 * 1000; }
function cleanList(a, max) {
  var out = [], i, v;
  if (!Array.isArray(a)) return null;
  for (i = 0; i < a.length && out.length < max; i++) { v = String(a[i] == null ? '' : a[i]).replace(/\s+/g, ' ').trim().slice(0, 60); if (v && out.indexOf(v) < 0) out.push(v); }
  return out;
}

module.exports = { search: search, stale: stale, cleanList: cleanList, _t: { has: has, isRemote: isRemote, expired: expired, salary: salary, score: score, toLeads: toLeads, authHeader: authHeader } };
