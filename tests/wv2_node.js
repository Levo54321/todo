// Work project data v2, no network: node tests/wv2_node.js
// Link parsing (Linear, Prolific, Qualtrics, Sheets), the slug title, the v2 meta keys, enrich-on-save and the migration mapping.
var L = require('../api/_wlinks.js'), V = require('../api/_wv2.js'), W = require('../api/_wpmeta.js'), fails = 0;
function ok(n, c, i) { if (!c) { fails++; console.log('FAIL ' + n + (i ? ' -> ' + i : '')); } else console.log('PASS ' + n); }
function eq(n, a, b) { ok(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' != ' + JSON.stringify(b)); }
function throws(n, f, m) { try { f(); ok(n, false, 'did not throw'); } catch (e) { ok(n, e.bad && (!m || e.message.indexOf(m) >= 0), e.message); } }
var DAY = '2026-11-23', LIN = 'https://linear.app/prolific/issue/HDOR-394/uber-users-in-new-orleans-and-san-fran';

// ---- Linear
var p = L.parse(LIN);
ok('Linear link: kind, ID and slug title (Luc\'s example)', p.kind === 'linear' && p.id === 'HDOR-394' && p.linear.title === 'Uber users in New Orleans and San Fran' && p.service === 'linear', JSON.stringify(p));
eq('Linear: another team prefix and lower case ID', [L.parse('https://linear.app/prolific/issue/ops-12/x').id, L.parse('https://linear.app/prolific/issue/OPS-12').id], ['OPS-12', 'OPS-12']);
ok('Linear: no slug -> no title', L.parse('https://linear.app/prolific/issue/HDOR-1').linear.title === '');
ok('Linear project link is not an issue', L.parse('https://linear.app/prolific/project/uber-abc123').kind === 'other' && L.parse('https://linear.app/prolific/project/uber-abc123').service === 'linear');
ok('http link is refused', L.parse('http://linear.app/prolific/issue/HDOR-394').u === '' && L.parse('not a url').u === '' && L.parse(null).u === '');
eq('slug titles keep places and acronyms', [L.slugTitle('healthcare-professionals-uk'), L.slugTitle('new-users-in-london'), L.slugTitle('gen-z-gamers-us'), L.slugTitle('id-check-refresh'), L.slugTitle('los-angeles-drivers-and-new-york-riders')],
  ['Healthcare professionals UK', 'New users in London', 'Gen z gamers US', 'ID check refresh', 'Los Angeles drivers and New York riders']);
// ---- Prolific, Qualtrics, Sheets, Slack
var ST = 'https://app.prolific.com/researcher/workspaces/studies/65f2a1c9d3e4f5a6b7c8d9e0';
eq('Prolific study ID = text after the last /', L.idFor('prolific_study', ST), '65f2a1c9d3e4f5a6b7c8d9e0');
eq('...also with /overview, a trailing slash, a query or a hash', [L.idFor('prolific_study', ST + '/overview'), L.idFor('prolific_study', ST + '/'), L.idFor('prolific_study', ST + '/overview?x=1#top'), L.idFor('prolific_study', ST + '?tab=1')], Array(4).fill('65f2a1c9d3e4f5a6b7c8d9e0'));
eq('Prolific group ID', [L.idFor('prolific_group', 'https://app.prolific.com/researcher/participant-groups/6641c0e2a9/overview'), L.idFor('prolific_group', 'https://app.prolific.com/researcher/participant-groups/6641c0e2a9')], ['6641c0e2a9', '6641c0e2a9']);
ok('Prolific: no usable ID -> empty (to be typed by hand)', L.idFor('prolific_group', 'https://app.prolific.com/researcher/participant-groups') === '' && L.idFor('prolific_study', 'https://app.prolific.com/researcher/workspaces/studies/') === '' && L.idFor('prolific_group', 'https://app.prolific.com/g/1') === '');
ok('Prolific URL kind by path', L.parse(ST).kind === 'prolific_study' && L.parse('https://app.prolific.com/researcher/participant-groups/6641c0e2a9').kind === 'prolific_group' && L.parse('https://www.prolific.com/blog').kind === 'other');
var q = L.parse('https://prolific.qualtrics.com/jfe/form/SV_abc123XYZ');
ok('Qualtrics form ID', q.kind === 'qualtrics' && q.id === 'SV_abc123XYZ');
var sh = L.parse('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=0');
ok('Google Sheet id and service', sh.kind === 'sheet' && sh.id === '1AbC_dEf-123' && sh.service === 'google_sheets' && L.parse('https://docs.google.com/document/d/1x/edit').service === 'google_docs');
ok('Slack link is a slack link', L.parse('https://prolific.slack.com/archives/C0123/p1700000000000100').kind === 'slack');
eq('kindFor by list', [L.kindFor('slack', { init: true, u: 'x' }), L.kindFor('slack', { u: 'x' }), L.kindFor('groups', {}), L.kindFor('studies', {}), L.kindFor('other', { u: LIN }), L.kindFor('other', { u: 'https://example.com/a' })],
  ['request', 'slack', 'prolific_group', 'prolific_study', 'linear', 'other']);

// ---- v2 keys
var c = W.cleanMeta({ linear: { id: 'hdor-394', url: LIN, title: ' Uber   users ', status: 'In Progress', sla: '2026-11-27', revenue: '18,400', cur: 'usd', description: 'Line1\r\n\r\n\r\nLine2' },
  particip: { source: 'Prolific panel', group_ids: ['6641c0e2a9', ' 6641c0e2a9 ', '6641c0e2b4', ''] },
  deliver: [{ n: 'San Francisco', requested: '600', provided: 530, approved: 396 }, { n: '', requested: null }, { n: 'New Orleans', requested: 400, provided: 261, approved: 195 }],
  activity: { last_slack: { at: '2026-11-21T16:42:00Z', who: 'Priya Nair', where: '#ops', u: 'https://x.slack.com/archives/C1/p1', text: 'NOLA at 261' } },
  prov: { 'linear.title': { by: 'auto', src: LIN, at: DAY }, 'BAD KEY': { by: 'luc' }, 'dates.due': { by: 'robot' } } });
ok('linear cleaned (ID upper-cased, revenue number, tidy text)', c.linear.id === 'HDOR-394' && c.linear.title === 'Uber users' && c.linear.revenue === 18400 && c.linear.cur === 'USD' && c.linear.description === 'Line1\n\nLine2' && c.linear.sla === '2026-11-27');
ok('particip: group IDs de-duplicated', JSON.stringify(c.particip) === '{"source":"Prolific panel","group_ids":["6641c0e2a9","6641c0e2b4"]}');
ok('deliver: empty row dropped, numbers kept', c.deliver.length === 2 && c.deliver[0].requested === 600 && c.deliver[1].approved === 195);
ok('activity.last_slack kept', c.activity.last_slack.who === 'Priya Nair' && c.activity.last_slack.u.indexOf('https://') === 0);
ok('prov: only valid keys and authors survive', Object.keys(c.prov).join() === 'linear.title');
eq('null clears a v2 key', W.cleanMeta({ linear: null, deliver: null, particip: null, activity: null, prov: null }), { linear: null, particip: null, deliver: null, activity: null, prov: null });
throws('bad Linear ID refused', function () { W.cleanMeta({ linear: { id: 'nope' } }); }, 'Linear ID');
throws('http Linear link refused', function () { W.cleanMeta({ linear: { url: 'http://linear.app/x/issue/A-1' } }); }, 'https');
throws('negative number refused', function () { W.cleanMeta({ deliver: [{ n: 'x', requested: -1 }] }); }, 'requested');
throws('bad SLA refused', function () { W.cleanMeta({ linear: { sla: 'Friday' } }); }, 'SLA');
throws('too many segments refused', function () { var a = []; for (var i = 0; i < 26; i++) a.push({ n: 's' + i, requested: 1 }); W.cleanMeta({ deliver: a }); }, 'at most');
var lk = W.cleanMeta({ links: { slack: [{ n: 'Req', u: 'https://x.slack.com/a', init: true, k: 'request' }], groups: [{ n: 'G', u: 'https://app.prolific.com/a', k: 'linear', id: 'abc12345' }], other: [{ n: 'Q', u: 'https://q.qualtrics.com/jfe/form/SV_1', k: 'qualtrics', id: 'SV_1' }] } }).links;
ok('link rows keep k and id; a kind that does not fit the list is dropped', lk.slack[0].k === 'request' && !('k' in lk.groups[0]) && lk.groups[0].id === 'abc12345' && lk.other[0].k === 'qualtrics' && lk.other[0].id === 'SV_1');

// ---- enrich on save (the legacy form sends rows without k/id)
var existing = { links: { other: [{ n: 'Linear', u: LIN, k: 'linear', id: 'HDOR-394' }], studies: [{ n: 'Main', u: ST, k: 'prolific_study', id: 'edited-by-hand' }] }, linear: { id: 'HDOR-394', title: 'Corrected title' } };
var legacy = W.cleanMeta({ links: { other: [{ n: 'Linear', u: LIN }, { n: 'Form', u: 'https://x.qualtrics.com/jfe/form/SV_zz9' }], studies: [{ n: 'Main', u: ST }, { n: 'New', u: ST + '99' }] } });
var en = V.enrich(existing, legacy, DAY);
ok('legacy save: kind and a hand-edited ID carried over by URL', en.links.other[0].k === 'linear' && en.links.studies[0].id === 'edited-by-hand');
ok('legacy save: new rows get kind and ID from the URL', en.links.other[1].k === 'qualtrics' && en.links.other[1].id === 'SV_zz9' && en.links.studies[1].id === '65f2a1c9d3e4f5a6b7c8d9e099');
ok('legacy save: stored Linear fields are not overwritten', !('linear' in en) && !('prov' in en));
var en2 = V.enrich({}, W.cleanMeta({ links: { other: [{ n: 'Linear', u: LIN }] } }), DAY);
ok('first Linear link fills meta.linear with provenance "auto"', en2.linear.id === 'HDOR-394' && en2.linear.title === 'Uber users in New Orleans and San Fran' && en2.prov['linear.id'].by === 'auto' && en2.prov['linear.id'].src === LIN && en2.prov['linear.id'].at === DAY);
ok('a patch without links is returned untouched', V.enrich({}, { rag: 'a' }, DAY).rag === 'a' && !V.enrich({}, { rag: 'a' }, DAY).links);

// ---- migration of old meta
var OLD = { owner: 'aaaaaaaaaaa1', goal: 'G', rag: 'a', dates: { due: '2026-12-04' }, codes: [{ n: 'SF', c: 'X-1' }],
  links: { slack: [{ n: 'Initial ask', u: 'https://p.slack.com/archives/C1/p1', init: true }, { n: '#ops thread', u: 'https://p.slack.com/archives/C2/p2' }],
           groups: [{ n: 'SF group', u: 'https://app.prolific.com/researcher/participant-groups/6641c0e2a9/overview' }, { n: 'Odd group', u: 'https://app.prolific.com/g/1' }],
           studies: [{ n: 'Screener', u: ST }, { n: 'Main', u: ST + '/overview' }],
           other: [{ n: 'Linear', u: LIN }, { n: 'Tracker', u: sh.u }, { n: 'Form', u: q.u }, { n: 'Notion', u: 'https://notion.so/page' }, { n: 'Second ticket', u: 'https://linear.app/prolific/issue/HDOR-111/other' }] } };
var mg = V.migrateMeta(OLD, DAY), nm = mg.meta;
eq('every old key and value is still there', [nm.owner, nm.goal, nm.rag, nm.dates, nm.codes], [OLD.owner, OLD.goal, OLD.rag, OLD.dates, OLD.codes]);
eq('no link lost, renamed or moved', V.lostLinks(OLD, nm), []);
eq('kinds', [nm.links.slack[0].k, nm.links.slack[1].k, nm.links.groups[0].k, nm.links.studies[0].k, nm.links.other.map(function (r) { return r.k; }).join()], ['request', 'slack', 'prolific_group', 'prolific_study', 'linear,sheet,qualtrics,other,linear']);
eq('IDs read from the links', [nm.links.groups[0].id, nm.links.studies[0].id, nm.links.studies[1].id, nm.links.other[1].id, nm.links.other[2].id], ['6641c0e2a9', '65f2a1c9d3e4f5a6b7c8d9e0', '65f2a1c9d3e4f5a6b7c8d9e0', '1AbC_dEf-123', 'SV_abc123XYZ']);
ok('first Linear link becomes meta.linear (ID, url, slug title, provenance auto)', nm.linear.id === 'HDOR-394' && nm.linear.url === LIN && nm.linear.title === 'Uber users in New Orleans and San Fran' && nm.prov['linear.title'].by === 'auto' && nm.sv === 2);
ok('warnings: the group with no readable ID, and the second Linear ticket', mg.warnings.some(function (w) { return w.indexOf('Odd group') >= 0; }) && mg.warnings.some(function (w) { return w.indexOf('1 more Linear') >= 0; }), JSON.stringify(mg.warnings));
var mg2 = V.migrateMeta(nm, DAY);
ok('idempotent: migrating twice changes nothing', JSON.stringify(mg2.meta) === JSON.stringify(nm) && mg2.changes.length === 0, JSON.stringify(mg2.changes));
ok('does not overwrite a Linear title Luc corrected', V.migrateMeta(Object.assign({}, nm, { linear: Object.assign({}, nm.linear, { title: 'Uber users in New Orleans and San Francisco' }) }), DAY).meta.linear.title === 'Uber users in New Orleans and San Francisco');
var e1 = V.migrateMeta({}, DAY), e2 = V.migrateMeta(null, DAY);
ok('empty and missing meta are left as they are', JSON.stringify(e1.meta) === '{}' && JSON.stringify(e2.meta) === '{}' && e1.changes.length === 0);
ok('a project with links but none matching still migrates', V.migrateMeta({ links: { other: [{ n: 'Doc', u: 'https://example.com/x' }] } }, DAY).meta.links.other[0].k === 'other');
ok('the migrated meta passes the same cleaning the app applies on save', (function () { try { W.cleanMeta({ links: nm.links, linear: nm.linear, prov: nm.prov }); return true; } catch (e) { console.log(e.message); return false; } })());
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
