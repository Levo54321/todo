// Career profile (v1081): the CV facts Luc keeps in the app, in the same shape as the cv-designer skill's cv_data.json.
// Not an endpoint: used by api/_jobs.js (route ?jobs=profile). Stored only in the database (career_profile), never in the repo.
// clean() trims and caps every field and drops unknown top-level keys except the skill's own layout keys (extra_side, extra_main,
// side_order, meta), which pass through untouched so a round trip to the skill loses nothing.
// forGemini() is what Tailor my CV (v1082) may send to Gemini: roles, bullets, skills. NEVER name, contact details or references.
'use strict';

function str(v, n) { return typeof v === 'string' ? v.replace(/\s+$/g, '').replace(/^\s+/g, '').slice(0, n) : ''; }
function strs(v, max, n) { var out = [], i, s; if (!Array.isArray(v)) return out; for (i = 0; i < v.length && out.length < max; i++) { s = str(v[i], n); if (s) out.push(s); } return out; }
function fail(msg) { var e = new Error(msg); e.status = 400; throw e; }

function role(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.type === 'milestone') {
    var m = { type: 'milestone', date: str(r.date, 40), title: str(r.title, 160), company: str(r.company, 120) };
    if (r.italic === false) m.italic = false;
    return m.title ? m : null;
  }
  var o = { type: 'role', start: str(r.start, 40), end: str(r.end, 40), title: str(r.title, 160), company: str(r.company, 120), location: str(r.location, 120), bullets: strs(r.bullets, 12, 600) };
  return o.title || o.company ? o : null;
}
function items(v, max) {
  var out = [], i, q; if (!Array.isArray(v)) return out;
  for (i = 0; i < v.length && out.length < max; i++) { q = v[i]; if (q && typeof q === 'object' && str(q.title, 160)) out.push({ title: str(q.title, 160), org: str(q.org, 120), years: str(q.years, 40) }); }
  return out;
}

function clean(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('profile must be an object');
  var out = {}, c = p.contact || {}, n = p.name || {}, i, k, sw = [], rf = [], ex = [], s, r;
  out.name = { first: str(n.first, 40), last: str(n.last, 40) };
  out.title = str(p.title, 120);
  out.contact = { phone: str(c.phone, 30), email: str(c.email, 120), address: str(c.address, 120), linkedin: str(c.linkedin, 120).replace(/^https?:\/\/(www\.)?/, ''), website: str(c.website, 120) };
  out.profile = str(p.profile, 2000);
  out.highlights = strs(p.highlights, 12, 200);
  if (Array.isArray(p.experience)) for (i = 0; i < p.experience.length && ex.length < 30; i++) { r = role(p.experience[i]); if (r) ex.push(r); }
  out.experience = ex;
  out.core_skills = strs(p.core_skills, 30, 100);
  if (Array.isArray(p.software)) for (i = 0; i < p.software.length && sw.length < 20; i++) {
    s = p.software[i];
    if (s && typeof s === 'object' && str(s.name, 60)) { var o = { name: str(s.name, 60), level: Math.max(0, Math.min(100, Math.round(+s.level) || 60)) }; if (str(s.ats_name, 60)) o.ats_name = str(s.ats_name, 60); sw.push(o); }
  }
  out.software = sw;
  out.qualifications = items(p.qualifications, 20);
  out.additional_experience = items(p.additional_experience, 20);
  out.domains = strs(p.domains, 20, 80);
  if (Array.isArray(p.references)) for (i = 0; i < p.references.length && rf.length < 5; i++) {
    s = p.references[i]; if (s && typeof s === 'object' && str(s.name, 80)) rf.push({ name: str(s.name, 80), lines: strs(s.lines, 4, 120) });
  }
  out.references = rf;
  out.references_note = str(p.references_note, 120);
  for (k in { extra_side: 1, extra_main: 1, side_order: 1, meta: 1 }) if (p[k] && typeof p[k] === 'object') out[k] = p[k];
  if (JSON.stringify(out).length > 100000) fail('profile is too large');
  return out;
}

// The only part of the profile Gemini may see. No name, phone, email, address, LinkedIn, website or references.
function forGemini(p) {
  p = p || {};
  var ex = [], i, r;
  for (i = 0; i < (p.experience || []).length; i++) {
    r = p.experience[i];
    if (r.type === 'milestone') ex.push({ type: 'milestone', date: r.date, title: r.title, company: r.company });
    else ex.push({ type: 'role', start: r.start, end: r.end, title: r.title, company: r.company, location: r.location, bullets: r.bullets || [] });
  }
  return { title: p.title || '', profile: p.profile || '', highlights: p.highlights || [], experience: ex, core_skills: p.core_skills || [], software: (p.software || []).map(function (s) { return s.name; }),
    domains: p.domains || [], qualifications: (p.qualifications || []).map(function (q) { return [q.title, q.org, q.years].filter(Boolean).join(' | '); }) };
}

module.exports = { clean: clean, forGemini: forGemini };
