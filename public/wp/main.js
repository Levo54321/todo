/* Work projects, new Mac / iPhone section (v1088). Modern JS: an ES module that only browsers with module support run (so not the iPad 2, which
   keeps the legacy ES5 Projects pages on the same data). Rules: docs/handover/WORK-PROJECTS-REDESIGN.md and CLAUDE.md.
   Layout: a project list that is always on screen; the right side is the overview (list or task board) or, after a click on a project, that project's page.
   Data: GET /api/projects?v2=overview (all projects + meta in one call), PATCH ?id=&meta=1 (per-field saves), PATCH ?next= (Next task).
   Link parsing: /wp/wlinks.js (a copy of api/_wlinks.js made by tools/build.py; kinds and IDs shared with the server). */
const App = window.App;
if (!App || !App.register) throw new Error('luc-todo shell not found');
const { esc, store } = App;
const VER = new URL(import.meta.url).searchParams.get('v') || '';
const api = (m, q, b) => new Promise(r => App.api(m, q, b, (s, d) => r({ s, d: d || {} }), '/api/projects'));
const rd = k => { try { return store.get(k) || ''; } catch { return ''; } };
const wr = (k, v) => { try { store.set(k, v); } catch { /* private mode */ } };
const OFF = rd('wpxOff') === '1'; // localStorage wpxOff=1 keeps the earlier ES5 Projects pages (used by the legacy test suites; an escape hatch)
const WL = {}; // filled by wlinks.js: parse, kindFor, idFor, slugTitle
const wlReady = new Promise(res => { const s = document.createElement('script'); s.src = '/wp/wlinks.js?v=' + VER; s.onload = () => { Object.assign(WL, window.WLinks || {}); res(); }; s.onerror = res; document.head.appendChild(s); });

const S = {
  list: [], people: [], clients: [], loaded: false, busy: false, at: 0, sig: '', err: '', msg: '',
  sel: rd('wpxSel'), tab: rd('wpxTab') === 'board' ? 'board' : 'list', filter: rd('wpxFilter') || 'active', client: rd('wpxClient'), sort: rd('wpxSort') || 'deadline', q: '',
  pt: 'tasks', edit: null, adding: false, cleaned: {}, focusQ: false
};
const $pane = () => document.getElementById('wxPane');
const byId = id => S.list.find(p => p.id === id);
const today = () => App.today();
const D = iso => new Date(iso + 'T12:00:00');
const fmtDay = iso => iso ? D(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const daysTo = iso => iso ? Math.round((D(iso) - D(today())) / 864e5) : null;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const when = n => n < 0 ? plural(-n, 'day') + ' overdue' : n === 0 ? 'today' : 'in ' + plural(n, 'day');
const dlCls = n => n === null ? '' : n < 0 ? 'wx-od' : n <= 3 ? 'wx-soon' : '';
const deadline = p => (p.meta.dates || {}).due || '';
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const short = id => id && id.length > 10 ? id.slice(0, 6) + '…' + id.slice(-3) : id || '';
const get = (p, f) => { const [a, b] = f.split('.'); const v = b ? (p.meta[a] || {})[b] : p.meta[a]; return v == null ? '' : v; };
const person = id => S.people.find(x => x.id === id);
const pname = id => { const x = person(id); return x ? x.name + (x.removed ? ' (removed)' : '') : ''; };
const clientOf = p => S.clients.find(c => c.id === p.meta.client);
const ticket = p => (p.meta.linear || {}).id || '';
function prog(p) {
  let req = 0, pr = 0, ap = 0; const rows = p.meta.deliver || [];
  rows.forEach(r => { req += r.requested || 0; pr += r.provided || 0; ap += r.approved || 0; });
  return { req, pr, ap, rows, pct: req > 0 ? Math.round(100 * pr / req) : null };
}
const fmtNum = n => (n || 0).toLocaleString('en-GB');
const money = p => { const v = (p.meta.linear || {}).revenue; if (v === undefined || v === '') return ''; try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (p.meta.linear || {}).cur || 'USD', maximumFractionDigits: 0 }).format(v); } catch { return String(v); } };

/* ---------- tasks ---------- */
function openTasks(p) {
  const l = App.boardTasks ? App.boardTasks(p.id) : null;
  return l || App.todos().filter(t => t.list === 'work' && !t.done && t.category === p.name);
}
function taskSplit(p) {
  const all = openTasks(p), nx = p.next ? all.find(t => t.id === p.next) || null : null;
  return { all, next: nx, rest: nx ? all.filter(t => t !== nx) : all };
}
function taskHTML(t, isNext) {
  const od = t.due_date && t.due_date < today(), td = t.due_date === today();
  const d = [t.due_date ? (od ? 'Overdue · ' + fmtDay(t.due_date) : td ? 'Due today' : fmtDay(t.due_date)) : '', t.paused ? 'Paused' : '', t.blocked ? 'Blocked' : ''].filter(Boolean).join(' · ');
  return `<li class="wx-task${isNext ? ' nx' : ''}" id="wx-i-${esc(t.id)}"><button class="wx-tk" data-act="tick" data-id="${esc(t.id)}" aria-label="Mark done"></button>` +
    `<div class="wx-tb" data-act="edit" data-id="${esc(t.id)}">${isNext ? '<span class="wx-nxl">Next up</span>' : ''}<div class="wx-tt">${esc(t.title)}</div>${d ? `<div class="wx-td ${od ? 'wx-od' : td ? 'wx-soon' : ''}">${esc(d)}</div>` : ''}</div>` +
    `<button class="wx-pin" data-wpx="next" data-id="${esc(t.id)}" aria-label="${isNext ? 'Clear next task' : 'Make this the next task'}" title="${isNext ? 'Clear the next task' : 'Make this the next task'}">${isNext ? '★' : '☆'}</button></li>`;
}

/* ---------- data ---------- */
async function loadOverview() {
  if (!App.token()) { App.whenToken(loadOverview); return; }
  if (S.busy) return; S.busy = true;
  const { s, d } = await api('GET', '?v2=overview');
  S.busy = false;
  if (s === 200 && d.projects) {
    S.err = ''; S.at = Date.now();
    const sig = JSON.stringify(d);
    if (sig !== S.sig) { S.sig = sig; S.list = d.projects.map(p => ({ ...p, meta: p.meta || {} })); S.people = d.people || []; S.clients = d.clients || []; S.loaded = true; paint(); }
    else if (!S.loaded) { S.loaded = true; paint(); }
  } else if (!S.loaded) { S.err = 'Could not load the projects.'; paint(); }
}
async function saveMeta(p, patch) {
  const before = {};
  Object.keys(patch).forEach(k => { before[k] = p.meta[k]; });
  Object.keys(patch).forEach(k => { if (patch[k] === null) delete p.meta[k]; else p.meta[k] = patch[k]; });
  S.msg = ''; paint(true);
  const { s, d } = await api('PATCH', `?id=${p.id}&meta=1`, { meta: patch });
  if (s === 200 && d.meta) { p.meta = d.meta; if (d.people) S.people = d.people; if (d.clients) S.clients = d.clients; S.sig = ''; }
  else { Object.keys(before).forEach(k => { if (before[k] === undefined) delete p.meta[k]; else p.meta[k] = before[k]; }); S.msg = d.error || 'Could not save, try again'; }
  paint(true);
}
async function saveCore(p, body) { // status / priority: the older route
  const { s, d } = await api('PATCH', `?id=${p.id}`, body);
  if (s === 200 && d.projects) { const n = d.projects.find(x => x.id === p.id); if (n) { p.status = n.status || 'active'; p.prio = n.prio || 0; } if (App.reload) App.reload(); }
  else S.msg = d.error || 'Could not save, try again';
  paint(true);
}
async function setNext(p, id) {
  const old = p.next || null, nid = old === id ? null : id; p.next = nid; paint(true);
  const { s, d } = await api('PATCH', `?next=${p.id}`, { task: nid });
  if (s !== 200) { p.next = old; S.msg = d.error || 'Could not set the next task'; paint(true); }
}

/* ---------- field editing ---------- */
const FIELDS = {
  requester: { t: 'person', label: 'Requester' }, owner: { t: 'person', label: 'Owner' }, recruiter: { t: 'person', label: 'Recruiter' }, client: { t: 'client', label: 'Client' },
  'dates.requested': { t: 'date', label: 'Requested' }, 'dates.started': { t: 'date', label: 'Started' }, 'dates.target': { t: 'date', label: 'Target' }, 'dates.due': { t: 'date', label: 'Deadline' },
  'linear.status': { t: 'text', label: 'Status' }, 'linear.sla': { t: 'date', label: 'SLA due' }, 'linear.revenue': { t: 'number', label: 'Revenue' }, 'linear.title': { t: 'text', label: 'Title' },
  'particip.group_ids': { t: 'ids', label: 'Group IDs' }, 'particip.source': { t: 'text', label: 'Source' },
  goal: { t: 'long', label: 'Goal' }, success: { t: 'long', label: 'Success criteria' }
};
const ORDER = ['requester', 'owner', 'recruiter', 'client', 'dates.requested', 'dates.started', 'dates.target', 'dates.due', 'linear.title', 'linear.status', 'linear.sla', 'linear.revenue', 'particip.group_ids', 'particip.source', 'goal', 'success'];
const provOf = (p, f) => (p.meta.prov || {})[f];
const provDot = (p, f) => { const v = provOf(p, f); return v && v.by !== 'luc' ? `<i class="wx-pv ${v.by}" title="${v.by === 'claude' ? 'Set by Claude' : 'Read from the link'}${v.at ? ', ' + fmtDay(v.at) : ''}"></i>` : ''; };
function show(p, f, v) {
  const t = FIELDS[f].t;
  if (v === '' || v == null) return '';
  if (t === 'person') return esc(pname(v));
  if (t === 'client') { const c = S.clients.find(x => x.id === v); return c ? esc(c.name) : ''; }
  if (t === 'date') return esc(fmtDay(v));
  if (t === 'number') return esc(money(p));
  if (t === 'ids') return '';
  return esc(String(v));
}
function ids(p) { // Group IDs: those read from Prolific group links, then the plain codes typed by hand
  const out = [], L = p.meta.links || {};
  (L.groups || []).forEach(r => { const id = r.id || (WL.idFor ? WL.idFor('prolific_group', r.u) : ''); if (id && !out.includes(id)) out.push(id); });
  ((p.meta.particip || {}).group_ids || []).forEach(id => { if (!out.includes(id)) out.push(id); });
  return out;
}
function cell(p, f) {
  const def = FIELDS[f], v = f === 'particip.group_ids' ? ((p.meta.particip || {}).group_ids || []).join(', ') : get(p, f);
  if (S.edit && S.edit.id === p.id && S.edit.f === f) {
    let h;
    if (def.t === 'person') h = `<select class="wx-in" data-wpx-in="edit" data-focus><option value="">Not set</option>${S.people.filter(x => !x.removed || x.id === v).map(x => `<option value="${esc(x.id)}"${x.id === v ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    else if (def.t === 'client') h = `<select class="wx-in" data-wpx-in="edit" data-focus><option value="">Internal</option>${S.clients.map(x => `<option value="${esc(x.id)}"${x.id === v ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    else if (def.t === 'date') h = `<input class="wx-in" type="date" data-wpx-in="edit" data-focus value="${esc(v)}">`;
    else if (def.t === 'long') h = `<textarea class="wx-in" data-wpx-in="edit" data-focus maxlength="2000">${esc(v)}</textarea>`;
    else h = `<input class="wx-in" type="${def.t === 'number' ? 'number' : 'text'}" ${def.t === 'number' ? 'min="0" step="any"' : ''} data-wpx-in="edit" data-focus maxlength="${def.t === 'ids' ? 400 : 200}" value="${esc(v)}"${def.t === 'ids' ? ' placeholder="6641c0e2a9, 6641c0e2b4"' : ''}>`;
    return h;
  }
  if (def.t === 'ids') {
    const l = ids(p);
    return `<button class="wx-ed" data-wpx="edit" data-f="${f}">${l.length ? '<span class="wx-ids">' + l.map(i => `<code class="wx-code" data-wpx="copy" data-v="${esc(i)}" title="Copy">${esc(short(i))}</code>`).join('') + '</span>' : '<span class="wx-ph">Add</span>'}</button>`;
  }
  const txt = show(p, f, v);
  return `<button class="wx-ed${txt ? '' : ' empty'}${def.t === 'long' ? ' block' : ''}" data-wpx="edit" data-f="${f}">${txt || '<span class="wx-ph">' + (def.t === 'long' ? 'Add ' + def.label.toLowerCase() : 'Add') + '</span>'}${provDot(p, f)}</button>`;
}
const row = (p, f) => `<div class="wx-kv"><dt>${FIELDS[f].label}</dt><dd>${cell(p, f)}</dd></div>`;
function patchFor(p, f, raw) {
  const [a, b] = f.split('.'); let v = raw;
  if (FIELDS[f].t === 'number') v = raw === '' ? '' : Number(raw);
  if (FIELDS[f].t === 'ids') v = [...new Set(String(raw).split(/[\s,;]+/).filter(Boolean))];
  const empty = v === '' || (Array.isArray(v) && !v.length);
  const patch = {};
  if (!b) patch[a] = empty ? null : v;
  else {
    const cur = { ...(p.meta[a] || {}) };
    if (empty) delete cur[b]; else cur[b] = v;
    patch[a] = Object.keys(cur).length ? cur : null;
  }
  const prov = { ...(p.meta.prov || {}) };
  if (empty) delete prov[f]; else prov[f] = { by: 'luc', at: today() };
  patch.prov = Object.keys(prov).length ? prov : null;
  return patch;
}
function sameValue(p, f, raw) {
  const cur = FIELDS[f].t === 'ids' ? ((p.meta.particip || {}).group_ids || []).join(', ') : String(get(p, f));
  return String(raw).trim() === cur.trim();
}
function commitEdit(el, how) {
  const ed = S.edit; if (!ed) return; S.edit = null;
  const p = byId(ed.id);
  if (how === 'cancel' || !p) { paint(true); return; }
  const next = how === 'tab' || how === 'shift-tab' ? ORDER[ORDER.indexOf(ed.f) + (how === 'tab' ? 1 : -1)] : null;
  if (ed.f.startsWith('link:')) {
    const [, g, i, k] = ed.f.split(':');
    mutateLinks(p, L => { const r = (L[g] || [])[+i]; if (r) { if (k === 'id') { const v = el.value.trim(); if (v) r.id = v; else delete r.id; } else r.n = el.value.trim(); } });
  } else if (!sameValue(p, ed.f, el.value)) saveMeta(p, patchFor(p, ed.f, el.value));
  else paint(true);
  if (next) { S.edit = { id: p.id, f: next }; paint(true); }
}

/* ---------- links ---------- */
const GROUP_OF = { request: 'slack', slack: 'slack', prolific_group: 'groups', prolific_study: 'studies', prolific_project: 'studies' };
const RANK = { request: 0, linear: 1, slack: 2, prolific_project: 3, prolific_group: 4, prolific_study: 5, qualtrics: 6, sheet: 7, other: 8 };
const GLYPH = { request: '#', slack: '#', linear: 'L', prolific_group: 'P', prolific_study: 'P', prolific_project: 'P', qualtrics: 'Q', sheet: '▦', other: '↗' };
function resources(p) {
  const out = [], L = p.meta.links || {};
  ['slack', 'groups', 'studies', 'other'].forEach(g => (L[g] || []).forEach((r, i) => {
    const k = r.k || (WL.kindFor ? WL.kindFor(g, r) : 'other');
    out.push({ g, i, r, k, id: r.id || (WL.idFor ? WL.idFor(k, r.u) : '') });
  }));
  return out.map((x, n) => ({ ...x, n })).sort((a, b) => RANK[a.k] - RANK[b.k] || a.n - b.n);
}
function rlabel(x, p) {
  if (x.k === 'request') return 'Request link';
  if (x.k === 'linear') return x.id || x.r.n || 'Linear';
  if (x.r.n) return x.r.n;
  const base = { prolific_group: 'Group', prolific_study: 'Study', prolific_project: 'Project', qualtrics: 'Qualtrics form', sheet: 'Google Sheet', slack: 'Slack thread' }[x.k];
  return (x.k.startsWith('prolific') && x.id ? base + ' ' + short(x.id) : base) || hostOf(x.r.u) || 'Link';
}
function rsub(x, p) {
  const svc = { request: 'Slack', slack: 'Slack', linear: 'Linear', prolific_group: 'Prolific group', prolific_study: 'Prolific study', prolific_project: 'Prolific project', qualtrics: 'Qualtrics', sheet: 'Google Sheet' }[x.k] || hostOf(x.r.u);
  return svc + (x.k === 'linear' && (p.meta.linear || {}).status ? ' · ' + p.meta.linear.status : '');
}
function mutateLinks(p, fn) {
  const L = JSON.parse(JSON.stringify(p.meta.links || {}));
  fn(L);
  const out = {}; let any = false;
  ['slack', 'groups', 'studies', 'other'].forEach(g => { if ((L[g] || []).length) { out[g] = L[g]; any = true; } });
  return saveMeta(p, { links: any ? out : null });
}
async function addLink(p, text) {
  await wlReady;
  const raw = String(text || '').trim().split(/\s+/)[0];
  const pr = WL.parse ? WL.parse(raw) : { u: '' };
  if (!pr.u) { S.msg = 'Links must start with https://'; paint(true); return; }
  const have = resources(p).some(x => x.r.u === pr.u);
  if (have) { S.msg = 'That link is already on this project'; paint(true); return; }
  const rowO = { n: '', u: pr.u, k: pr.kind }; if (pr.id) rowO.id = pr.id;
  let g = GROUP_OF[pr.kind] || 'other';
  if (pr.kind === 'slack') { const hasReq = ((p.meta.links || {}).slack || []).some(r => r.init); if (!hasReq) { rowO.init = true; rowO.k = 'request'; } }
  const patch = {};
  const L = JSON.parse(JSON.stringify(p.meta.links || {}));
  (L[g] = L[g] || []).push(rowO);
  patch.links = L;
  if (pr.kind === 'linear') {
    const old = p.meta.linear || {}, same = old.id === pr.id;
    patch.linear = { ...(same ? old : {}), id: pr.id, url: pr.u, ...(pr.linear && pr.linear.title && (!same || !old.title) ? { title: pr.linear.title } : {}) };
    patch.prov = { ...(p.meta.prov || {}), 'linear.id': { by: 'auto', src: pr.u, at: today() }, ...(pr.linear && pr.linear.title ? { 'linear.title': { by: 'auto', src: pr.u, at: today() } } : {}) };
  }
  S.adding = false;
  await saveMeta(p, patch);
  App.toast(pr.kind === 'linear' ? `Ticket ${pr.id} added` : 'Link added');
}

function removeLink(p, gr, i) {
  const L = JSON.parse(JSON.stringify(p.meta.links || {})), rm = (L[gr] || []).splice(i, 1)[0], out = {}; let any = false;
  ['slack', 'groups', 'studies', 'other'].forEach(k => { if ((L[k] || []).length) { out[k] = L[k]; any = true; } });
  const patch = { links: any ? out : null };
  if (rm && rm.k === 'linear' && (p.meta.linear || {}).url === rm.u) { // the ticket fields go with their link
    patch.linear = null; const prov = { ...(p.meta.prov || {}) }; Object.keys(prov).forEach(k => { if (k.startsWith('linear.')) delete prov[k]; }); patch.prov = Object.keys(prov).length ? prov : null;
  }
  saveMeta(p, patch);
}

/* ---------- deliverables ---------- */
function readSegs(card) {
  const out = [];
  card.querySelectorAll('[data-row]').forEach(r => {
    const g = k => r.querySelector(`[data-k="${k}"]`).value.trim(), n = k => g(k) === '' ? undefined : Number(g(k));
    const o = { n: g('n') }; ['requested', 'provided', 'approved'].forEach(k => { if (n(k) !== undefined && !Number.isNaN(n(k))) o[k] = n(k); });
    out.push(o);
  });
  return out;
}
function saveSegs(p, rows) {
  const clean = rows.filter(r => r.n || r.requested !== undefined || r.provided !== undefined || r.approved !== undefined);
  const prov = { ...(p.meta.prov || {}) }; if (clean.length) prov.deliver = { by: 'luc', at: today() }; else delete prov.deliver;
  saveMeta(p, { deliver: clean.length ? clean : null, prov: Object.keys(prov).length ? prov : null });
}

/* ---------- views ---------- */
function visibleList() {
  let l = S.list.filter(p => S.filter === 'hold' ? p.status === 'hold' : S.filter === 'done' ? p.status === 'done' : p.status !== 'hold' && p.status !== 'done');
  if (S.client) l = l.filter(p => S.client === 'int' ? !p.meta.client : p.meta.client === S.client);
  const q = S.q.trim().toLowerCase();
  if (q) l = l.filter(p => (p.name + ' ' + ticket(p)).toLowerCase().includes(q));
  const dl = p => deadline(p) || '9999-12-31';
  return S.sort === 'order' ? l.slice() : l.slice().sort((a, b) => dl(a) < dl(b) ? -1 : dl(a) > dl(b) ? 1 : (b.prio || 0) - (a.prio || 0));
}
const ragDot = p => `<i class="wx-rag ${p.meta.rag || ''}" title="${{ r: 'Red', a: 'Amber', g: 'Green' }[p.meta.rag] || 'No status set'}"></i>`;
function logo(p) { const c = clientOf(p); return c && App.clientLogo ? App.clientLogo(c, 'sm') : `<span class="wx-cl">${c ? esc(c.name.charAt(0)) : 'W'}</span>`; }
function listHTML() {
  const l = visibleList(), cnt = f => S.list.filter(p => f === 'hold' ? p.status === 'hold' : f === 'done' ? p.status === 'done' : p.status !== 'hold' && p.status !== 'done').length;
  let h = `<aside class="wx-list"><div class="wx-lh"><h2>Work projects</h2><div class="wx-seg">${['active', 'hold', 'done'].map(f => `<button class="${S.filter === f ? 'on' : ''}" data-wpx="filter" data-v="${f}">${{ active: 'Active', hold: 'On hold', done: 'Done' }[f]} · ${cnt(f)}</button>`).join('')}</div>` +
    `<div class="wx-find"><input type="search" placeholder="Find a project or ticket" data-wpx-in="q" value="${esc(S.q)}" aria-label="Find a project"></div>` +
    `<div class="wx-find"><select data-wpx-in="client" aria-label="Client"><option value="">All clients</option><option value="int"${S.client === 'int' ? ' selected' : ''}>Internal</option>${S.clients.map(c => `<option value="${esc(c.id)}"${S.client === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` +
    `<select data-wpx-in="sort" aria-label="Sort"><option value="deadline"${S.sort === 'deadline' ? ' selected' : ''}>By deadline</option><option value="order"${S.sort === 'order' ? ' selected' : ''}>By board order</option></select></div></div>` +
    `<div class="wx-rows">`;
  if (!S.loaded) h += `<p class="wx-empty">${esc(S.err) || 'Loading…'}</p>`;
  else if (!l.length) h += '<p class="wx-empty">No projects match.</p>';
  l.forEach(p => {
    const pg = prog(p), dl = deadline(p), n = daysTo(dl), t = ticket(p);
    h += `<button class="wx-pr${S.sel === p.id ? ' on' : ''}" data-wpx="open" data-id="${p.id}">${logo(p)}<span class="wx-prb"><span class="wx-prt"><span>${esc(p.name)}</span>${ragDot(p)}</span>` +
      `<span class="wx-prm wx-num">${t ? '<span>' + esc(t) + '</span>' : ''}${dl ? `<span class="${dlCls(n)}">Deadline ${esc(fmtDay(dl))}</span>` : ''}${!t && !dl ? '<span>No ticket or deadline</span>' : ''}</span>` +
      (pg.pct !== null ? `<span class="wx-prp"><span class="wx-bar"><b style="width:${Math.min(100, pg.pct)}%"></b></span><span class="wx-num">${pg.pct}%</span></span>` : '') + '</span></button>';
  });
  h += `</div><div class="wx-lfoot"><button class="wx-btn" data-pj="open">Manage projects…</button>${App.wsBar ? App.wsBar() : ''}<button class="wx-btn" data-wpx="legacy" title="The earlier Projects pages, on the same data">Legacy view</button></div></aside>`;
  return h;
}
function overviewHTML() {
  const l = visibleList(), act = S.list.filter(p => p.status !== 'hold' && p.status !== 'done');
  let od = 0, soon = 0, red = 0;
  act.forEach(p => { const n = daysTo(deadline(p)); if (n !== null && n <= 7) soon++; if (p.meta.rag === 'r') red++; openTasks(p).forEach(t => { if (t.due_date && t.due_date < today() && !t.paused) od++; }); });
  let h = `<div class="wx-pad"><div class="wx-ph1"><h1>Overview</h1><div class="wx-seg" style="min-width:210px"><button class="${S.tab === 'list' ? 'on' : ''}" data-wpx="tab" data-v="list">List</button><button class="${S.tab === 'board' ? 'on' : ''}" data-wpx="tab" data-v="board">Task board</button></div></div>` +
    `<p class="wx-sub"><span><b>${act.length}</b> active</span><span><b class="${soon ? 'wx-soon' : ''}">${soon}</b> deadline within 7 days</span><span><b class="${red ? 'wx-od' : ''}">${red}</b> red</span><span><b class="${od ? 'wx-od' : ''}">${od}</b> overdue tasks</span></p>`;
  if (S.msg) h += `<p class="wx-toast">${esc(S.msg)}</p>`;
  if (S.tab === 'board') return h + '</div>' + boardHTML(l);
  h += '<div class="wx-ohd"><span></span><span>Project</span><span>Ticket</span><span>Progress</span><span class="nx">Next task</span><span>Update</span></div>';
  l.forEach(p => {
    const pg = prog(p), dl = deadline(p), n = daysTo(dl), nx = taskSplit(p).next, lu = p.last ? Math.round((D(today()) - new Date(p.last.at.slice(0, 10) + 'T12:00:00')) / 864e5) : null;
    h += `<button class="wx-orow" data-wpx="open" data-id="${p.id}">${logo(p)}<span class="n">${esc(p.name)}<small>${dl ? `<span class="${dlCls(n)}">Deadline ${esc(fmtDay(dl))} · ${when(n)}</span>` : 'No deadline'}</small></span>` +
      `<span class="m"><b>${esc(ticket(p)) || '—'}</b>${esc((p.meta.linear || {}).status || '')}</span>` +
      `<span class="m wx-num">${pg.pct !== null ? `<b>${pg.pct}% · ${fmtNum(pg.pr)} of ${fmtNum(pg.req)}</b><span class="wx-bar"><b style="width:${Math.min(100, pg.pct)}%"></b></span>` : '<b>—</b>No deliverables'}</span>` +
      `<span class="m nx">${nx ? esc(nx.title) : '—'}</span><span class="m wx-num">${lu === null ? '—' : lu === 0 ? 'today' : lu + 'd'}</span></button>`;
  });
  if (!l.length) h += '<p class="wx-empty">No projects match.</p>';
  return h + '</div>';
}
function boardHTML(l) {
  let h = '<div class="wx-tb2">';
  l.forEach(p => {
    const sp = taskSplit(p), n = daysTo(deadline(p));
    h += `<section class="wx-colm"><div class="wx-colh" data-wpx="open" data-id="${p.id}"><b>${ragDot(p)}<span>${esc(p.name)}</span></b><small class="wx-num">${plural(sp.all.length, 'open task')}${deadline(p) ? ` · <span class="${dlCls(n)}">${esc(fmtDay(deadline(p)))}</span>` : ''}</small></div>` +
      `<div class="wx-colb"><ul class="wx-tasks">${sp.next ? taskHTML(sp.next, true) : ''}${sp.rest.map(t => taskHTML(t, false)).join('')}</ul>${sp.all.length ? '' : '<p class="wx-empty">Nothing open</p>'}</div>` +
      `<form class="wx-colf wxadd" data-id="${p.id}" autocomplete="off"><input type="text" maxlength="200" placeholder="Add a task…" aria-label="Add a task to ${esc(p.name)}"></form></section>`;
  });
  return h + (l.length ? '' : '<p class="wx-empty">No projects match.</p>') + '</div>';
}
function projectHTML(p) {
  const pg = prog(p), dl = deadline(p), n = daysTo(dl), sp = taskSplit(p), res = resources(p), lin = p.meta.linear || {}, ls = (p.meta.activity || {}).last_slack;
  const menu = (name, cur, opts) => `<select class="wx-menu" data-wpx-in="${name}" aria-label="${name}">${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  let h = `<div class="wx-hd"><button class="wx-back" data-wpx="back">‹ Projects</button><div class="wx-ph1">${logo(p)}<h1>${esc(p.name)}</h1>` +
    menu('rag', p.meta.rag || '', [['', 'No status'], ['r', 'Red'], ['a', 'Amber'], ['g', 'Green']]) + `<span class="wx-dsk">${menu('status', p.status || 'active', [['active', 'Active'], ['hold', 'On hold'], ['done', 'Done']])}${menu('prio', p.prio || 0, [[0, 'No priority'], [1, 'Low'], [2, 'Medium'], [3, 'High']])}</span>` + '</div>' +
    `<div class="wx-facts">${ticket(p) ? `<span>Ticket <b>${esc(ticket(p))}</b>${lin.status ? ` <span class="wx-chip">${esc(lin.status)}</span>` : ''}</span>` : '<span>Paste a Linear link to add the ticket</span>'}` +
    `${dl ? `<span>Deadline <b class="${dlCls(n)}">${esc(fmtDay(dl))} · ${when(n)}</b></span>` : '<span>No deadline set</span>'}${p.meta.requester ? `<span class="opt">Requester <b>${esc(pname(p.meta.requester))}</b></span>` : ''}${p.meta.owner ? `<span class="opt">Owner <b>${esc(pname(p.meta.owner))}</b></span>` : ''}${money(p) ? `<span class="opt">Revenue <b>${esc(money(p))}</b></span>` : ''}</div>` +
    '<div class="wx-res">' + res.filter(x => x.k !== 'linear' || x.r.u).map(x => `<span class="wx-rcw"><a class="wx-rc" href="${esc(x.r.u)}" target="_blank" rel="noopener noreferrer"><span class="wx-ic ${x.k}">${GLYPH[x.k]}</span><span class="t"><b>${esc(rlabel(x, p))}</b><small>${esc(rsub(x, p))}</small></span></a><button class="wx-cp" data-wpx="copy" data-v="${esc(x.r.u)}" title="Copy the link">Copy</button></span>`).join('') +
    (S.adding ? '<input class="wx-in" style="max-width:360px" type="text" placeholder="Paste a link, then Enter" data-wpx-in="newlink" data-focus>' : '<button class="wx-add" data-wpx="addlink">+ Paste a link</button>') + '</div>' +
    '<div class="wx-seg wx-ptabs">' + [['tasks', 'Tasks'], ['details', 'Details'], ['updates', 'Updates']].map(([v, t]) => `<button class="${S.pt === v ? 'on' : ''}" data-wpx="ptab" data-v="${v}">${t}</button>`).join('') + '</div></div>';
  if (S.msg) h += `<p class="wx-toast" style="padding:8px 28px 0">${esc(S.msg)}</p>`;
  // main column
  h += '<div class="wx-body"><div class="wx-col">';
  h += `<div class="wx-card"><div class="wx-h3">Progress<small>delivered of requested</small></div><div class="wx-prog"><div class="l"><div class="wx-big wx-num">${pg.pct === null ? '—' : pg.pct + '%'}</div>${pg.req ? `<span class="wx-bar2" style="margin-top:10px" title="Delivered and ID approved, of requested"><b class="p" style="width:${Math.min(100, pg.pct)}%"></b><b class="a" style="width:${Math.min(100, 100 * pg.ap / pg.req)}%"></b></span>` : ''}${pg.req ? `<small class="wx-num">${fmtNum(pg.pr)} of ${fmtNum(pg.req)} delivered${pg.ap ? `<br>${fmtNum(pg.ap)} ID approved` : ''}</small>` : '<small>Add what was requested and delivered</small>'}</div>` +
    `<div class="wx-seg2" data-segs><div class="wx-sg"><span class="hh">Segment</span><span class="hh">Requested</span><span class="hh">Delivered</span><span class="hh">Approved</span><span></span>`;
  pg.rows.forEach((r, i) => { h += `<span style="display:contents" data-row="${i}"><input data-k="n" data-seg value="${esc(r.n || '')}" placeholder="${pg.rows.length > 1 ? 'Segment' : 'Total'}" aria-label="Segment name"><input data-k="requested" data-seg type="number" min="0" value="${r.requested ?? ''}" aria-label="Requested"><input data-k="provided" data-seg type="number" min="0" value="${r.provided ?? ''}" aria-label="Delivered"><input data-k="approved" data-seg type="number" min="0" value="${r.approved ?? ''}" aria-label="ID approved"><button class="wx-x" data-wpx="segrm" data-i="${i}" aria-label="Remove segment">×</button></span>`; });
  h += `</div><button class="wx-btn" style="margin-top:10px" data-wpx="segadd">+ ${pg.rows.length ? 'Add segment' : 'Add deliverables'}</button>`;
  h += '</div></div></div>';
  h += `<div class="wx-h3">Tasks<small class="wx-num">${plural(sp.all.length, 'open task')}</small></div><form class="wx-newtask wxadd" data-id="${p.id}" autocomplete="off"><input type="text" maxlength="200" placeholder="Add a task to ${esc(p.name)}…" aria-label="Add a task"></form>`;
  if (!sp.next && sp.all.length) h += '<div class="wx-pick">Pick the next task: tap ☆ on the one to do next.</div>';
  h += `<ul class="wx-tasks">${sp.next ? taskHTML(sp.next, true) : ''}${sp.rest.map(t => taskHTML(t, false)).join('')}</ul>${sp.all.length ? '' : '<p class="wx-empty">Nothing open in this project.</p>'}`;
  if (ls) h += `<div class="wx-lm"><small>Last Slack message</small>${ls.text ? '“' + esc(ls.text) + '”' : ''}<small>${[ls.who, ls.where, ls.at ? fmtDay(ls.at.slice(0, 10)) : ''].filter(Boolean).map(esc).join(' · ')}${ls.u ? ` · <a href="${esc(ls.u)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}</small></div>`;
  h += `<div class="wx-sec-upd" style="margin-top:22px">${App.wsSection ? App.wsSection(p.id) : ''}</div></div>`;
  // inspector
  h += `<aside class="wx-insp"><div class="wx-ponly"><h4>Project</h4><dl class="wx-dl"><div class="wx-kv"><dt>Status</dt><dd>${menu('status', p.status || 'active', [['active', 'Active'], ['hold', 'On hold'], ['done', 'Done']])}</dd></div><div class="wx-kv"><dt>Priority</dt><dd>${menu('prio', p.prio || 0, [[0, 'None'], [1, 'Low'], [2, 'Medium'], [3, 'High']])}</dd></div></dl></div><h4>People</h4><dl class="wx-dl">` + ['requester', 'owner', 'recruiter', 'client'].map(f => row(p, f)).join('') + '</dl>' +
    '<h4>Dates</h4><dl class="wx-dl">' + ['dates.requested', 'dates.started', 'dates.target', 'dates.due'].map(f => row(p, f)).join('') + '</dl>' +
    `<h4>Ticket${ticket(p) ? ' · ' + esc(ticket(p)) : ''}</h4><dl class="wx-dl">${ticket(p) ? row(p, 'linear.title') : ''}${row(p, 'linear.status')}${row(p, 'linear.sla')}${row(p, 'linear.revenue')}${lin.synced ? `<div class="wx-kv"><dt>Synced</dt><dd>${esc(fmtDay(lin.synced.slice(0, 10)))}</dd></div>` : ''}</dl>` +
    '<h4>Participants</h4><dl class="wx-dl">' + row(p, 'particip.group_ids') + row(p, 'particip.source') + '</dl>' +
    '<h4>Goal</h4>' + cell(p, 'goal') + '<h4>Success criteria</h4>' + cell(p, 'success');
  if ((p.meta.codes || []).length) h += '<h4>Campaign codes</h4><dl class="wx-dl">' + p.meta.codes.map(c => `<div class="wx-kv"><dt>${esc(c.n)}</dt><dd><code class="wx-code" data-wpx="copy" data-v="${esc(c.c)}">${esc(c.c)}</code></dd></div>`).join('') + '</dl>';
  h += '<h4>Links</h4><div class="wx-links">' + (res.length ? '' : '<p class="wx-ph" style="margin:4px 0">Paste a Slack, Linear, Prolific, Qualtrics or Sheets link anywhere on this page.</p>');
  res.forEach(x => {
    const fl = `link:${x.g}:${x.i}:n`, fi = `link:${x.g}:${x.i}:id`, ed = f => S.edit && S.edit.id === p.id && S.edit.f === f;
    h += `<div class="wx-lk"><span class="wx-ic ${x.k}">${GLYPH[x.k]}</span><span class="t">` +
      (ed(fl) ? `<input class="wx-in" data-wpx-in="edit" data-focus maxlength="60" value="${esc(x.r.n || '')}" placeholder="${esc(rlabel(x, p))}">` : `<a href="${esc(x.r.u)}" target="_blank" rel="noopener noreferrer">${esc(rlabel(x, p))}</a>`) +
      (ed(fi) ? `<input class="wx-in" data-wpx-in="edit" data-focus maxlength="64" value="${esc(x.id || '')}" placeholder="ID">` : `<small>${esc(rsub(x, p))}${x.id ? ` · <code class="wx-code" data-wpx="edit" data-f="${fi}" title="Edit the ID">${esc(short(x.id))}</code>` : ` · <button class="wx-ed" style="margin:0;padding:0 4px" data-wpx="edit" data-f="${fi}">add ID</button>`}</small>`) +
      `</span>${x.g === 'slack' && x.k !== 'request' ? `<button class="wx-x" style="font-size:12px" data-wpx="makereq" data-g="${x.g}" data-i="${x.i}" title="Make this the request link">Request</button>` : ''}<button class="wx-x" data-wpx="rename" data-f="${fl}" title="Rename" aria-label="Rename">✎</button><button class="wx-x" data-wpx="rmlink" data-g="${x.g}" data-i="${x.i}" aria-label="Remove link">×</button></div>`;
  });
  return h + '</div></aside></div>';
}
function build() {
  if (!S.loaded) return `<div class="wx${S.sel ? ' has-sel' : ''}">${listHTML()}<div class="wx-main"><p class="wx-empty">${esc(S.err) || 'Loading…'}</p></div></div>`;
  let p = S.sel ? byId(S.sel) : null; if (S.sel && !p) { S.sel = ''; p = null; }
  return `<div class="wx${p ? ' has-sel' : ''}" data-pt="${S.pt}">${listHTML()}<div class="wx-main">${p ? projectHTML(p) : overviewHTML()}</div></div>`;
}

/* ---------- paint ---------- */
let lastSel = '';
function paint(force) {
  const el = $pane(); if (!el) return;
  if (!S.loaded) { if (!S.busy) loadOverview(); }
  else if (Date.now() - S.at > 60000 && !S.busy) loadOverview();
  const a = document.activeElement;
  if (!force && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; // never repaint under a field being typed in
  const rows = el.querySelector('.wx-rows'), main = el.querySelector('.wx-main'), rt = rows ? rows.scrollTop : 0, mt = main && lastSel === S.sel ? main.scrollTop : 0, pt = el.scrollTop;
  const hadQ = a && a.getAttribute && a.getAttribute('data-wpx-in') === 'q', caret = hadQ ? a.selectionStart : 0;
  const changed = App.setHTML(el, build());
  if (changed) {
    const r2 = el.querySelector('.wx-rows'), m2 = el.querySelector('.wx-main');
    if (r2) r2.scrollTop = rt; if (m2) m2.scrollTop = mt; el.scrollTop = pt;
    const f = el.querySelector('[data-focus]');
    if (f) { f.focus(); if (f.select && f.tagName !== 'SELECT') f.select(); }
    else if (hadQ) { const q = el.querySelector('[data-wpx-in="q"]'); if (q) { q.focus(); q.setSelectionRange(caret, caret); } }
  }
  if (S.sel && lastSel !== S.sel) { lastSel = S.sel; if (App.wsLoad) App.wsLoad(S.sel); }
  if (!S.sel) lastSel = '';
  // a Next task that is done, deleted or moved is cleared (the picker prompt shows)
  if (S.loaded) S.list.forEach(p => { if (p.next && !S.cleaned[p.id + p.next] && !openTasks(p).some(t => t.id === p.next) && App.todos().length) { S.cleaned[p.id + p.next] = 1; p.next = null; api('PATCH', `?next=${p.id}`, { task: null }); } });
}
function copy(v) {
  const done = () => App.toast('Copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, () => App.toast('Could not copy'));
  else App.toast('Could not copy');
}

/* ---------- events ---------- */
const root = () => document.getElementById('wxPane');
function setSel(id) { S.sel = id; S.pt = 'tasks'; S.edit = null; S.adding = false; S.msg = ''; wr('wpxSel', id); paint(true); const m = root() && root().querySelector('.wx-main'); if (m) m.scrollTop = 0; window.scrollTo(0, 0); }
document.addEventListener('click', e => {
  const r = root(); if (!r || !r.contains(e.target)) return;
  const act = e.target.closest('[data-act]'); if (act && r.contains(act)) return; // ticking and opening a task belong to the core
  const el = e.target.closest('[data-wpx]'); if (!el || !r.contains(el)) return;
  const a = el.getAttribute('data-wpx'), p = S.sel ? byId(S.sel) : null, g = k => el.getAttribute('data-' + k);
  if (a === 'open') { if (el.tagName === 'INPUT') return; setSel(g('id')); }
  else if (a === 'back') setSel('');
  else if (a === 'filter') { S.filter = g('v'); wr('wpxFilter', S.filter); paint(true); }
  else if (a === 'tab') { S.tab = g('v'); wr('wpxTab', S.tab); paint(true); }
  else if (a === 'ptab') { S.pt = g('v'); paint(true); }
  else if (a === 'legacy') { App.wpLegacy = true; App.navTo('board'); }
  else if (a === 'copy') { e.preventDefault(); copy(g('v')); }
  else if (a === 'next' && p) setNext(p, g('id'));
  else if (a === 'edit' && p) { e.preventDefault(); S.edit = { id: p.id, f: g('f') }; paint(true); }
  else if (a === 'rename' && p) { S.edit = { id: p.id, f: g('f') }; paint(true); }
  else if (a === 'addlink') { S.adding = true; paint(true); }
  else if (a === 'rmlink' && p) removeLink(p, g('g'), +g('i'));
  else if (a === 'makereq' && p) mutateLinks(p, L => { (L.slack || []).forEach((rw, i) => { if (i === +g('i')) { rw.init = true; rw.k = 'request'; } else { delete rw.init; if (rw.k === 'request') rw.k = 'slack'; } }); });
  else if (a === 'segadd' && p) saveSegs(p, [...(p.meta.deliver || []), { n: '', requested: 0 }]);
  else if (a === 'segrm' && p) { const rows = (p.meta.deliver || []).slice(); rows.splice(+g('i'), 1); saveSegs(p, rows); }
}, true);
document.addEventListener('change', e => {
  const r = root(); if (!r || !r.contains(e.target)) return;
  const t = e.target, k = t.getAttribute('data-wpx-in'), p = S.sel ? byId(S.sel) : null;
  if (k === 'client') { S.client = t.value; wr('wpxClient', S.client); paint(true); }
  else if (k === 'sort') { S.sort = t.value; wr('wpxSort', S.sort); paint(true); }
  else if (k === 'rag' && p) saveMeta(p, { rag: t.value || null });
  else if (k === 'status' && p) saveCore(p, { status: t.value });
  else if (k === 'prio' && p) saveCore(p, { prio: +t.value });
  else if (k === 'edit' && (t.tagName === 'SELECT' || t.type === 'date')) commitEdit(t, 'enter');
  else if (t.hasAttribute('data-seg') && p) saveSegs(p, readSegs(t.closest('[data-segs]')));
});
document.addEventListener('input', e => {
  const t = e.target; if (!t.getAttribute || t.getAttribute('data-wpx-in') !== 'q' || !root() || !root().contains(t)) return;
  S.q = t.value; paint(true);
});
document.addEventListener('keydown', e => {
  const t = e.target, r = root(); if (!r || !r.contains(t) || !t.getAttribute) return;
  const k = t.getAttribute('data-wpx-in');
  if (k === 'edit') {
    if (e.key === 'Escape') { e.preventDefault(); commitEdit(t, 'cancel'); }
    else if (e.key === 'Enter' && t.tagName !== 'TEXTAREA') { e.preventDefault(); commitEdit(t, 'enter'); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(t, 'enter'); }
    else if (e.key === 'Tab' && S.edit && !S.edit.f.startsWith('link:')) { e.preventDefault(); commitEdit(t, e.shiftKey ? 'shift-tab' : 'tab'); }
  } else if (k === 'newlink') {
    if (e.key === 'Escape') { S.adding = false; paint(true); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = byId(S.sel); if (p) addLink(p, t.value); }
  }
});
document.addEventListener('focusout', e => {
  const t = e.target, r = root(); if (!r || !t.getAttribute || !r.contains(t)) return;
  if (t.getAttribute('data-wpx-in') === 'edit' && S.edit && t.tagName !== 'SELECT' && t.type !== 'date') setTimeout(() => { if (S.edit) commitEdit(t, 'enter'); }, 0);
  if (t.getAttribute('data-wpx-in') === 'newlink' && t.value.trim() === '') setTimeout(() => { if (S.adding) { S.adding = false; paint(true); } }, 150);
  if (t.getAttribute('data-wpx-in') === 'newlink' && t.value.trim()) { const p = byId(S.sel); if (p) addLink(p, t.value); }
});
document.addEventListener('submit', e => {
  const f = e.target; if (!f.classList || !f.classList.contains('wxadd')) return;
  e.preventDefault();
  const inp = f.querySelector('input'), title = inp.value.trim(), p = byId(f.getAttribute('data-id'));
  if (!title || !p) return;
  inp.value = '';
  App.api('POST', '', { title, category: p.name, list: 'work' }, (s, d) => {
    if (s === 201 && d && d.todo) { App.todos().push(d.todo); App.mutated(); App.toast('Added to ' + p.name); } else App.toast('Could not add, try again');
    App.render();
  });
});
document.addEventListener('paste', e => { // paste a link anywhere on a project page: it becomes a typed resource
  const r = root(); if (!r || !S.sel || !App.view || App.view() !== 'wp') return;
  const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const txt = (e.clipboardData && e.clipboardData.getData('text')) || '', p = byId(S.sel);
  if (p && /^\s*https:\/\/\S+\s*$/.test(txt)) { e.preventDefault(); addLink(p, txt); }
});

if (!OFF) {
  App.wpReady = true;
  App.wpOpen = id => { S.sel = id; wr('wpxSel', id); App.navTo('wp'); };
  App.register('wp', {
    title: 'Projects',
    render: () => paint(),
    show: () => { S.q = ''; S.msg = ''; loadOverview(); paint(true); if (App.wsCheck) App.wsCheck(); }
  });
}
