// node tests/jobdetail_node.js : Reed details parsing and the Gemini read, no network
var d = require('../api/_jobdetail.js'), T = d._t, ok = 0, bad = 0;
function eq(a, b, m) { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { bad++; console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); } }
eq(T.htmlToText('<p>Hello &amp; welcome</p><ul><li>One</li><li>Two&nbsp;x</li></ul><br>End<script>x()</script>'), 'Hello & welcome\n\n• One\n• Two x\n\nEnd', 'html to text');
eq(T.isoDate('14/11/2026'), '2026-11-14', 'dd/mm/yyyy'); eq(T.isoDate('2026-11-14T10:00:00'), '2026-11-14', 'iso'); eq(T.isoDate(''), '', 'empty');
eq(d.reedId('https://www.reed.co.uk/jobs/research-operations-manager/12345678'), '12345678', 'id'); eq(d.reedId('https://www.reed.co.uk/jobs/x/12345678?source=searchResults'), '12345678', 'id with query'); eq(d.reedId('https://www.linkedin.com/jobs/view/abc'), '', 'no id');
var p = T.parseReed({ jobId: 1, jobTitle: 'T', jobDescription: '<p>Do things</p>', contractType: 'permanent', jobType: 'Full Time', salaryType: 'per annum', yearlyMinimumSalary: 50000, yearlyMaximumSalary: 55000, currency: 'GBP', datePosted: '12/11/2026', expirationDate: '10/12/2026', applicationCount: 23, externalUrl: 'https://careers.example.com/apply/1', employerId: 99 });
eq(p, { description: 'Do things', contract: 'Permanent', job_type: 'Full time', salary_type: 'per annum', salary_year: '£50k-£55k', posted: '2026-11-12', expires: '2026-12-10', applicants: 23, apply_url: 'https://careers.example.com/apply/1', employer_id: '99' }, 'parseReed full');
eq(T.parseReed({}), null, 'blank job'); eq(T.parseReed({ jobId: 5, jobTitle: 'T', externalUrl: 'javascript:alert(1)' }).apply_url, undefined, 'unsafe apply url dropped');
eq(T.parseReed({ jobId: 5, fullTime: true }).job_type, 'Full time', 'fullTime flag');
eq(T.parseAi('```json\n{"summary":" S ","requirements":["a","a","b"],"nice_to_have":"x","skills":["RLHF"]}\n```'), { summary: 'S', requirements: ['a', 'b'], nice_to_have: [], skills: ['RLHF'] }, 'parseAi'); eq(T.parseAi('not json'), null, 'bad json');
eq(T.buildPrompt('R', 'C', 'x'.repeat(20000)).length < 13500, true, 'description capped in prompt');
Promise.all([
  d.fetchReed('https://www.reed.co.uk/jobs/x/12345678', 'k', function (id, key) { eq([id, key], ['12345678', 'k'], 'fetch args'); return Promise.resolve({ jobId: 12345678, jobDescription: 'Hi' }); }).then(function (r) { eq(r.description, 'Hi', 'fetchReed'); }),
  d.fetchReed('https://example.com/none', 'k', function () { bad++; }).then(function (r) { eq(r, null, 'no id, no call'); }),
  d.analyse('R', 'C', 'desc', function (p) { return Promise.resolve('{"summary":"s","requirements":["r"],"nice_to_have":[],"skills":["k"]}'); }).then(function (r) { eq(r.skills, ['k'], 'analyse'); }),
  d.analyse('R', 'C', 'desc', function () { return Promise.resolve('nope'); }).then(function () { bad++; console.log('FAIL should throw'); }, function (e) { eq(e.status, 502, 'unreadable throws 502'); })
]).then(function () { console.log(bad ? bad + ' FAILED' : 'PASS (' + ok + ' checks)'); process.exit(bad ? 1 : 0); });
