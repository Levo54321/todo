// "More like this": a transparent word-weight model for Discover (v1080). Not an endpoint: used by api/_jobs.js.
// Every like/save adds weight to the words of that posting's title (and its company); dismiss/"not for me" takes some away.
// When leads are listed, the weights of the words in a posting's title become a small boost or penalty on its fit score (max +/-25).
// No training run, no hidden state: the weights are one small JSON object (job_feed_cfg.learn) and the boost is shown on the card.
'use strict';

var STOP = { the: 1, and: 1, for: 1, with: 1, of: 1, in: 1, at: 1, to: 1, a: 1, an: 1, on: 1, uk: 1, london: 1, remote: 1, hybrid: 1, ltd: 1, limited: 1, plc: 1 };
var DELTA = { like: 3, save: 3, dislike: -3, dismiss: -1 }, MAX_TERMS = 300, CAP = 15, MAX_BOOST = 25;

function terms(lead) {
  var words = String((lead && lead.role) || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' '), out = [], i, w, c;
  for (i = 0; i < words.length; i++) { w = words[i]; if (w.length >= 3 && !STOP[w] && out.indexOf(w) < 0) out.push(w); }
  c = String((lead && lead.company) || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  if (c) out.push('co:' + c);
  return out.slice(0, 12);
}
function learn(weights, lead, action) {
  var d = DELTA[action], w = {}, k, t = terms(lead), i, keys;
  if (!d) return weights || {};
  for (k in (weights || {})) if (Object.prototype.hasOwnProperty.call(weights, k)) w[k] = weights[k];
  for (i = 0; i < t.length; i++) { w[t[i]] = Math.max(-CAP, Math.min(CAP, (w[t[i]] || 0) + d)); if (w[t[i]] === 0) delete w[t[i]]; }
  keys = Object.keys(w);
  if (keys.length > MAX_TERMS) {          // forget the weakest first
    keys.sort(function (a, b) { return Math.abs(w[a]) - Math.abs(w[b]); });
    for (i = 0; i < keys.length - MAX_TERMS; i++) delete w[keys[i]];
  }
  return w;
}
function boost(weights, lead) {
  var t = terms(lead), s = 0, i;
  for (i = 0; i < t.length; i++) s += (weights && weights[t[i]]) || 0;
  return Math.max(-MAX_BOOST, Math.min(MAX_BOOST, Math.round(s / 2)));
}
// leads from job_leads_list: fit moves by the boost, best first; leads with no fit (LinkedIn) keep null but still carry the boost for ordering
function rank(leads, weights) {
  var out = [], i, l, b;
  for (i = 0; i < leads.length; i++) {
    l = {}; for (var k in leads[i]) if (Object.prototype.hasOwnProperty.call(leads[i], k)) l[k] = leads[i][k];
    b = boost(weights, l); l.boost = b;
    if (typeof l.fit === 'number') l.fit = Math.max(0, Math.min(100, l.fit + b));
    out.push(l);
  }
  out.sort(function (a, c) {
    var fa = typeof a.fit === 'number' ? a.fit : (a.boost - 1000), fc = typeof c.fit === 'number' ? c.fit : (c.boost - 1000);
    return fc - fa || (String(c.created_at) < String(a.created_at) ? -1 : 1);
  });
  return out;
}
module.exports = { terms: terms, learn: learn, boost: boost, rank: rank, DELTA: DELTA };
