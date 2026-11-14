// node tests/jobfeed_node.js : Reed feed maths and search with a stubbed network (no key, no internet)
var f = require('../api/_jobfeed.js'), T = f._t, ok = 0, bad = 0;
function eq(a, b, m) { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { bad++; console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); } }
eq(T.has('rlhf and llm', 'LLM'), true, 'word match'); eq(T.has('small llms', 'LLM'), false, 'no partial word'); eq(T.has('x', ''), false, 'empty term');
eq(T.isRemote({ jobTitle: 'Ops lead', jobDescription: 'Fully remote role' }), true, 'remote'); eq(T.isRemote({ jobTitle: 'Ops lead', jobDescription: 'Office in London' }), false, 'not remote');
eq(T.expired({ expirationDate: '01/01/2026' }, '2026-11-14'), true, 'expired'); eq(T.expired({ expirationDate: '31/12/2026' }, '2026-11-14'), false, 'live');
eq(T.salary({ minimumSalary: 60000, maximumSalary: 75000, currency: 'GBP' }), '£60k-£75k', 'range'); eq(T.salary({ minimumSalary: 0, maximumSalary: 0 }), '', 'none'); eq(T.salary({ minimumSalary: 500, maximumSalary: 500, currency: 'USD' }), '', 'not GBP');
eq(T.score({ jobTitle: 'RLHF lead', jobDescription: 'LLM red teaming annotation quality assurance delivery' }, ['RLHF', 'LLM', 'red teaming', 'annotation', 'quality assurance', 'delivery', 'SLA']).fit, 100, 'six skills = 100');
eq(T.score({ jobTitle: 'Chef', jobDescription: 'cook' }, ['RLHF']).n, 0, 'no match');
eq(T.authHeader('abc'), 'Basic ' + Buffer.from('abc:').toString('base64'), 'basic auth');
var calls = [], R = function (id, t, d, loc, extra) { var o = { jobId: id, jobTitle: t, employerName: 'Co' + id, locationName: loc || 'London', jobDescription: d, jobUrl: 'https://www.reed.co.uk/jobs/x/' + id, expirationDate: '31/12/2026', minimumSalary: 60000, maximumSalary: 70000, currency: 'GBP' }; for (var k in extra) o[k] = extra[k]; return o; };
var get = function (url) {
  calls.push(url);
  if (url.indexOf('remote') >= 0) return Promise.resolve({ results: [R(2, 'AI Ops', 'fully remote LLM annotation', 'Cardiff'), R(3, 'AI Ops 2', 'LLM office based', 'Leeds')] });
  return Promise.resolve({ results: [R(1, 'RLHF Programme Lead', 'LLM annotation evaluation', 'London'), R(2, 'AI Ops', 'fully remote LLM annotation', 'Cardiff'), R(4, 'Old', 'LLM', 'London', { expirationDate: '01/01/2020' }), R(5, 'Barista', 'coffee', 'London'), R(6, 'Bad link', 'LLM', 'London', { jobUrl: 'https://evil.example/x' })] });
};
f.search({ keywords: ['AI ops'], skills: ['RLHF', 'LLM', 'annotation', 'evaluation'] }, 'k', '2026-11-14', get).then(function (r) {
  eq(calls.length, 2, 'two searches per keyword'); eq(calls[0].indexOf('locationName=London&distanceFromLocation=15') > 0, true, 'London radius');
  eq(r.leads.map(function (l) { return l.url.slice(-1); }), ['1', '2'], 'kept 1 and 2 only (3 not remote, 4 expired, 5 no skill, 6 bad link), best first');
  eq(r.leads[1].mode, 'remote', 'remote mode'); eq(r.leads[1].location, 'Remote', 'remote location shown'); eq(r.leads[0].salary, '£60k-£70k', 'salary');
  return f.search({ keywords: ['a'], skills: ['x'] }, 'k', '2026-11-14', function () { return Promise.reject(Object.assign(new Error('Reed refused the key'), { status: 502 })); }).then(function () { bad++; console.log('FAIL should throw'); }, function (e) { eq(e.status, 502, 'all failed throws'); });
}).then(function () {
  eq(f.stale({ last_run: null }, Date.now()), true, 'never run is stale'); eq(f.stale({ last_run: new Date(Date.now() - 3600e3).toISOString() }, Date.now()), false, 'fresh');
  eq(f.cleanList([' a ', 'a', '', 'b'], 5), ['a', 'b'], 'cleanList'); eq(f.cleanList('x', 5), null, 'not a list');
  console.log(bad ? bad + ' FAILED' : 'PASS (' + ok + ' checks)'); process.exit(bad ? 1 : 0);
});
