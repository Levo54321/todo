// Reads one LinkedIn job-alert email into leads (Jobs tab, Discover). Used by api/_jobs.js for POST /api/pprojects?jobs=email.
// Gemini (env GEMINI_API_KEY, model GEMINI_MODEL, both set by Luc in Vercel) reads the email text and says which numbered link is which job,
// plus role, company, place and whether it is remote. It never makes up links: it can only point at links that were in the email.
// Only London or remote jobs are kept (Luc's rule). Nothing here calls LinkedIn.
var DEFAULT_MODEL = 'gemini-3.8-flash', TIMEOUT_MS = 25000, MAX_LINKS = 40, MAX_TEXT = 24000;

function fail(status, msg) { var e = new Error(msg); e.status = status; return e; }
// https://www.linkedin.com/comm/jobs/view/123?x=1 or /jobs/view/some-title-123 -> https://www.linkedin.com/jobs/view/123/ ('' if not a job link)
function jobUrl(u) {
  var m = /^https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^\/?#]*-)?(\d{6,})/i.exec(String(u || '').trim());
  return m ? 'https://www.linkedin.com/jobs/view/' + m[1] + '/' : '';
}
// the links worth showing the model: LinkedIn job links only, one per job, with their visible text
function cleanLinks(links) {
  var out = [], seen = {}, i, u, t;
  for (i = 0; i < (Array.isArray(links) ? links.length : 0) && out.length < MAX_LINKS; i++) {
    u = jobUrl(links[i] && links[i].url); if (!u) continue;
    t = String((links[i] && links[i].text) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (seen[u]) { if (!seen[u].text && t) seen[u].text = t; continue; }
    seen[u] = { url: u, text: t }; out.push(seen[u]);
  }
  return out;
}
function buildPrompt(text, links) {
  var l = '', i;
  for (i = 0; i < links.length; i++) l += '[' + i + '] ' + links[i].url + (links[i].text ? '  (link text: ' + links[i].text + ')' : '') + '\n';
  return 'This is the text of a LinkedIn job alert email. List every job posting it recommends.\n' +
    'Reply with JSON only: {"jobs":[{"link":<number of the job link from the list below>,"role":"job title","company":"company name","location":"place as written","remote":true|false}]}\n' +
    'Rules: one entry per job; "link" must be a number from the list (the link for that job), never a made-up address; use "" for anything the email does not say; ' +
    'remote is true only if the email says the job is remote; ignore adverts, "see more jobs" links, profile and settings links.\n\nLINKS\n' + l + '\nEMAIL TEXT\n' + text;
}
// Gemini sometimes puts the answer in a ```json fence
function parseJobs(raw) {
  var t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''), j;
  try { j = JSON.parse(t); } catch (e) { return null; }
  if (Array.isArray(j)) return j;
  return j && Array.isArray(j.jobs) ? j.jobs : null;
}
// London or remote only. An unknown place is kept (the alert itself was London); anything else is dropped.
function okPlace(location, remote) {
  if (remote === true) return true;
  var s = String(location || '');
  if (!s.replace(/\s/g, '')) return true;
  return /london|remote|work from home|wfh|anywhere/i.test(s);
}
function toLeads(jobs, links) {
  var out = [], seen = {}, i, j, ix, l, role, company, loc, remote;
  for (i = 0; i < (jobs || []).length && out.length < 60; i++) {
    j = jobs[i] || {}; ix = parseInt(j.link, 10);
    if (!(ix >= 0 && ix < links.length)) continue; // only links that were really in the email
    l = links[ix]; if (seen[l.url]) continue;
    role = String(j.role || '').replace(/\s+/g, ' ').trim().slice(0, 160); company = String(j.company || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    loc = String(j.location || '').replace(/\s+/g, ' ').trim().slice(0, 120); remote = j.remote === true || /\bremote\b/i.test(loc);
    if (!role && !company) continue;
    if (!okPlace(loc, remote)) continue;
    seen[l.url] = 1;
    out.push({ role: role || 'Job', company: company, location: loc, mode: remote ? 'remote' : '', url: l.url });
  }
  return out;
}
async function ask(prompt) {
  var key = process.env.GEMINI_API_KEY;
  if (!key) throw fail(503, 'GEMINI_API_KEY is missing in Vercel.');
  var model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL); if (!/^[A-Za-z0-9._-]+$/.test(model)) model = DEFAULT_MODEL;
  var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS), r, raw, data = null;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ generationConfig: { temperature: 0, responseMimeType: 'application/json' }, contents: [{ parts: [{ text: prompt }] }] })
    });
    raw = await r.text();
  } catch (e) { throw fail(e && e.name === 'AbortError' ? 504 : 502, 'Gemini did not answer.'); } finally { clearTimeout(timer); }
  try { data = raw ? JSON.parse(raw) : null; } catch (e2) { data = null; }
  if (!r.ok) throw fail(r.status === 429 ? 429 : 502, 'Gemini error ' + r.status);
  var parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts, text = '', i;
  for (i = 0; parts && i < parts.length; i++) if (typeof parts[i].text === 'string' && !parts[i].thought) text += parts[i].text;
  if (!text) throw fail(502, 'Gemini sent back nothing.');
  return text;
}
// body: { text, links:[{url,text}] } -> { leads:[...], seen: links in the email }. Throws {status} on a Gemini problem (the caller answers it; the Apps Script retries later).
async function read(body, askFn) {
  var text = String((body && body.text) || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT), links = cleanLinks(body && body.links);
  if (!links.length) return { leads: [], seen: 0 };
  var jobs = parseJobs(await (askFn || ask)(buildPrompt(text, links)));
  if (!jobs) throw fail(502, 'Gemini answer was not understood.');
  return { leads: toLeads(jobs, links), seen: links.length };
}
module.exports = { read: read, jobUrl: jobUrl, cleanLinks: cleanLinks, buildPrompt: buildPrompt, parseJobs: parseJobs, okPlace: okPlace, toLeads: toLeads };
