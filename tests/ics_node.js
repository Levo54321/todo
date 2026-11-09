// v1071: calendar event details (no network). node tests/ics_node.js
var ics = require('../api/ics.js'), assert = require('assert'), n = 0;
function ok(c, m) { assert.ok(c, m); n++; }
var t = { id: 'x', title: 'Call Priya', due_date: '2026-11-10', remind_time: '09:00', notes: 'Bring laptop, charger; agenda', items: [{ t: 'Agenda', d: true }, { t: 'Slides', d: false }], category: 'Genmedia', prio: 2, quick: true, must: true, recur: 'weekly' };
var d = ics.detailText(t);
ok(/^Bring laptop, charger; agenda/.test(d), 'notes first');
ok(d.indexOf('Sub-tasks:') > 0 && d.indexOf('☑ Agenda') > 0 && d.indexOf('☐ Slides') > 0, 'sub-tasks with state');
ok(d.indexOf('Project: Genmedia') > 0 && d.indexOf('Priority: !!') > 0 && d.indexOf('Quick win') > 0 && d.indexOf('Must do today') > 0 && d.indexOf('Repeats weekly') > 0, 'meta line');
var bare = ics.detailText({ title: 'x' });
ok(bare === 'From your to-do list', 'plain task stays short: ' + bare);
ok(ics.detailText({ notes: new Array(9000).join('a') }).length <= 6000, 'capped');
var line = ics.eventLines(t, '2026-11-09', '20261109T000000Z').filter(function (l) { return /^DESCRIPTION:Bring/.test(l); })[0];
ok(/Bring laptop\\, charger\\; agenda/.test(line) && /\\n/.test(line), 'commas, semicolons and newlines escaped');
console.log('ICS NODE TESTS: all passed (' + n + ')');
