/* ============ OneNotes — app logic ============ */
'use strict';

/* ---------------- native bridge (with browser mock for preview) ---------------- */
var NB = (function () {
  if (typeof NativeBridge !== 'undefined' && NativeBridge && NativeBridge.getNotes) {
    return {
      getNotes: function () { return NativeBridge.getNotes(); },
      saveNotes: function (j) { NativeBridge.saveNotes(j); },
      getSettings: function () { return NativeBridge.getSettings(); },
      setSetting: function (k, v) { NativeBridge.setSetting(k, v); },
      getSystemTheme: function () { return NativeBridge.getSystemTheme(); },
      toast: function (m) { NativeBridge.toast(m); },
      sync: function () { NativeBridge.sync(); },
      exportNotes: function (j) { NativeBridge.exportNotes(j); },
      importPick: function () { NativeBridge.importPick(); },
      shareNote: function (t, b) { NativeBridge.shareText(t, b); }
    };
  }
  /* ---- mock: localStorage-backed, for desktop preview ---- */
  var LSg = function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  var LSs = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  return {
    mock: true,
    getNotes: function () { return LSg('onenotes', '[]'); },
    saveNotes: function (j) { LSs('onenotes', j); },
    getSettings: function () { return LSg('oneprefs', '{}'); },
    setSetting: function (k, v) {
      var p = {}; try { p = JSON.parse(LSg('oneprefs', '{}')) || {}; } catch (e) {}
      p[k] = String(v); LSs('oneprefs', JSON.stringify(p));
    },
    getSystemTheme: function () {
      return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    },
    toast: function (m) { toastUI(m); },
    sync: function () {
      setTimeout(function () {
        if (window.onSyncResult) onSyncResult('err|Sync runs in the Android app \u2014 set a WebDAV server in Settings');
      }, 500);
    },
    exportNotes: function (j) {
      var b = new Blob([j], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'onenotes.json'; a.click();
    },
    importPick: function () {
      var i = document.createElement('input'); i.type = 'file';
      i.onchange = function () {
        var f = i.files[0]; if (!f) return;
        f.text().then(function (t) { if (window.importNotes) importNotes(t); });
      };
      i.click();
    },
    shareNote: function (t, b) {
      try {
        navigator.clipboard.writeText((t ? t + '\n\n' : '') + b);
        toastUI('Note copied to clipboard');
      } catch (e) {}
    }
  };
})();

/* ---------------- state ---------------- */
var notes = [];
var settings = { theme: 'system', webdav_url: '', webdav_user: '', webdav_pass: '', gh_token: '', gh_repo: 'gitnotes-sync', sync_provider: 'github', autosync: '1', sort: 'edited', view_mode: 'list', seeded: '' };
var filter = 'all';
var query = '';
var screenNow = 'list';
var editingId = null;
var viewingId = null;
var editorFrom = 'list';
var saveTimer = null;
var toastTimer = null;

var SWATCH = ['#FFFFFF', '#FFF1AE', '#FFD9B8', '#FFD0DE', '#CBE1FF', '#CFEDB9', '#E3D6FF', '#FFCFC4', '#F5CCEE', '#D8D9FF', '#C6EEF5', '#C4EBDC', '#E3E5E8', '#EADBC4'];

var EMOJIS = ['', '\u{1F4DD}', '\u{1F4CC}', '\u2705', '\u2B50', '\u{1F3AF}', '\u{1F6D2}', '\u{1F4BC}', '\u{1F3E0}', '\u{1F4A1}', '\u{1F4DA}', '\u{1F3CB}\uFE0F', '\u2708\uFE0F', '\u{1F3B5}', '\u{1F3AC}', '\u{1F3AE}', '\u{1F355}', '\u2615', '\u{1F9E0}', '\u2764\uFE0F', '\u{1F525}', '\u{1F4B0}', '\u{1F4C5}', '\u{1F9F3}', '\u{1F3A8}', '\u{1F527}', '\u{1F436}', '\u{1F431}', '\u{1F331}', '\u{1F697}', '\u{1F511}', '\u{1F319}', '\u2600\uFE0F', '\u26A1', '\u{1F382}', '\u{1F3C6}'];

var TEMPLATES = [
  { ic: '', name: 'Blank note', desc: 'Start from scratch', title: '', body: '' },
  { ic: '\u2705', name: 'To-do list', desc: 'Simple checklist', title: 'To-do',
    body: '- [ ] \n- [ ] \n- [ ] ' },
  { ic: '\u{1F6D2}', name: 'Shopping list', desc: 'Sections + tickable items', title: 'Shopping list',
    body: '## Groceries\n- [ ] \n- [ ] \n\n## Household\n- [ ] ' },
  { ic: '\u{1F4DD}', name: 'Meeting notes', desc: 'Agenda + action items', title: 'Meeting notes',
    body: '## Attendees\n- \n\n## Agenda\n- \n\n---\n## Action items\n- [ ] \n- [ ] ' },
  { ic: '\u{1F4C5}', name: 'Daily journal', desc: 'Prompted reflection', title: 'Journal \u2014 <date>',
    body: '## Highlights\n- \n\n## Grateful for\n- \n\n## Tomorrow\n- [ ] @today\n' },
  { ic: '\u{1F3AF}', name: 'Project plan', desc: 'Goal + milestones', title: 'Project plan',
    body: '## Goal\n\n---\n## Milestones\n- [ ] \n- [ ] \n- [ ] \n\n## Notes\n- \n' }
];

function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '\u0026amp;', '<': '\u0026lt;', '>': '\u0026gt;', '"': '\u0026quot;', "'": '\u0026#39;' }[c];
  });
}
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function findNote(id) {
  for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i];
  return null;
}

function activeNote() {
  return currentNote() || (viewingId ? findNote(viewingId) : null);
}

function updateViewModeBtn() {
  el('btn-viewmode').innerHTML = (settings.view_mode === 'grid') ? IC.listIcon : IC.gridIcon;
}

function setFilter(f) {
  filter = f;
  var segs = document.querySelectorAll('#nav .seg-btn');
  for (var i = 0; i < segs.length; i++) {
    segs[i].classList.toggle('active', segs[i].getAttribute('data-filter') === f);
  }
  renderList();
}

/* ---------------- icons ---------------- */
var IC = {
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.6l2.55 5.2 5.75.83-4.15 4.05.98 5.72L12 16.7l-5.13 2.7.98-5.72L3.7 9.63l5.75-.83z"/></svg>',
  starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3.6l2.55 5.2 5.75.83-4.15 4.05.98 5.72L12 16.7l-5.13 2.7.98-5.72L3.7 9.63l5.75-.83z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1.2c.55 0 1-.45 1-1s-.45-1-1-1H6.8c-.55 0-1 .45-1 1s.45 1 1 1H8v8l-2.2 2.4c-.4.44-.64 1.02-.64 1.62V18h4.6v4.4c0 .7.6 1.3 1.3 1.3h1.9c.7 0 1.3-.6 1.3-1.3V18h4.6v-2l-.02.02c0-.6-.22-1.18-.62-1.62z"/></svg>',
  pinO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M16 12V4h1.2c.55 0 1-.45 1-1s-.45-1-1-1H6.8c-.55 0-1 .45-1 1s.45 1 1 1H8v8l-2.2 2.4c-.4.44-.64 1.02-.64 1.62V18h4.6v4.4c0 .7.6 1.3 1.3 1.3h1.9c.7 0 1.3-.6 1.3-1.3V18h4.6v-2c0-.6-.22-1.18-.62-1.62z"/></svg>',
  iconAdd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  gridIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  listIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.2" cy="6" r="1" fill="currentColor"/><circle cx="4.2" cy="12" r="1" fill="currentColor"/><circle cx="4.2" cy="18" r="1" fill="currentColor"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/></svg>'
};

/* ---------------- persistence ---------------- */
function loadAll() {
  try { notes = JSON.parse(NB.getNotes()) || []; } catch (e) { notes = []; }
  try { var s = JSON.parse(NB.getSettings()); if (s) { for (var k in s) settings[k] = s[k]; } } catch (e) {}
}
function persist() { NB.saveNotes(JSON.stringify(notes)); }

function seedFirstRun() {
  if (settings.seeded) return;
  if (NB.mock) return; /* desktop preview gets richer samples */
  notes = [{
    id: uid(), title: 'Welcome to OneNotes',
    body: 'Your notes live on this device and sync to your own private GitHub repo once you set that up in Settings (WebDAV works too).\n\n\u2022 Type \u201C- [ ] \u201D or tap \u2713 in the editor to create tasks \u2014 the Tasks tab collects them all\n\u2022 Type \u201C/\u201D for blocks: headings, lists, quotes, dividers\n\u2022 Give notes an icon, add #tags, or start from a template (\u22EF menu)\n\u2022 Pull down anytime to sync \u00B7 try Pitch black on AMOLED\n\n- [ ] Try ticking me in the Tasks tab @today\n- [ ] Create your first note\n\nEnjoy!',
    color: 4, pinned: true, fav: true,
    createdAt: Date.now(), updatedAt: Date.now(), deleted: false
  }];
  persist();
  settings.seeded = '1';
  NB.setSetting('seeded', '1');
}

function seedPreview() {
  if (!NB.mock || notes.length) return;
  var now = Date.now(), H = 3600000;
  notes = [
    { id: uid(), title: 'Trip to Leh', body: 'Pangong Tso at sunrise, Nubra valley camel ride, Maggi at Khardung La. Book the bike a week ahead. #travel', color: 4, pinned: true, fav: true, icon: '\u2708\uFE0F', createdAt: now - 50 * H, updatedAt: now - 2 * H, deleted: false },
    { id: uid(), title: 'Groceries', body: '## Groceries\n- [x] Atta\n- [ ] Cold brew @today\n- [ ] Mangoes\n- [ ] Dark chocolate 85%', color: 1, pinned: false, fav: false, icon: '\u{1F6D2}', createdAt: now - 30 * H, updatedAt: now - 5 * H, deleted: false },
    { id: uid(), title: 'App ideas', body: 'A notes app that feels like Samsung One UI \u2014 big titles, pill nav, glassy sheets #side-project', color: 6, pinned: false, fav: true, icon: '\u{1F4A1}', createdAt: now - 26 * H, updatedAt: now - 9 * H, deleted: false },
    { id: uid(), title: 'Gym split', body: '- [ ] Mon \u2014 push\n- [ ] Tue \u2014 pull\n- [ ] Wed \u2014 legs\n- [ ] Thu \u2014 rest\n- [ ] Fri \u2014 upper\n- [ ] Weekend \u2014 football', color: 5, pinned: false, fav: false, icon: '\u{1F3CB}\uFE0F', createdAt: now - 20 * H, updatedAt: now - 20 * H, deleted: false },
    { id: uid(), title: 'Wifi password', body: 'Fridge-2A7C', color: 3, pinned: false, fav: false, icon: '\u{1F511}', createdAt: now - 90 * H, updatedAt: now - 70 * H, deleted: false }
  ];
  persist();
}

/* ---------------- dates ---------------- */
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtDate(ts) {
  var d = new Date(ts), now = new Date();
  var day = function (x) { return Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000); };
  var diff = day(now) - day(d);
  if (diff === 0) {
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return DAYS[d.getDay()];
  var y = d.getFullYear() === now.getFullYear() ? '' : ' ' + d.getFullYear();
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + y;
}
function rel(ts) {
  var s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  return fmtDate(ts);
}

/* ---------------- rich text parsing ---------------- */
var DUE_RE = /@(today|tomorrow|\d{4}-\d{2}-\d{2})(?=\s|$)/i;

function startOfDay(ts) {
  var d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseTasks(body) {
  var out = [];
  var lines = (body || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^(\s*)- \[([ xX])\] ?(.*)$/);
    if (!m) continue;
    var text = m[3] || '';
    var due = null;
    var dm = text.match(DUE_RE);
    if (dm) {
      var w = dm[1].toLowerCase();
      if (w === 'today') due = startOfDay(Date.now());
      else if (w === 'tomorrow') due = startOfDay(Date.now()) + 86400000;
      else due = startOfDay(new Date(w + 'T00:00:00').getTime());
      text = text.replace(DUE_RE, '').trim();
    }
    out.push({ line: i, done: m[2].toLowerCase() === 'x', text: text, due: due });
  }
  return out;
}

function tagsOf(n) {
  var m = ((n.title || '') + ' ' + (n.body || '')).match(/#([\w-]+)/g) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < m.length; i++) {
    var t = m[i].slice(1).toLowerCase();
    if (t && !seen[t]) { seen[t] = 1; out.push(t); }
  }
  return out;
}

function previewText(n) {
  var lines = (n.body || '').split('\n');
  var out = [];
  for (var i = 0; i < lines.length && out.length < 2; i++) {
    var l = lines[i].trim();
    if (!l) continue;
    if (l === '---') { out.push('\u2014\u2014\u2014'); continue; }
    l = l.replace(/^###?\s+/, '').replace(/^>\s?/, '')
         .replace(/^-\s\[[ xX]\]\s*/, '').replace(/^-\s+/, '')
         .replace(DUE_RE, '').trim();
    if (l) out.push(l);
  }
  return out.join(' ').slice(0, 160);
}

function dueLabel(due) {
  var today = startOfDay(Date.now());
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due === today + 86400000) return 'Tomorrow';
  return fmtDate(due);
}

/* ---------------- theme ---------------- */
function applyTheme() {
  var mode = settings.theme === 'system' ? NB.getSystemTheme() : settings.theme;
  document.documentElement.dataset.theme = mode;
  var segs = document.querySelectorAll('#theme-seg button');
  for (var i = 0; i < segs.length; i++) {
    segs[i].classList.toggle('active', segs[i].getAttribute('data-t') === settings.theme);
  }
}

/* ---------------- rendering ---------------- */
function visibleNotes() {
  var arr = [];
  for (var i = 0; i < notes.length; i++) if (!notes[i].deleted) arr.push(notes[i]);
  if (filter === 'fav') arr = arr.filter(function (n) { return n.fav; });
  if (query) {
    var q = query.toLowerCase();
    arr = arr.filter(function (n) {
      return ((n.title || '') + ' ' + (n.body || '')).toLowerCase().indexOf(q) !== -1;
    });
  }
  var so = settings.sort || 'edited';
  arr.sort(function (a, b) {
    var p = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (p) return p;
    if (so === 'created') return b.createdAt - a.createdAt;
    if (so === 'title') return (a.title || '~').toLowerCase() < (b.title || '~').toLowerCase() ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return arr;
}

function renderList() {
  var wrap = el('notes');
  wrap.classList.toggle('grid', (settings.view_mode || 'list') === 'grid' && filter !== 'tasks' && filter !== 'trash');
  if (filter === 'tasks') { renderTasks(); return; }
  if (filter === 'trash') { renderTrash(); return; }
  var arr = visibleNotes();
  var alive = 0;
  for (var i = 0; i < notes.length; i++) if (!notes[i].deleted) alive++;
  el('h-count').textContent = alive === 1 ? '1 note' : alive + ' notes';

  if (!arr.length) {
    wrap.innerHTML = '';
    el('empty').classList.remove('hidden');
    if (query) { el('empty-t1').textContent = 'No results'; el('empty-t2').textContent = 'Nothing matches \u201C' + query + '\u201D'; }
    else if (filter === 'fav') { el('empty-t1').textContent = 'No favourites yet'; el('empty-t2').textContent = 'Star a note to see it here'; }
    else { el('empty-t1').textContent = 'No notes yet'; el('empty-t2').textContent = 'Tap + to create your first note'; }
    return;
  }
  el('empty').classList.add('hidden');
  var html = '';
  for (var j = 0; j < arr.length; j++) {
    var n = arr[j];
    var delay = Math.min(j * 30, 180);
    var tasks = parseTasks(n.body);
    var prog = '';
    if (tasks.length) {
      var dn = 0;
      for (var k = 0; k < tasks.length; k++) if (tasks[k].done) dn++;
      prog = '<div class="n-prog"><span style="width:' + Math.round(dn / tasks.length * 100) + '%"></span></div>'
           + '<div class="n-count">' + dn + '/' + tasks.length + ' done</div>';
    }
    var tags = tagsOf(n);
    var tagHtml = '';
    for (var g = 0; g < tags.length && g < 4; g++) tagHtml += '<span class="tag">#' + esc(tags[g]) + '</span>';
    if (tags.length) tagHtml = '<div class="n-tags">' + tagHtml + '</div>';
    html += '<div class="note ripple c' + (n.color || 0) + '" data-id="' + esc(n.id) + '" style="animation-delay:' + delay + 'ms">'
      + '<div class="n-title">' + (n.icon ? '<span class="n-icon">' + esc(n.icon) + '</span>' : '') + (esc(n.title) || 'Untitled') + '</div>'
      + '<div class="n-body">' + esc(previewText(n)) + '</div>'
      + prog + tagHtml
      + '<div class="n-foot"><span>' + fmtDate(n.updatedAt) + '</span><span class="grow"></span>'
      + (n.pinned ? IC.pin : '')
      + (n.fav ? IC.star : '')
      + '</div></div>';
  }
  wrap.innerHTML = html;
}

/* ---------------- tasks view (smart list) ---------------- */
var lastToggle = 0;

function renderTasks() {
  var wrap = el('notes');
  var q = query.trim().toLowerCase();
  var today = startOfDay(Date.now());
  var open = 0, any = false;
  var secs = { today: [], upcoming: [], anytime: [] };
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    if (n.deleted) continue;
    var ts = parseTasks(n.body);
    for (var j = 0; j < ts.length; j++) {
      if (!ts[j].done) open++;
      if (q && (ts[j].text + ' ' + (n.title || '')).toLowerCase().indexOf(q) === -1) continue;
      var it = { n: n, t: ts[j] };
      if (ts[j].due == null) secs.anytime.push(it);
      else if (ts[j].due <= today) secs.today.push(it);
      else secs.upcoming.push(it);
      any = true;
    }
  }
  el('h-count').textContent = open === 1 ? '1 open task' : open + ' open tasks';
  if (!any) {
    wrap.innerHTML = '';
    el('empty').classList.remove('hidden');
    if (q) { el('empty-t1').textContent = 'No tasks'; el('empty-t2').textContent = 'Nothing matches \u201C' + query + '\u201D'; }
    else { el('empty-t1').textContent = 'No tasks yet'; el('empty-t2').textContent = 'Add \u201C- [ ] \u201D in any note, or start from a template'; }
    return;
  }
  el('empty').classList.add('hidden');
  var html = '';
  var order = [['today', 'Today'], ['upcoming', 'Upcoming'], ['anytime', 'Anytime']];
  for (var s = 0; s < order.length; s++) {
    var list = secs[order[s][0]];
    if (!list.length) continue;
    html += '<div class="task-sec"><div class="task-sh"><span>' + order[s][1] + '</span><span>' + list.length + '</span></div>';
    for (var r = 0; r < list.length; r++) {
      var n2 = list[r].n, t = list[r].t;
      var lbl = t.due == null ? '' : dueLabel(t.due);
      var over = t.due != null && t.due < today;
      html += '<div class="task' + (t.done ? ' done' : '') + '" data-id="' + esc(n2.id) + '">'
        + '<button class="check" data-act="toggle" data-id="' + esc(n2.id) + '" data-line="' + t.line + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>'
        + '<div class="t-body"><div class="t-text">' + (esc(t.text) || '<i>Empty task</i>') + '</div>'
        + '<div class="t-note">' + (n2.icon ? esc(n2.icon) + ' ' : '') + (esc(n2.title) || 'Untitled') + '</div></div>'
        + (lbl ? '<span class="t-due' + (over ? ' over' : '') + '">' + lbl + '</span>' : '')
        + '</div>';
    }
    html += '</div>';
  }
  wrap.innerHTML = html;
}

function toggleTask(id, lineIdx) {
  var now = Date.now();
  if (now - lastToggle < 250) return;
  lastToggle = now;
  var n = null;
  for (var i = 0; i < notes.length; i++) if (notes[i].id === id) { n = notes[i]; break; }
  if (!n) return;
  var lines = (n.body || '').split('\n');
  var ln = lines[lineIdx];
  var m = ln ? ln.match(/^(\s*)- \[([ xX])\]/) : null;
  if (!m) { renderList(); return; }
  var rest = ln.slice(m[0].length);
  var newDone = m[2].toLowerCase() !== 'x';
  lines[lineIdx] = m[1] + '- [' + (newDone ? 'x' : ' ') + ']' + rest;
  n.body = lines.join('\n');
  n.updatedAt = Date.now();
  persist();
  if (editingId === id) { el('e-body').value = n.body; autosize(); }
  var row = document.querySelector('.check[data-id="' + id + '"][data-line="' + lineIdx + '"]');
  if (row && row.parentNode) row.parentNode.classList.toggle('done', newDone);
  setTimeout(function () {
    if (screenNow === 'view' && viewingId) renderView(viewingId);
    else renderList();
  }, 320);
}

/* ---------------- trash ---------------- */
function renderTrash() {
  var wrap = el('notes');
  var del = [];
  for (var i = 0; i < notes.length; i++) {
    if (notes[i].deleted && !notes[i].purged) del.push(notes[i]);
  }
  del.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  el('h-count').textContent = del.length === 1 ? '1 note in trash' : del.length + ' notes in trash';
  if (!del.length) {
    wrap.innerHTML = '';
    el('empty').classList.remove('hidden');
    el('empty-t1').textContent = 'Trash is empty';
    el('empty-t2').textContent = 'Deleted notes land here before they\u2019re gone forever';
    return;
  }
  el('empty').classList.add('hidden');
  var html = '<div class="task-sec" style="animation-delay:0ms"><button class="sheet-row ripple danger" data-act="empty-trash" style="justify-content:center">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2c.1 1 .9 1.8 2 1.8h6c1.1 0 1.9-.8 2-1.8L18 7M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>Empty trash</button></div>';
  for (var j = 0; j < del.length; j++) {
    var n = del[j];
    html += '<div class="note trash-n c' + (n.color || 0) + '" style="animation-delay:' + Math.min(j * 30, 180) + 'ms">'
      + '<div class="n-title">' + (n.icon ? '<span class="n-icon">' + esc(n.icon) + '</span>' : '') + (esc(n.title) || 'Untitled') + '</div>'
      + '<div class="n-body">' + esc(previewText(n)) + '</div>'
      + '<div class="n-act"><span class="grow"></span>'
      + '<button class="tbtn r" data-a="restore" data-id="' + esc(n.id) + '">Restore</button>'
      + '<button class="tbtn d" data-a="purge" data-id="' + esc(n.id) + '">Delete forever</button>'
      + '</div></div>';
  }
  wrap.innerHTML = html;
}

function restoreNote(id) {
  var n = findNote(id);
  if (!n) return;
  n.deleted = false;
  n.purged = false;
  n.updatedAt = Date.now();
  persist();
  renderList();
  toastUI('Note restored');
}

function purgeNote(id) {
  var n = findNote(id);
  if (!n) return;
  n.purged = true;
  n.updatedAt = Date.now();
  persist();
  renderList();
  toastUI('Deleted forever');
}

function emptyTrash() {
  var any = false;
  for (var i = 0; i < notes.length; i++) {
    if (notes[i].deleted && !notes[i].purged) {
      notes[i].purged = true;
      notes[i].updatedAt = Date.now();
      any = true;
    }
  }
  if (any) { persist(); renderList(); toastUI('Trash emptied'); }
}

/* ---------------- note view (rendered page) ---------------- */
var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function inlineHTML(s) {
  var e = esc(s);
  e = e.replace(/\[\[([^\]]+)\]\]/g, '<span class="nlink" data-link="$1">$1</span>');
  e = e.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  e = e.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  e = e.replace(/`([^`]+)`/g, '<code>$1</code>');
  e = e.replace(/(^|\s)#([\w-]+)/g, '$1<span class="tag">#$2</span>');
  e = e.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  return e;
}

function blocksHTML(body) {
  var lines = (body || '').split('\n');
  var out = '';
  var i = 0;
  var today = startOfDay(Date.now());
  while (i < lines.length) {
    var t = (lines[i] || '').trim();
    if (!t) { i++; continue; }
    if (t === '```') {
      var buf = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') { buf.push(lines[i]); i++; }
      i++;
      out += '<div class="b-code">' + esc(buf.join('\n')) + '</div>';
      continue;
    }
    if (t === '---' || t === '***') { out += '<div class="b-div"></div>'; i++; continue; }
    var m = t.match(/^- \[([ xX])\] ?(.*)$/);
    if (m) {
      var done = m[1].toLowerCase() === 'x';
      var rest = m[2] || '';
      var dm = rest.match(DUE_RE);
      var dueTxt = dm ? rest.replace(DUE_RE, '').trim() : rest;
      var due = null;
      if (dm) {
        var w = dm[1].toLowerCase();
        if (w === 'today') due = today;
        else if (w === 'tomorrow') due = today + 86400000;
        else due = startOfDay(new Date(w + 'T00:00:00').getTime());
      }
      out += '<div class="b-task' + (done ? ' done' : '') + '">'
        + '<button class="check" data-act="toggle" data-id="' + esc(viewingId) + '" data-line="' + i + '">' + CHECK_SVG + '</button>'
        + '<span class="t-text">' + inlineHTML(dueTxt)
        + (due != null ? ' <span class="t-due' + (due < today ? ' over' : '') + '">' + dueLabel(due) + '</span>' : '')
        + '</span></div>';
      i++;
      continue;
    }
    if ((m = t.match(/^## (.+)$/))) { out += '<div class="b-h2">' + inlineHTML(m[1]) + '</div>'; i++; continue; }
    if ((m = t.match(/^# (.+)$/))) { out += '<div class="b-h1">' + inlineHTML(m[1]) + '</div>'; i++; continue; }
    if ((m = t.match(/^!! (.+)$/))) { out += '<div class="b-callout">' + inlineHTML(m[1]) + '</div>'; i++; continue; }
    if ((m = t.match(/^> (.*)$/))) { out += '<div class="b-quote">' + inlineHTML(m[1]) + '</div>'; i++; continue; }
    if (t.charAt(0) === '|' && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      var cells = function (row) {
        return row.replace(/^\|/, '').replace(/\|$/, '').split('|');
      };
      var head = cells(t);
      i += 2;
      var rows = [];
      while (i < lines.length && (lines[i] || '').trim().charAt(0) === '|') {
        rows.push(cells(lines[i].trim()));
        i++;
      }
      var tb = '<div class="b-table-wrap"><table class="b-table"><tr>';
      for (var h = 0; h < head.length; h++) tb += '<th>' + inlineHTML(head[h].trim()) + '</th>';
      tb += '</tr>';
      for (var r = 0; r < rows.length; r++) {
        tb += '<tr>';
        for (var c = 0; c < head.length; c++) tb += '<td>' + inlineHTML((rows[r][c] || '').trim()) + '</td>';
        tb += '</tr>';
      }
      out += tb + '</table></div>';
      continue;
    }
    if ((m = t.match(/^- (.*)$/))) {
      out += '<div class="b-bullet"><span class="dot"></span><span>' + inlineHTML(m[1]) + '</span></div>';
      i++;
      continue;
    }
    var para = [t];
    i++;
    while (i < lines.length) {
      var nt = (lines[i] || '').trim();
      if (!nt) break;
      if (/^(#{1,2} |>|!! |- |```|---$|\|)/.test(nt)) break;
      para.push(nt);
      i++;
    }
    out += '<div class="b-para">' + inlineHTML(para.join(' ')) + '</div>';
  }
  return out || '<div class="b-para v-empty">Empty note \u2014 tap Edit to start writing</div>';
}

function renderView(id) {
  var n = findNote(id);
  if (!n) return;
  viewingId = id;
  var cov = el('v-cover');
  cov.className = 'v-cover' + (n.cover ? ' cv' + n.cover : '');
  cov.style.display = n.cover ? '' : 'none';
  var ic = el('v-icon');
  ic.textContent = n.icon || '';
  ic.style.display = n.icon ? '' : 'none';
  el('v-title').textContent = n.title || 'Untitled';
  el('v-body').innerHTML = blocksHTML(n.body);
  var words = (n.body || '').trim() ? n.body.trim().split(/\s+/).length : 0;
  var ts = parseTasks(n.body);
  var dn = 0;
  for (var k = 0; k < ts.length; k++) if (ts[k].done) dn++;
  el('v-meta').textContent = 'Created ' + fmtDate(n.createdAt) + ' \u00B7 Edited ' + rel(n.updatedAt) + ' \u00B7 ' + words + (words === 1 ? ' word' : ' words') + (ts.length ? ' \u00B7 ' + dn + '/' + ts.length + ' tasks done' : '');
  el('btn-view-pin').innerHTML = n.pinned ? IC.pin : IC.pinO;
  el('btn-view-pin').style.color = n.pinned ? 'var(--accent)' : '';
  el('btn-view-star').innerHTML = n.fav ? IC.star : IC.starO;
  el('btn-view-star').style.color = n.fav ? 'var(--accent)' : '';
}

function openView(id) {
  if (!findNote(id)) return;
  viewingId = id;
  renderView(id);
  el('view-scroll').scrollTop = 0;
  show('view');
}

function sheetCovers() {
  var n = activeNote();
  if (!n) return;
  var html = '<div class="sheet-title">Cover</div><div class="cov-grid">';
  html += '<button class="cov' + (!n.cover ? ' sel' : '') + '" data-act="cov:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  for (var i = 1; i <= 8; i++) {
    html += '<button class="cov cv' + i + ((n.cover || 0) === i ? ' sel' : '') + '" data-act="cov:' + i + '"></button>';
  }
  openSheet(html + '</div>');
}

function sheetNotePicker() {
  var html = '<div class="sheet-title">Link to note</div>';
  var arr = [];
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    if (!n.deleted && n.id !== editingId && (n.title || '').trim()) arr.push(n);
  }
  arr.sort(function (a, b) { return (a.title || '').toLowerCase() < (b.title || '').toLowerCase() ? -1 : 1; });
  if (!arr.length) html += '<div class="sheet-sub">No other titled notes yet \u2014 title a note first.</div>';
  for (var j = 0; j < arr.length; j++) {
    html += '<button class="sheet-row ripple" data-act="lnk" data-v="' + esc(arr[j].id) + '">'
      + '<span class="sr-ic">' + (arr[j].icon || '') + '</span>' + esc(arr[j].title) + '</button>';
  }
  openSheet(html);
}

/* ---------------- screens ---------------- */
function show(scr) {
  screenNow = scr;
  var ids = ['s-list', 's-view', 's-editor', 's-settings'];
  for (var i = 0; i < ids.length; i++) {
    var e = el(ids[i]);
    if (ids[i] === 's-' + scr) e.classList.add('cur');
    else e.classList.remove('cur');
  }
  el('s-list').classList.toggle('back', scr !== 'list');
}

window.handleBack = function () {
  if (el('slash').classList.contains('show')) { el('slash').classList.remove('show'); return 'handled'; }
  if (el('sheet').classList.contains('show')) { closeSheet(); return 'handled'; }
  if (screenNow === 'view') { show('list'); return 'handled'; }
  if (screenNow === 'editor') { backFromEditor(); return 'handled'; }
  if (screenNow === 'settings') { show('list'); return 'handled'; }
  return 'exit';
};

/* ---------------- editor ---------------- */
function openEditor(id, from) {
  editorFrom = from || 'list';
  editingId = id;
  var n = currentNote();
  var isNew = !n;
  if (isNew) {
    n = { id: id, title: '', body: '', color: 0, pinned: false, fav: false, createdAt: Date.now(), updatedAt: Date.now(), deleted: false };
    notes.push(n);
  }
  el('e-title').value = n.title || '';
  el('e-body').value = n.body || '';
  autosize();
  updateStar();
  updateIconBtn(n);
  updateMeta(n);
  el('editor-scroll').scrollTop = 0;
  show('editor');
  if (isNew) setTimeout(function () { el('e-title').focus(); }, 360);
}

function currentNote() {
  for (var i = 0; i < notes.length; i++) if (notes[i].id === editingId) return notes[i];
  return null;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}

function flushSave() {
  clearTimeout(saveTimer);
  var n = currentNote();
  if (!n) return;
  n.title = el('e-title').value;
  n.body = el('e-body').value;
  n.updatedAt = Date.now();
  persist();
  updateMeta(n);
}

function updateMeta(n) {
  if (!n) return;
  var words = (n.body || '').trim() ? n.body.trim().split(/\s+/).length : 0;
  el('e-meta').textContent = 'Edited ' + rel(n.updatedAt) + ' \u00B7 ' + words + (words === 1 ? ' word' : ' words') + ' \u00B7 Saved';
}

function updateStar() {
  var n = currentNote();
  el('btn-star').innerHTML = (n && n.fav) ? IC.star : IC.starO;
  el('btn-star').style.color = (n && n.fav) ? 'var(--accent)' : '';
}

function updateIconBtn(n) {
  el('btn-icon').innerHTML = (n && n.icon) ? esc(n.icon) : IC.iconAdd;
}

function autosize() {
  var b = el('e-body');
  b.style.height = 'auto';
  b.style.height = Math.max(b.scrollHeight, 300) + 'px';
}

function backFromEditor() {
  flushSave();
  var n = currentNote();
  if (n && !(n.title || '').trim() && !(n.body || '').trim()) {
    notes = notes.filter(function (x) { return x.id !== n.id; });
    persist();
  }
  editingId = null;
  renderList();
  if (editorFrom === 'view' && viewingId && findNote(viewingId) && !findNote(viewingId).deleted) {
    renderView(viewingId);
    show('view');
  } else {
    show('list');
  }
}

function deleteNote(id) {
  var n = null;
  for (var i = 0; i < notes.length; i++) if (notes[i].id === id) { n = notes[i]; break; }
  if (!n) return;
  n.deleted = true;
  n.updatedAt = Date.now();
  persist();
  if (editingId === id) { editingId = null; show('list'); }
  else if (viewingId === id) { viewingId = null; show('list'); }
  renderList();
  toastUI('Note deleted', 'Undo', function () {
    n.deleted = false;
    n.updatedAt = Date.now();
    persist();
    renderList();
  });
}

/* ---------------- editor insert helpers ---------------- */
function insertText(txt) {
  var ta = el('e-body');
  var pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + txt + ta.value.slice(ta.selectionEnd);
  var np = pos + txt.length;
  ta.setSelectionRange(np, np);
  ta.focus();
  autosize(); queueSave();
}

function insertAtLine(prefix) {
  var ta = el('e-body');
  var pos = ta.selectionStart;
  var val = ta.value;
  var ls = val.lastIndexOf('\n', pos - 1) + 1;
  if (val.slice(ls, ls + prefix.length) === prefix) {
    ta.value = val.slice(0, ls) + val.slice(ls + prefix.length);
    var np = Math.max(ls, pos - prefix.length);
    ta.setSelectionRange(np, np);
  } else {
    ta.value = val.slice(0, ls) + prefix + val.slice(ls);
    ta.setSelectionRange(pos + prefix.length, pos + prefix.length);
  }
  ta.focus();
  autosize(); queueSave();
}

function slashCheck() {
  var ta = el('e-body');
  var pos = ta.selectionStart;
  var val = ta.value;
  var ls = val.lastIndexOf('\n', pos - 1) + 1;
  el('slash').classList.toggle('show', val.slice(ls, pos) === '/');
}

/* ---------------- bottom sheets ---------------- */
function openSheet(html) {
  el('sheet-body').innerHTML = html;
  el('sheet').classList.add('show');
  el('overlay').classList.add('show');
}
function closeSheet() {
  el('sheet').classList.remove('show');
  el('overlay').classList.remove('show');
}

function sheetMain() {
  openSheet(
    '<button class="sheet-row ripple" data-act="sync">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-2.7M4 13a8 8 0 0 0 14.9 2.7"/><path d="M4.5 3.5v5h5M19.5 20.5v-5h-5"/></svg>Sync now</button>'
    + '<button class="sheet-row ripple" data-act="template">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>New from template</button>'
    + '<button class="sheet-row ripple" data-act="sort">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>Sort notes by</button>'
    + '<button class="sheet-row ripple" data-act="trash">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2c.1 1 .9 1.8 2 1.8h6c1.1 0 1.9-.8 2-1.8L18 7M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>Trash</button>'
    + '<button class="sheet-row ripple" data-act="export">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>Export backup</button>'
    + '<button class="sheet-row ripple" data-act="import">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 19h16"/></svg>Import backup</button>'
    + '<button class="sheet-row ripple" data-act="settings">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34 1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>Settings</button>'
  );
}

function sheetNoteMenu() {
  var n = activeNote();
  if (!n) return;
  openSheet(
    '<div class="sheet-title">' + (esc(n.title) || 'Untitled note') + '</div>'
    + '<button class="sheet-row ripple" data-act="pin">' + IC.pinO + (n.pinned ? 'Unpin note' : 'Pin note') + '</button>'
    + '<button class="sheet-row ripple" data-act="icon">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2c.7-1 1.9-1.6 3.5-1.6s2.8.6 3.5 1.6M9 9.2h.01M15 9.2h.01"/></svg>Change icon</button>'
    + '<button class="sheet-row ripple" data-act="cover">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 15l4-4 5 5M14 13l2-2 4 4"/><circle cx="15.5" cy="9" r="1.3" fill="currentColor" stroke="none"/></svg>Cover image</button>'
    + '<button class="sheet-row ripple" data-act="share">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M8 12H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/></svg>Share note</button>'
    + '<button class="sheet-row ripple" data-act="colour">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/></svg>Change colour</button>'
    + '<button class="sheet-row ripple" data-act="dup">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>Duplicate note</button>'
    + '<button class="sheet-row ripple danger" data-act="delete">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2c.1 1 .9 1.8 2 1.8h6c1.1 0 1.9-.8 2-1.8L18 7M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>Delete note</button>'
  );
}

function sheetConfirmDelete() {
  openSheet(
    '<div class="sheet-title">Delete note?</div>'
    + '<div class="sheet-sub">This note will be removed from all synced devices.</div>'
    + '<div class="sheet-actions">'
    + '<button class="sheet-btn plain" data-act="cancel">Cancel</button>'
    + '<button class="sheet-btn danger" data-act="confirm-delete">Delete</button>'
    + '</div>'
  );
}

function sheetColours() {
  var n = activeNote();
  if (!n) return;
  var html = '<div class="sheet-title">Note colour</div><div class="swatches">';
  for (var i = 0; i < SWATCH.length; i++) {
    var inner = i === 0
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      : '';
    var bgc = i === 0 ? 'background:var(--surface2);border:2px solid var(--divider)' : 'background:' + SWATCH[i];
    html += '<button class="sw' + ((n.color || 0) === i ? ' sel' : '') + '" data-act="colour:' + i + '" style="' + bgc + ';animation-delay:' + (i * 16) + 'ms">' + inner + '</button>';
  }
  openSheet(html + '</div>');
}

function sheetTemplates() {
  var html = '<div class="sheet-title">New from template</div>';
  for (var i = 0; i < TEMPLATES.length; i++) {
    var t = TEMPLATES[i];
    html += '<button class="sheet-row ripple" data-act="tpl:' + i + '">'
      + '<span class="sr-ic">' + (t.ic || '\uFF0B') + '</span>'
      + '<span>' + t.name + '<span class="sr-sub">' + t.desc + '</span></span></button>';
  }
  openSheet(html);
}

function sheetSort() {
  var opts = [['edited', 'Last edited'], ['created', 'Recently created'], ['title', 'Title (A\u2013Z)']];
  var cur = settings.sort || 'edited';
  var html = '<div class="sheet-title">Sort notes by</div>';
  for (var i = 0; i < opts.length; i++) {
    html += '<button class="sheet-row ripple" data-act="sort:' + opts[i][0] + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>'
      + opts[i][1]
      + (cur === opts[i][0] ? '<span class="grow"></span><span class="sel-mark">\u2713</span>' : '')
      + '</button>';
  }
  openSheet(html);
}

function sheetIcons() {
  var n = activeNote();
  if (!n) return;
  var html = '<div class="sheet-title">Note icon</div><div class="pick-grid">';
  for (var i = 0; i < EMOJIS.length; i++) {
    var e = EMOJIS[i];
    if (!e) {
      html += '<button class="pick' + (n.icon ? '' : ' sel') + '" data-act="noicon">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    } else {
      html += '<button class="pick' + (n.icon === e ? ' sel' : '') + '" data-act="seticon" data-v="' + e + '" style="animation-delay:' + (i * 12) + 'ms">' + e + '</button>';
    }
  }
  openSheet(html + '</div>');
}

function createFromTemplate(idx) {
  var t = TEMPLATES[idx];
  if (!t) return;
  var id = uid();
  notes.push({
    id: id, title: (t.title || '').replace('<date>', fmtDate(Date.now())), body: t.body || '',
    icon: t.ic || '', color: 0, pinned: false, fav: false,
    createdAt: Date.now(), updatedAt: Date.now(), deleted: false
  });
  persist();
  renderList();
  openEditor(id);
}

function duplicateNote() {
  var n = activeNote();
  if (!n) return;
  notes.push({
    id: uid(), title: (n.title || 'Untitled') + ' (copy)', body: n.body || '',
    icon: n.icon || '', color: n.color || 0, pinned: false, fav: false,
    createdAt: Date.now(), updatedAt: Date.now(), deleted: false
  });
  persist();
  renderList();
  toastUI('Note duplicated');
}

/* ---------------- toast ---------------- */
function toastUI(msg, actLabel, actFn) {
  var t = el('toast');
  el('toast-msg').textContent = msg;
  var act = el('toast-act');
  if (actLabel) {
    act.textContent = actLabel;
    act.style.display = 'inline';
    act.onclick = function () {
      t.classList.remove('show');
      if (actFn) actFn();
    };
  } else {
    act.style.display = 'none';
    act.onclick = null;
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, actLabel ? 5000 : 2600);
}

/* ---------------- sync ---------------- */
function doSync() {
  var isGh = (settings.sync_provider || 'github') === 'github';
  if (isGh && !settings.gh_token) {
    toastUI('Add a GitHub token to sync', 'Settings', function () { openSettings(); });
    return;
  }
  if (!isGh && !settings.webdav_url) {
    toastUI('Set up a WebDAV server first', 'Settings', function () { openSettings(); });
    return;
  }
  var btn = el('btn-sync-now');
  if (btn) btn.classList.add('busy');
  toastUI('Syncing\u2026');
  NB.sync();
}

window.onSyncResult = function (msg) {
  var btn = el('btn-sync-now');
  if (btn) btn.classList.remove('busy');
  var i = msg.indexOf('|');
  var st = i < 0 ? 'err' : msg.slice(0, i);
  var text = i < 0 ? msg : msg.slice(i + 1);
  hidePtr();
  toastUI(text);
  if (st === 'ok') {
    loadAll();
    if (screenNow === 'list') renderList();
  }
};

/* ---------------- import / export ---------------- */
window.importNotes = function (payload) {
  var inc;
  try { inc = JSON.parse(payload); } catch (e) { inc = null; }
  if (!Array.isArray(inc)) { toastUI('That file is not a valid backup'); return; }
  var map = {};
  for (var i = 0; i < notes.length; i++) map[notes[i].id] = notes[i];
  var added = 0, updated = 0;
  for (var j = 0; j < inc.length; j++) {
    var n = inc[j];
    if (!n || !n.id) continue;
    var cur = map[n.id];
    if (!cur) { map[n.id] = n; added++; }
    else if ((n.updatedAt || 0) > (cur.updatedAt || 0)) { map[n.id] = n; updated++; }
  }
  var out = [];
  for (var k in map) if (map.hasOwnProperty(k)) out.push(map[k]);
  notes = out;
  persist();
  renderList();
  toastUI('Imported ' + added + ' new, ' + updated + ' updated');
};

function exportBackup() {
  var alive = [];
  for (var i = 0; i < notes.length; i++) if (!notes[i].deleted) alive.push(notes[i]);
  NB.exportNotes(JSON.stringify(alive));
}

/* ---------------- settings ---------------- */
function applyProvider() {
  var p = settings.sync_provider || 'github';
  var segs = document.querySelectorAll('#provider-seg button');
  for (var i = 0; i < segs.length; i++) {
    segs[i].classList.toggle('active', segs[i].getAttribute('data-p') === p);
  }
  el('prov-github').classList.toggle('hidden', p !== 'github');
  el('prov-webdav').classList.toggle('hidden', p !== 'webdav');
}

function openSettings() {
  el('f-url').value = settings.webdav_url || '';
  el('f-user').value = settings.webdav_user || '';
  el('f-pass').value = settings.webdav_pass || '';
  el('f-token').value = settings.gh_token || '';
  el('f-repo').value = settings.gh_repo || 'gitnotes-sync';
  el('f-autosync').checked = settings.autosync === '1';
  applyProvider();
  applyTheme();
  show('settings');
}

/* ---------------- pull to refresh ---------------- */
var ptrStartY = null, ptrDist = 0, ptrActive = false, ptrHideTimer = null;
function setPtr(d, spin) {
  var w = el('ptr');
  var c = w.querySelector('.ptr-c');
  w.classList.toggle('live', d > 0 || !!spin);
  c.style.transform = 'translateY(' + d + 'px)';
  c.style.opacity = (d > 0 || spin) ? '1' : '0';
  c.classList.toggle('spin', !!spin);
}
function hidePtr() {
  clearTimeout(ptrHideTimer);
  setPtr(0, false);
  el('ptr').classList.remove('live');
}

/* ---------------- events ---------------- */
function wire() {
  /* ripple */
  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest ? e.target.closest('.ripple') : null;
    if (!t) return;
    var r = t.getBoundingClientRect();
    var rip = document.createElement('span');
    rip.className = 'rip';
    var size = Math.max(r.width, r.height) * 1.15;
    rip.style.width = rip.style.height = size + 'px';
    rip.style.left = (e.clientX - r.left - size / 2) + 'px';
    rip.style.top = (e.clientY - r.top - size / 2) + 'px';
    t.appendChild(rip);
    setTimeout(function () { if (rip.parentNode) rip.parentNode.removeChild(rip); }, 600);
  });

  /* collapsing header + pull to refresh */
  var sc = el('list-scroll');
  sc.addEventListener('scroll', function () {
    el('hdr').classList.toggle('compact', sc.scrollTop > 14);
  }, { passive: true });
  sc.addEventListener('touchstart', function (e) {
    if (sc.scrollTop <= 0) { ptrStartY = e.touches[0].clientY; ptrActive = false; }
    else ptrStartY = null;
  }, { passive: true });
  sc.addEventListener('touchmove', function (e) {
    if (ptrStartY == null) return;
    var dy = e.touches[0].clientY - ptrStartY;
    if (dy > 10 && sc.scrollTop <= 0) {
      ptrActive = true;
      ptrDist = Math.min(dy * 0.45, 72);
      setPtr(ptrDist, false);
    } else if (dy < -10) {
      ptrStartY = null; ptrActive = false; hidePtr();
    }
  }, { passive: true });
  sc.addEventListener('touchend', function () {
    if (ptrActive) {
      if (ptrDist >= 52) {
        setPtr(52, true);
        clearTimeout(ptrHideTimer);
        ptrHideTimer = setTimeout(hidePtr, 4000);
        doSync();
      } else {
        hidePtr();
      }
    }
    ptrStartY = null; ptrActive = false;
  });

  /* list + tasks + trash clicks */
  el('fab').addEventListener('click', function () { openEditor(uid()); });
  el('notes').addEventListener('click', function (e) {
    var ea = e.target.closest ? e.target.closest('[data-act]') : null;
    if (ea && ea.getAttribute('data-act') === 'empty-trash') { emptyTrash(); return; }
    var tb = e.target.closest ? e.target.closest('.tbtn') : null;
    if (tb) {
      if (tb.getAttribute('data-a') === 'restore') restoreNote(tb.getAttribute('data-id'));
      else purgeNote(tb.getAttribute('data-id'));
      return;
    }
    if (e.target.closest && e.target.closest('.trash-n')) return;
    var cb = e.target.closest ? e.target.closest('.check') : null;
    if (cb) {
      e.stopPropagation();
      toggleTask(cb.getAttribute('data-id'), parseInt(cb.getAttribute('data-line'), 10));
      return;
    }
    var tk = e.target.closest ? e.target.closest('.task') : null;
    if (tk) { openView(tk.getAttribute('data-id')); return; }
    var c = e.target.closest ? e.target.closest('.note') : null;
    if (c) openView(c.getAttribute('data-id'));
  });
  el('btn-menu').addEventListener('click', sheetMain);
  el('btn-viewmode').addEventListener('click', function () {
    settings.view_mode = (settings.view_mode === 'grid') ? 'list' : 'grid';
    NB.setSetting('view_mode', settings.view_mode);
    updateViewModeBtn();
    renderList();
  });

  /* note view */
  el('btn-view-back').addEventListener('click', function () { show('list'); });
  el('btn-view-pin').addEventListener('click', function () {
    var n = findNote(viewingId);
    if (!n) return;
    n.pinned = !n.pinned;
    n.updatedAt = Date.now();
    persist();
    renderView(viewingId);
  });
  el('btn-view-star').addEventListener('click', function () {
    var n = findNote(viewingId);
    if (!n) return;
    n.fav = !n.fav;
    n.updatedAt = Date.now();
    persist();
    renderView(viewingId);
    var sb = el('btn-view-star');
    sb.classList.remove('pop');
    void sb.offsetWidth;
    sb.classList.add('pop');
    setTimeout(function () { sb.classList.remove('pop'); }, 500);
  });
  el('btn-view-menu').addEventListener('click', sheetNoteMenu);
  el('v-fab').addEventListener('click', function () { openEditor(viewingId, 'view'); });
  el('v-body').addEventListener('click', function (e) {
    var cb = e.target.closest ? e.target.closest('.check') : null;
    if (cb) {
      e.stopPropagation();
      toggleTask(cb.getAttribute('data-id'), parseInt(cb.getAttribute('data-line'), 10));
      return;
    }
    var ln = e.target.closest ? e.target.closest('.nlink') : null;
    if (!ln) return;
    var title = ln.getAttribute('data-link') || '';
    var target = null;
    for (var i = 0; i < notes.length; i++) {
      var nn = notes[i];
      if (nn.deleted) continue;
      if ((nn.title || '') === title) { target = nn; break; }
      if (!target && (nn.title || '').toLowerCase().indexOf(title.toLowerCase()) === 0) target = nn;
    }
    if (target) openView(target.id);
    else toastUI('No note titled \u201C' + title + '\u201D');
  });

  var segs = document.querySelectorAll('#nav .seg-btn');
  for (var i = 0; i < segs.length; i++) {
    (function (b) {
      b.addEventListener('click', function () {
        setFilter(b.getAttribute('data-filter'));
      });
    })(segs[i]);
  }

  /* search */
  el('search-input').addEventListener('input', function () {
    query = this.value;
    el('search-box').classList.toggle('has-text', !!query);
    renderList();
  });
  el('search-clear').addEventListener('click', function () {
    el('search-input').value = '';
    query = '';
    el('search-box').classList.remove('has-text');
    renderList();
  });

  /* editor */
  el('btn-back').addEventListener('click', backFromEditor);
  el('btn-star').addEventListener('click', function () {
    var n = currentNote();
    if (!n) return;
    n.fav = !n.fav;
    n.updatedAt = Date.now();
    persist();
    updateStar();
    var sb = el('btn-star');
    sb.classList.remove('pop');
    void sb.offsetWidth;
    sb.classList.add('pop');
    setTimeout(function () { sb.classList.remove('pop'); }, 500);
  });
  el('btn-note-menu').addEventListener('click', sheetNoteMenu);
  el('btn-icon').addEventListener('click', sheetIcons);
  el('etools').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.etool') : null;
    if (!b) return;
    var pre = b.getAttribute('data-pre');
    if (pre === 'tbl') { insertText('\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n'); return; }
    if (pre === 'lnk') { sheetNotePicker(); return; }
    if (pre === '---') insertText('\n---\n');
    else if (pre === '@') insertText(' @today');
    else insertAtLine(pre);
  });
  el('slash').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.sl-row') : null;
    if (!b) return;
    var pre = b.getAttribute('data-pre');
    var ta = el('e-body');
    var pos = ta.selectionStart;
    var ls = ta.value.lastIndexOf('\n', pos - 1) + 1;
    if (ta.value.slice(ls, ls + 1) === '/') {
      ta.value = ta.value.slice(0, ls) + ta.value.slice(ls + 1);
      ta.setSelectionRange(ls, ls);
    }
    el('slash').classList.remove('show');
    if (pre === '---') insertText('\n---\n');
    else insertAtLine(pre);
  });
  el('e-title').addEventListener('input', queueSave);
  el('e-title').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); el('e-body').focus(); }
  });
  el('e-body').addEventListener('input', function () { autosize(); queueSave(); slashCheck(); });

  /* settings */
  el('btn-set-back').addEventListener('click', function () { show('list'); });
  el('f-url').addEventListener('change', function () { settings.webdav_url = this.value.trim(); NB.setSetting('webdav_url', settings.webdav_url); });
  el('f-user').addEventListener('change', function () { settings.webdav_user = this.value; NB.setSetting('webdav_user', settings.webdav_user); });
  el('f-pass').addEventListener('change', function () { settings.webdav_pass = this.value; NB.setSetting('webdav_pass', settings.webdav_pass); });
  el('f-autosync').addEventListener('change', function () { settings.autosync = this.checked ? '1' : '0'; NB.setSetting('autosync', settings.autosync); });
  el('f-token').addEventListener('change', function () { settings.gh_token = this.value.trim(); NB.setSetting('gh_token', settings.gh_token); });
  el('f-repo').addEventListener('change', function () { settings.gh_repo = this.value.trim() || 'gitnotes-sync'; NB.setSetting('gh_repo', settings.gh_repo); });
  var psegs = document.querySelectorAll('#provider-seg button');
  for (var v = 0; v < psegs.length; v++) {
    (function (b) {
      b.addEventListener('click', function () {
        settings.sync_provider = b.getAttribute('data-p');
        NB.setSetting('sync_provider', settings.sync_provider);
        applyProvider();
      });
    })(psegs[v]);
  }
  el('btn-sync-now').addEventListener('click', doSync);
  el('btn-export').addEventListener('click', exportBackup);
  el('btn-import').addEventListener('click', function () { NB.importPick(); });
  var tsegs = document.querySelectorAll('#theme-seg button');
  var themeAnimTimer = null;
  for (var t = 0; t < tsegs.length; t++) {
    (function (b) {
      b.addEventListener('click', function () {
        settings.theme = b.getAttribute('data-t');
        NB.setSetting('theme', settings.theme);
        document.documentElement.classList.add('theme-anim');
        clearTimeout(themeAnimTimer);
        themeAnimTimer = setTimeout(function () {
          document.documentElement.classList.remove('theme-anim');
        }, 450);
        applyTheme();
      });
    })(tsegs[t]);
  }

  /* sheets */
  el('overlay').addEventListener('click', closeSheet);
  el('sheet-body').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    var dv = b.getAttribute('data-v');
    var n = activeNote();
    if (act === 'sync') { closeSheet(); doSync(); }
    else if (act === 'export') { closeSheet(); exportBackup(); }
    else if (act === 'import') { closeSheet(); NB.importPick(); }
    else if (act === 'settings') { closeSheet(); openSettings(); }
    else if (act === 'template') { closeSheet(); setTimeout(sheetTemplates, 180); }
    else if (act === 'sort') { closeSheet(); setTimeout(sheetSort, 180); }
    else if (act === 'trash') { closeSheet(); setFilter('trash'); }
    else if (act === 'icon') { closeSheet(); setTimeout(sheetIcons, 180); }
    else if (act === 'cover') { closeSheet(); setTimeout(sheetCovers, 180); }
    else if (act === 'share' && n) { closeSheet(); NB.shareNote(n.title || 'Untitled', n.body || ''); }
    else if (act === 'lnk') {
      var ln = findNote(dv);
      if (ln && ln.title) insertText('[[' + ln.title + ']]');
      closeSheet();
    }
    else if (act.indexOf('cov:') === 0 && n) {
      n.cover = parseInt(act.slice(4), 10) || 0;
      n.updatedAt = Date.now();
      persist();
      closeSheet();
      if (screenNow === 'view' && viewingId) renderView(viewingId);
      renderList();
    }
    else if (act.indexOf('tpl:') === 0) { closeSheet(); createFromTemplate(parseInt(act.slice(4), 10) || 0); }
    else if (act.indexOf('sort:') === 0) {
      settings.sort = act.slice(5);
      NB.setSetting('sort', settings.sort);
      closeSheet();
      renderList();
    }
    else if (act === 'seticon' && n) { n.icon = dv || ''; n.updatedAt = Date.now(); persist(); updateIconBtn(n); closeSheet(); renderList(); if (screenNow === 'view' && viewingId) renderView(viewingId); }
    else if (act === 'noicon' && n) { n.icon = ''; n.updatedAt = Date.now(); persist(); updateIconBtn(n); closeSheet(); renderList(); if (screenNow === 'view' && viewingId) renderView(viewingId); }
    else if (act === 'dup') { closeSheet(); duplicateNote(); }
    else if (act === 'pin' && n) {
      n.pinned = !n.pinned;
      n.updatedAt = Date.now();
      persist();
      closeSheet();
      if (screenNow === 'view' && viewingId) renderView(viewingId);
    }
    else if (act === 'colour') { closeSheet(); setTimeout(sheetColours, 180); }
    else if (act === 'delete') { closeSheet(); setTimeout(sheetConfirmDelete, 180); }
    else if (act === 'confirm-delete') { closeSheet(); if (editingId) deleteNote(editingId); else if (viewingId) deleteNote(viewingId); }
    else if (act === 'cancel') { closeSheet(); }
    else if (act.indexOf('colour:') === 0 && n) {
      n.color = parseInt(act.split(':')[1], 10) || 0;
      n.updatedAt = Date.now();
      persist();
      closeSheet();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && screenNow === 'editor') flushSave();
  });
}

/* ---------------- init ---------------- */
loadAll();
seedFirstRun();
seedPreview();
applyTheme();
wire();
updateViewModeBtn();
renderList();
show('list');
if (settings.autosync === '1') {
  var pr = settings.sync_provider || 'github';
  var syncReady = pr === 'github' ? settings.gh_token : settings.webdav_url;
  if (syncReady) setTimeout(doSync, 900);
}
