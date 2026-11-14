// Tailor my CV (v1082). Not an endpoint: used by api/_jobs.js (route ?jobs=tailor, GET ?jobs=cv).
// Gemini only PROPOSES (a list of keywords and wording changes). Code decides what is allowed and builds the CV:
//  - coverage is computed here by matching keywords against the profile (not taken from Gemini);
//  - a proposed change is dropped unless its evidence is an existing line of the profile (or a fact Luc typed) and it adds no new number
//    or capitalised name/tool that is absent from the profile and his answers;
//  - "before" text is read from the profile, never from Gemini; applying is deterministic code.
// Gemini sees cvprofile.forGemini() only (no name, contact details, references) plus the advert and Luc's typed answers.
'use strict';
var cvprofile = require('./_cvprofile.js');

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9£%+#]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function fail(status, msg) { var e = new Error(msg); e.status = status; return e; }
function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

function numbered(fp) {   // the profile as Gemini sees it, with the indices the changes must point at
  var ex = fp.experience.map(function (r, i) {
    return r.type === 'milestone' ? { idx: i, milestone: r.title } : { idx: i, title: r.title, company: r.company, bullets: r.bullets.map(function (b, k) { return { n: k, text: b }; }) };
  });
  return { headline_title: fp.title, summary: fp.profile, highlights: fp.highlights, experience: ex, core_skills: fp.core_skills, software: fp.software, domains: fp.domains };
}
function buildPrompt(fp, role, company, advert, facts) {
  return 'You help tailor one candidate\'s CV to one UK job advert. You may ONLY reword or reorder what the candidate\'s CV already says, plus the EXTRA FACTS if any. ' +
    'NEVER invent or add employers, tools, numbers, achievements or dates. Keep every number exactly as it is. Use the advert\'s own terms where the CV really shows the same thing.\n' +
    'Return JSON with exactly these keys:\n' +
    '"keywords": 12 to 20 objects {"term": short phrase in the advert\'s wording, "synonyms": up to 3 other wordings, "importance": "must" or "nice"};\n' +
    '"changes": up to 10 objects, each {"kind": "title"|"profile"|"bullet"|"skills_order", "role": experience idx (bullet only), "bullet": bullet n (bullet only), "after": new text (for skills_order: the full core_skills array reordered, same items), "why": which requirement it serves (under 120 chars), "evidence": the EXACT existing CV sentence or bullet it rests on (copy it)}.\n' +
    'At most one "profile" change, one "title" change (only a truthful reordering or rewording of a title the candidate has held), one "skills_order", and up to 7 "bullet" changes (reword a bullet; keep its meaning and numbers). Prefer fewer, stronger changes.\n\n' +
    'ROLE: ' + clip(role, 160) + '\nCOMPANY: ' + clip(company, 120) + '\n\nCANDIDATE CV (JSON):\n' + JSON.stringify(numbered(fp)) +
    (facts ? '\n\nEXTRA FACTS typed by the candidate (may be used):\n' + facts : '') + '\n\nADVERT:\n' + String(advert).slice(0, 12000);
}

function corpusOf(fp, facts) { return norm(JSON.stringify(fp).replace(/[{}\[\]":,]/g, ' ') + ' ' + (facts || '')); }
function newFacts(after, corpus) {   // numbers and capitalised names that are not in the profile or Luc's answers
  var bad = [], nums = String(after).match(/£?\d[\d,.]*\s?[%kKmM+]*/g) || [], w = String(after).replace(/[.!?]\s+/g, '. ').split(/\s+/), i, t, n;
  for (i = 0; i < nums.length; i++) { t = norm(nums[i]); if (t && corpus.indexOf(t) < 0) bad.push(nums[i].trim()); }
  for (i = 1; i < w.length; i++) {
    t = w[i].replace(/^[("']+|[)"',.;:!?]+$/g, '');
    if (t.length >= 3 && /^[A-Z]/.test(t) && !/[.!?]$/.test(w[i - 1])) { n = norm(t); if (n && corpus.indexOf(n) < 0) bad.push(t); }
  }
  return bad;
}

function coverage(p, kws) {
  var prose = norm([p.profile].concat(p.highlights || [], (p.experience || []).map(function (r) { return [r.title].concat(r.bullets || []).join(' '); })).join(' ')),
    skills = norm([].concat(p.core_skills || [], (p.software || []).map(function (s) { return s.name; }), p.domains || []).join(' ')), out = [], i, k, terms, j, inP, inS;
  for (i = 0; i < (kws || []).length && out.length < 25; i++) {
    k = kws[i]; if (!k || typeof k !== 'object' || !clip(k.term, 60)) continue;
    terms = [clip(k.term, 60)].concat(Array.isArray(k.synonyms) ? k.synonyms.slice(0, 3).map(function (x) { return clip(x, 60); }) : []);
    inP = inS = false;
    for (j = 0; j < terms.length; j++) { var t = norm(terms[j]); if (!t) continue; if ((' ' + prose + ' ').indexOf(' ' + t) >= 0) inP = true; if ((' ' + skills + ' ').indexOf(' ' + t) >= 0) inS = true; }
    out.push({ term: terms[0], importance: k.importance === 'must' ? 'must' : 'nice', status: inP ? 'covered' : inS ? 'skills_only' : 'missing' });
  }
  return out;
}

function validate(p, raw, facts) {
  var fp = cvprofile.forGemini(p), corpus = corpusOf(fp, facts), out = [], dropped = 0, seen = {}, ch = Array.isArray(raw && raw.changes) ? raw.changes : [], i, c, r, b, before, after, ev, base, ok, k;
  for (i = 0; i < ch.length && out.length < 10; i++) {
    c = ch[i]; ok = false; before = ''; after = '';
    if (!c || typeof c !== 'object') { dropped++; continue; }
    k = c.kind; ev = clip(c.evidence, 600);
    if (k === 'title') { before = p.title || ''; after = clip(c.after, 120); }
    else if (k === 'profile') { before = p.profile || ''; after = clip(c.after, 2000); }
    else if (k === 'bullet') { r = (p.experience || [])[c.role]; b = r && r.type !== 'milestone' ? r.bullets[c.bullet] : null; if (b) { before = b; after = clip(c.after, 600); } }
    else if (k === 'skills_order') {
      before = (p.core_skills || []).join(' | ');
      if (Array.isArray(c.after) && c.after.length === p.core_skills.length) { after = c.after.map(function (x) { return clip(x, 100); }).join(' | '); ok = norm(after.split(' | ').sort().join('|')) === norm(p.core_skills.slice().sort().join('|')) && after !== before; }
    }
    if (k !== 'skills_order') {
      ok = !!after && after !== before && !seen[k + ':' + (c.role === undefined ? '' : c.role + '.' + c.bullet)] && newFacts(after, corpus).length === 0 && ev.length >= 12 && corpus.indexOf(norm(ev)) >= 0;
    }
    if (!ok) { dropped++; continue; }
    seen[k + ':' + (c.role === undefined ? '' : c.role + '.' + c.bullet)] = true;
    base = { id: 'c' + out.length, kind: k, before: before, after: after, why: clip(c.why, 140), evidence: ev };
    if (k === 'bullet') { base.role = c.role; base.bullet = c.bullet; base.where = p.experience[c.role].title + ' · ' + p.experience[c.role].company; }
    out.push(base);
  }
  return { changes: out, dropped: dropped };
}

async function propose(p, role, company, advert, answers, askFn) {
  var fp = cvprofile.forGemini(p), facts = [], a, k, raw;
  for (k in (answers || {})) if (Object.prototype.hasOwnProperty.call(answers, k) && clip(answers[k], 400)) facts.push(clip(k, 60) + ': ' + clip(answers[k], 400));
  facts = facts.slice(0, 8).join('\n');
  try { raw = JSON.parse(String(await askFn(buildPrompt(fp, role, company, advert, facts))).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (e) { if (e && e.status) throw e; throw fail(502, 'Gemini sent back something unreadable'); }
  if (!raw || typeof raw !== 'object') throw fail(502, 'Gemini sent back something unreadable');
  var cov = coverage(p, raw.keywords), v = validate(p, raw, facts), qs = [], i;
  for (i = 0; i < cov.length && qs.length < 5; i++) if (cov[i].importance === 'must' && cov[i].status === 'missing') qs.push({ term: cov[i].term, question: 'Have you done anything involving "' + cov[i].term + '"? Where, and with what result? (Only what you write here can be used.)' });
  return { coverage: cov, changes: v.changes, dropped: v.dropped, questions: qs, answers: answers || {} };
}

// Deterministic: the profile with the ticked changes applied. Returns only the parts that differ for a tailored copy.
function apply(p, changes, ids) {
  var t = JSON.parse(JSON.stringify({ title: p.title, profile: p.profile, experience: p.experience, core_skills: p.core_skills })), i, c, n = 0;
  for (i = 0; i < changes.length; i++) {
    c = changes[i]; if (ids.indexOf(c.id) < 0) continue;
    if (c.kind === 'title') t.title = c.after; else if (c.kind === 'profile') t.profile = c.after;
    else if (c.kind === 'skills_order') t.core_skills = c.after.split(' | ');
    else if (c.kind === 'bullet' && t.experience[c.role] && t.experience[c.role].bullets[c.bullet] === c.before) t.experience[c.role].bullets[c.bullet] = c.after; else continue;
    n++;
  }
  return { tailored: t, applied: n };
}
function merged(p, t) { var o = JSON.parse(JSON.stringify(p)); if (t) { o.title = t.title; o.profile = t.profile; o.experience = t.experience; o.core_skills = t.core_skills; } return o; }

// Plain single-column ATS text and page (same sections as the cv-designer skill's ATS version)
function atsText(d) {
  var L = [], nm = d.name || {}, c = d.contact || {}, i, r, q;
  var sec = function (t) { L.push('', t); }, ul = function (a) { (a || []).forEach(function (x) { L.push('- ' + x); }); };
  L.push(((nm.first || '') + ' ' + (nm.last || '')).toUpperCase().trim(), d.title || '', [c.phone, c.email, c.address, c.linkedin, c.website].filter(Boolean).join(' | '));
  if (d.profile) { sec('PROFESSIONAL SUMMARY'); L.push(d.profile); }
  if ((d.highlights || []).length) { sec('CAREER HIGHLIGHTS'); ul(d.highlights); }
  if ((d.experience || []).length) {
    sec('PROFESSIONAL EXPERIENCE');
    for (i = 0; i < d.experience.length; i++) {
      r = d.experience[i];
      if (r.type === 'milestone') L.push('', r.title + ' - ' + r.company + ' - ' + r.date);
      else { L.push('', [r.title, [r.company, r.location].filter(Boolean).join(' - '), [r.start, r.end].filter(Boolean).join(' – ')].filter(Boolean).join(' | ')); ul(r.bullets); }
    }
  }
  var sw = []; (d.software || []).forEach(function (s) { (s.ats_name || s.name).split('/').forEach(function (x) { sw.push(x.trim()); }); });
  if ((d.core_skills || []).length || sw.length) { sec('TECHNICAL SKILLS'); if (d.core_skills.length) L.push('Core Competencies: ' + d.core_skills.join(' | ')); if (sw.length) L.push('Software & Tools: ' + sw.join(' | ')); }
  if ((d.domains || []).length) { sec('DOMAINS & INDUSTRIES'); L.push(d.domains.join(' | ')); }
  var edu = (d.qualifications || []).concat(d.additional_experience || []);
  if (edu.length) { sec('EDUCATION & PROFESSIONAL DEVELOPMENT'); edu.forEach(function (x) { L.push([x.title, x.org, x.years].filter(Boolean).join(' | ')); }); }
  if ((d.references || []).length || d.references_note) { sec('REFERENCES'); (d.references || []).forEach(function (x) { L.push(x.name + ' - ' + (x.lines || []).join(', ')); }); if (d.references_note) L.push(d.references_note.replace(/^\*/, '')); }
  return L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function atsHtml(d) {
  var lines = atsText(d).split('\n'), h = [], i, l, inList = false;
  for (i = 0; i < lines.length; i++) {
    l = lines[i];
    if (l.indexOf('- ') === 0) { if (!inList) { h.push('<ul>'); inList = true; } h.push('<li>' + esc(l.slice(2)) + '</li>'); continue; }
    if (inList) { h.push('</ul>'); inList = false; }
    if (!l) continue;
    h.push(i === 0 ? '<h1>' + esc(l) + '</h1>' : /^[A-Z][A-Z &]+$/.test(l) && i > 2 ? '<h2>' + esc(l) + '</h2>' : '<p>' + esc(l) + '</p>');
  }
  if (inList) h.push('</ul>');
  return '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>CV</title><style>@page{size:A4;margin:18mm 16mm}body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.35;color:#000}h1{font-size:20pt;margin:0}h2{font-size:11pt;margin:14pt 0 4pt;border-bottom:.75pt solid #000}p{margin:2pt 0}ul{padding-left:14pt;margin:2pt 0}li{margin:1pt 0}</style></head><body>' + h.join('') + '</body></html>';
}

module.exports = { propose: propose, apply: apply, merged: merged, atsText: atsText, atsHtml: atsHtml, _t: { validate: validate, coverage: coverage, newFacts: newFacts, corpusOf: corpusOf, buildPrompt: buildPrompt } };
