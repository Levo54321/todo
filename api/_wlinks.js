// Work project links (v2): what a pasted URL is, its ID, and the Linear ticket title from its slug. Pure functions, no
// requires, so the same code can be copied to the browser module (public/wp/) and is covered by tests/wv2_node.js.
// A leading _ means this file is not a serverless function of its own (12-function limit).
//
// kind (stored on a link row as `k`): request | slack | linear | prolific_group | prolific_study | prolific_project | qualtrics | sheet | other
// service (never stored, drives the icon): slack | linear | prolific | qualtrics | google_sheets | google_docs | other
// ID rules (Luc, 23 Nov 2026): a Prolific group/study ID is the text after the last "/" of the link, ignoring a trailing
// "/overview" and any ?query or #hash; it can be edited by hand. A Linear ID looks like HDOR-394 (any team prefix).
var LINEAR = /^\/([^/]+)\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/([^/?#]+))?/;
var ID_OK = /^[A-Za-z0-9_-]{6,64}$/;
var KINDS = ['request', 'slack', 'linear', 'prolific_group', 'prolific_study', 'prolific_project', 'qualtrics', 'sheet', 'other'];

// Capital letters the slug lost: first word, places, acronyms. "san X" and the pairs below are capitalised together.
var PLACES = ('london paris berlin madrid rome dublin cardiff manchester birmingham glasgow edinburgh leeds bristol liverpool chicago boston seattle austin dallas houston miami atlanta denver phoenix ' +
  'sacramento portland toronto vancouver montreal mumbai delhi sydney melbourne america europe asia africa canada mexico brazil india china japan germany france spain italy australia ireland scotland wales england ' +
  'california texas florida ohio nevada oregon washington georgia arizona colorado netherlands poland sweden norway denmark finland nigeria kenya philippines indonesia turkey ' +
  'uber lyft doordash roblox duolingo spotify netflix google amazon linkedin whatsapp youtube tiktok instagram facebook twitter prolific qualtrics').split(' ');
var ACRONYMS = ('uk us usa eu uae id ai api ux ui gdpr nps csat kyc sla qa nda pdf csv url faq cv hr it').split(' ');
var PAIRS = { new: 'orleans york jersey zealand delhi mexico hampshire england south', los: 'angeles', las: 'vegas', hong: 'kong', united: 'states kingdom arab', south: 'africa korea carolina dakota america', north: 'carolina dakota america', rio: 'de', salt: 'lake', saint: '*', st: '*', san: '*', santa: '*' };

function cap(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
function slugTitle(slug) {
  var s = String(slug || ''); try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
  var w = s.split('-').filter(function (x) { return x; }), out = [], i, lw, nx;
  for (i = 0; i < w.length; i++) {
    lw = w[i].toLowerCase(); nx = (w[i + 1] || '').toLowerCase();
    if (ACRONYMS.indexOf(lw) >= 0) out.push(lw.toUpperCase());
    else if (PAIRS[lw] && nx && (PAIRS[lw] === '*' || PAIRS[lw].split(' ').indexOf(nx) >= 0)) { out.push(cap(lw)); out.push(cap(nx)); i++; }
    else if (PLACES.indexOf(lw) >= 0 || i === 0) out.push(cap(w[i]));
    else out.push(w[i]);
  }
  if (out.length && ACRONYMS.indexOf(out[0].toLowerCase()) < 0) out[0] = cap(out[0]);
  return out.join(' ');
}

function host(u) { try { var x = new URL(u); return x.protocol === 'https:' ? x : null; } catch (e) { return null; } }
function segments(x) { return x.pathname.split('/').filter(function (s) { return s; }); }
function lastId(x) { // the text after the last "/", skipping a trailing "/overview"
  var s = segments(x); if (s.length && s[s.length - 1].toLowerCase() === 'overview') s.pop();
  var id = s.length ? s[s.length - 1] : ''; try { id = decodeURIComponent(id); } catch (e) { return ''; }
  return ID_OK.test(id) && !/^(studies|groups|participant-groups|workspaces|researcher|overview)$/i.test(id) ? id : '';
}
function hostIs(h, d) { return h === d || h.slice(-(d.length + 1)) === '.' + d; }

// What a URL is on its own (no list context). -> {u, service, kind, id?, linear?}; {u:'', service:'', kind:'other'} when not an https link.
function parse(url) {
  var raw = typeof url === 'string' ? url.trim() : '', x = host(raw), h, p, m;
  if (!x) return { u: '', service: '', kind: 'other' };
  h = x.hostname.toLowerCase(); p = x.pathname;
  var out = { u: raw, service: 'other', kind: 'other' };
  if (hostIs(h, 'linear.app')) {
    out.service = 'linear'; m = LINEAR.exec(p);
    if (m) { out.kind = 'linear'; out.id = m[2].toUpperCase(); out.linear = { id: out.id, team: m[1], slug: m[3] || '', title: m[3] ? slugTitle(m[3]) : '' }; }
  } else if (hostIs(h, 'slack.com')) { out.service = 'slack'; out.kind = 'slack'; }
  else if (hostIs(h, 'prolific.com') || hostIs(h, 'prolific.co')) {
    out.service = 'prolific';
    if (/\/(studies|study)(\/|$)/i.test(p)) { out.kind = 'prolific_study'; out.id = lastId(x) || undefined; }
    else if (/\/projects?(\/|$)/i.test(p)) { out.kind = 'prolific_project'; out.id = lastId(x) || undefined; }
    else if (/\/(participant-)?groups?(\/|$)/i.test(p)) { out.kind = 'prolific_group'; out.id = lastId(x) || undefined; }
  } else if (hostIs(h, 'qualtrics.com')) { out.service = 'qualtrics'; out.kind = 'qualtrics'; m = /(SV_[A-Za-z0-9]+)/.exec(p); if (m) out.id = m[1]; }
  else if (h === 'docs.google.com' && /^\/spreadsheets\//.test(p)) { out.service = 'google_sheets'; out.kind = 'sheet'; m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(p); if (m) out.id = m[1]; }
  else if (h === 'docs.google.com' || h === 'drive.google.com') out.service = 'google_docs';
  if (out.id === undefined) delete out.id;
  return out;
}

// The kind of a stored row from the list it sits in (legacy lists: slack, groups, studies, other).
function kindFor(group, row) {
  if (group === 'slack') return row && row.init ? 'request' : 'slack';
  if (group === 'groups') return 'prolific_group';
  if (group === 'studies') return parse(row && row.u).kind === 'prolific_project' ? 'prolific_project' : 'prolific_study'; // the old "Prolific Studies" list also holds project links
  var k = parse(row && row.u).kind; return k === 'request' ? 'other' : k;
}
// The ID of a stored row: Prolific IDs from the last path segment; Linear/Qualtrics/Sheets from the link.
function idFor(kind, url) {
  var x = host(typeof url === 'string' ? url.trim() : ''); if (!x) return '';
  if (kind === 'prolific_group' || kind === 'prolific_study' || kind === 'prolific_project') return lastId(x);
  var p = parse(url); return p.kind === kind && p.id ? p.id : '';
}
function isKind(k) { return KINDS.indexOf(k) >= 0; }

module.exports = { parse: parse, slugTitle: slugTitle, kindFor: kindFor, idFor: idFor, isKind: isKind, KINDS: KINDS, ID_OK: ID_OK };
