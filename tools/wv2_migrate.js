// Work projects data v2 migration: dry-run report and a guarded apply script. No network, no database access.
//   node tools/wv2_migrate.js rows.json [--sql apply.sql] [--md report.md] [--day YYYY-MM-DD]
// rows.json = what `select id, name, meta from public.work_projects order by pos` returns: [{id, name, meta}, ...].
// The report shows, per project, the link rows before and after (kind and ID added), what was read from them, and warnings.
// The apply script runs in ONE transaction: for each project it logs the complete old meta in work_field_log, then updates
// meta only `where meta = <the meta the report was made from>` (so nothing edited since the dry run is overwritten), and
// raises an error (which rolls everything back) as soon as one project was not updated.
var fs = require('fs'), V = require('../api/_wv2.js');
var a = process.argv.slice(2), file = a[0], sqlOut, mdOut, day;
for (var i = 1; i < a.length; i++) { if (a[i] === '--sql') sqlOut = a[++i]; else if (a[i] === '--md') mdOut = a[++i]; else if (a[i] === '--day') day = a[++i]; }
if (!file) { console.error('usage: node tools/wv2_migrate.js rows.json [--sql apply.sql] [--md report.md] [--day YYYY-MM-DD]'); process.exit(2); }
day = day || new Date().toISOString().slice(0, 10);
var rows = JSON.parse(fs.readFileSync(file, 'utf8')), GROUPS = ['slack', 'groups', 'studies', 'other'];
var LABEL = { slack: 'Slack', groups: 'Prolific groups', studies: 'Prolific studies', other: 'Other links' };
function dq(s) { var t = 'wv2'; while (s.indexOf('$' + t + '$') >= 0) t += 'x'; return '$' + t + '$' + s + '$' + t + '$'; }
var md = ['# Work projects v2 migration: dry run (' + day + ')', ''], sql = ['-- Work projects v2 migration, generated ' + day + ' from the dry run. One transaction; stops (rolls back) if any project changed since.', 'begin;'];
var tot = { projects: rows.length, links: 0, lost: 0, linear: 0, warn: 0, changed: 0, kinds: {} };
rows.forEach(function (r) {
  var before = r.meta || {}, mg = V.migrateMeta(before, day), after = mg.meta, lost = V.lostLinks(before, after), nl = 0;
  GROUPS.forEach(function (g) { nl += ((before.links || {})[g] || []).length; });
  tot.links += nl; tot.lost += lost.length; tot.warn += mg.warnings.length;
  if (after.linear && !(before.linear && before.linear.id)) tot.linear++;
  GROUPS.forEach(function (g) { ((after.links || {})[g] || []).forEach(function (x) { tot.kinds[x.k] = (tot.kinds[x.k] || 0) + 1; }); });
  var same = JSON.stringify(before) === JSON.stringify(after); if (!same) tot.changed++;
  md.push('## ' + r.name + ' (`' + r.id + '`)', '');
  if (!nl) md.push('No links.');
  GROUPS.forEach(function (g) {
    var b = (before.links || {})[g] || [], af = (after.links || {})[g] || [];
    if (!b.length) return;
    md.push('**' + LABEL[g] + '**', '', '| Before (name, link) | After: kind | After: ID |', '|---|---|---|');
    b.forEach(function (x, j) { md.push('| ' + (x.init ? '[initial request] ' : '') + (x.n || '(no name)') + ', ' + x.u + ' | ' + (af[j].k) + ' | ' + (af[j].id || '(none)') + ' |'); });
    md.push('');
  });
  if (after.linear && !(before.linear && before.linear.id)) md.push('Linear ticket read from its link: **' + after.linear.id + '**' + (after.linear.title ? ', title "' + after.linear.title + '" (from the link, capitals approximate)' : ''), '');
  var untouched = ['owner', 'requester', 'recruiter', 'goal', 'success', 'rag', 'dates', 'codes', 'client'].filter(function (k) { return before[k] !== undefined; });
  md.push('Unchanged: ' + (untouched.join(', ') || 'nothing else set') + '. Links lost or renamed: ' + (lost.length ? '**' + lost.join('; ') + '**' : 'none') + '.');
  mg.warnings.forEach(function (w) { md.push('', '> Check: ' + w); });
  md.push('');
  if (!same) {
    sql.push('insert into public.work_field_log (project_id, field, old, new, by, note) values (' + "'" + r.id + "', 'meta', " + dq(JSON.stringify(before)) + '::jsonb, ' + dq(JSON.stringify(after)) + "::jsonb, 'migrate_v2', 'v2 link kinds and IDs');");
    sql.push('do $m$ begin update public.work_projects set meta = ' + dq(JSON.stringify(after)) + "::jsonb, updated_at = now() where id = '" + r.id + "' and meta = " + dq(JSON.stringify(before)) + '::jsonb;');
    sql.push("  if not found then raise exception 'project " + r.id + " changed since the dry run: nothing was applied'; end if; end $m$;");
  }
});
sql.push('commit;');
md.splice(2, 0, 'Summary: ' + tot.projects + ' projects, ' + tot.links + ' link rows, ' + tot.changed + ' projects changed, Linear tickets filled: ' + tot.linear + ', links lost: **' + tot.lost + '**, checks to look at: ' + tot.warn + '. Link kinds after: ' + Object.keys(tot.kinds).map(function (k) { return k + ' ' + tot.kinds[k]; }).join(', ') + '.', '');
if (mdOut) fs.writeFileSync(mdOut, md.join('\n') + '\n'); else console.log(md.join('\n'));
if (sqlOut) fs.writeFileSync(sqlOut, sql.join('\n') + '\n');
process.exit(tot.lost ? 1 : 0);
