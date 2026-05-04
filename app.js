// =====================================================================
// tasks · oliver & josh
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, getDocs, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 1. firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDu-bAYH7t7rf-y3Fs0K1GjyvjFrSTDSSc",
  authDomain: "tasks-oj.firebaseapp.com",
  projectId: "tasks-oj",
  storageBucket: "tasks-oj.firebasestorage.app",
  messagingSenderId: "165391193367",
  appId: "1:165391193367:web:5c839c148f4b4d00a95352",
};

// 2. tags
const TAGS = {
  "d1-fitness":    { label: "d1 fitness",    color: "red" },
  "atlas-mobile":  { label: "atlas mobile",  color: "purple" },
  "atlas-ceu":     { label: "atlas ceu",     color: "green" },
  "josh-personal": { label: "josh personal", color: "orange" },
  "hospitals":     { label: "hospitals",     color: "yellow" },
  "social-media":  { label: "social media",  color: "blue" },
  "property-inv":  { label: "property inv",  color: "maroon" },
};
const normalizeTagKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const TAG_LOOKUP = {};
for (const id of Object.keys(TAGS)) {
  TAG_LOOKUP[normalizeTagKey(id)] = id;
  TAG_LOOKUP[normalizeTagKey(TAGS[id].label)] = id;
}

// 3. init firebase
let db, firebaseReady = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  firebaseReady = true;
} catch (err) { console.error("firebase init failed:", err); }
const tasksCol = firebaseReady ? collection(db, "tasks") : null;

// 4. dom
const $ = (sel) => document.querySelector(sel);
const oliverList = $("#oliverList");
const joshList = $("#joshList");
const oliverCount = $("#oliverCount");
const joshCount = $("#joshCount");
const quickInput = $("#quickInput");
const quickStatus = $("#quickStatus");
const addBtn = $("#addBtn");
const syncStatus = $("#syncStatus");
const syncPill = $("#syncPill");
const clearDoneBtn = $("#clearDoneBtn");
const heroDate = $("#heroDate");
const sortModeSel = $("#sortMode");
const filterTagSel = $("#filterTag");
const dateModal = $("#dateModal");
const dateModalInput = $("#dateModalInput");
const dateModalClose = $("#dateModalClose");
const dateModalBackdrop = $("#dateModalBackdrop");
const dateModalDone = $("#dateModalDone");
const dateModalClear = $("#dateModalClear");
const dateQuickRow = $("#dateQuickRow");
const dateDayRow = $("#dateDayRow");
const mePill = $("#mePill");
const meLabel = $("#meLabel");
const notifBanner = $("#newTasksBanner");
const notifText = $("#newTasksText");
const notifDismiss = $("#newTasksDismiss");

// 5. state
let tasks = [];
const PEOPLE = ["oliver", "josh"];
const getPref = (k, fallback) => localStorage.getItem(k) || fallback;
const setPref = (k, v) => localStorage.setItem(k, v);

let sortMode = getPref("sortMode", "priority");
let filterTag = getPref("filterTag", "");
sortModeSel.value = sortMode;

let me = getPref("me", "oliver");
if (!PEOPLE.includes(me)) me = "oliver";

function buildFilterOptions() {
  filterTagSel.innerHTML = '<option value="">all tags</option>';
  for (const id of Object.keys(TAGS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = TAGS[id].label;
    filterTagSel.appendChild(opt);
  }
  filterTagSel.value = filterTag;
}
buildFilterOptions();

// 6. identity
function updateMeUI() {
  meLabel.textContent = me;
  document.body.classList.remove("me-oliver", "me-josh");
  document.body.classList.add(`me-${me}`);
}
mePill.addEventListener("click", () => {
  me = me === "oliver" ? "josh" : "oliver";
  setPref("me", me);
  updateMeUI();
  checkForNewTasks();
});
updateMeUI();

// 7. last-seen + notification
function getLastSeen() {
  const k = `lastSeen:${me}`;
  let v = localStorage.getItem(k);
  if (!v) {
    v = String(Date.now());
    localStorage.setItem(k, v);
  }
  return parseInt(v, 10);
}
function bumpLastSeen() {
  localStorage.setItem(`lastSeen:${me}`, String(Date.now()));
}
function checkForNewTasks() {
  if (!notifBanner) return;
  const other = me === "oliver" ? "josh" : "oliver";
  const since = getLastSeen();
  const newOnes = tasks.filter((t) =>
    t.addedBy === other &&
    t.person === me &&
    (t.createdAt || 0) > since
  );
  if (newOnes.length > 0) showNotificationBanner(newOnes, other);
  else hideNotificationBanner();
}
function showNotificationBanner(newOnes, other) {
  let text;
  if (newOnes.length === 1) {
    const t = newOnes[0].text || "a task";
    const trim = t.length > 50 ? t.slice(0, 47) + "…" : t;
    text = `${other} added "${trim}" for you`;
  } else {
    text = `${other} added ${newOnes.length} new tasks for you`;
  }
  notifText.textContent = text;
  notifBanner.hidden = false;
  requestAnimationFrame(() => notifBanner.classList.add("show"));
}
function hideNotificationBanner() {
  notifBanner.classList.remove("show");
  setTimeout(() => { notifBanner.hidden = true; }, 250);
}
notifDismiss.addEventListener("click", () => {
  bumpLastSeen();
  hideNotificationBanner();
});

// 8. auto-lowercase
function bindLowercaseInput(el) {
  if (el.dataset.lcBound) return;
  el.dataset.lcBound = "1";
  el.addEventListener("input", () => {
    if (el.value !== el.value.toLowerCase()) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.toLowerCase();
      try { el.setSelectionRange(start, end); } catch {}
    }
  });
}
function bindLowercaseContentEditable(el) {
  if (el.dataset.lcBound) return;
  el.dataset.lcBound = "1";
  el.addEventListener("input", () => {
    const text = el.textContent;
    if (text !== text.toLowerCase()) {
      const sel = window.getSelection();
      const offset = sel.focusOffset;
      el.textContent = text.toLowerCase();
      const range = document.createRange();
      if (el.firstChild) {
        range.setStart(el.firstChild, Math.min(offset, el.textContent.length));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });
}
bindLowercaseInput(quickInput);
document.querySelectorAll(".manual-input").forEach(bindLowercaseInput);

// 9. hero date
function renderDate() {
  const d = new Date();
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  heroDate.textContent = `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}
renderDate();

// 10. date helpers
const MS_DAY = 86400000;
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function nextWeekday(from, target) {
  const x = new Date(from);
  const diff = (target - x.getDay() + 7) % 7;
  x.setDate(x.getDate() + diff);
  return x;
}
function toDateInputValue(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseDateInputValue(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}
function formatDueLabel(ts) {
  if (!ts) return null;
  const due = startOfDay(new Date(ts)).getTime();
  const today = startOfDay(new Date()).getTime();
  const diffDays = Math.round((due - today) / MS_DAY);
  if (diffDays < 0) {
    if (diffDays === -1) return { label: "yesterday", cls: "overdue" };
    if (diffDays >= -6) return { label: `${-diffDays}d ago`, cls: "overdue" };
    return { label: shortDate(new Date(ts)), cls: "overdue" };
  }
  if (diffDays === 0) return { label: "today", cls: "today" };
  if (diffDays === 1) return { label: "tomorrow", cls: "soon" };
  if (diffDays <= 6) {
    const days = ["sun","mon","tue","wed","thu","fri","sat"];
    return { label: days[new Date(ts).getDay()], cls: "soon" };
  }
  return { label: shortDate(new Date(ts)), cls: "later" };
}
function shortDate(d) {
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// 11. parser
const NAME_PATTERNS = {
  oliver: /\b(oliver|ollie)\b/i,
  josh: /\b(josh|joshua)\b/i,
};
const DAY_MAP = {
  sun:0, sunday:0, mon:1, monday:1, tue:2, tues:2, tuesday:2,
  wed:3, weds:3, wednesday:3, thu:4, thur:4, thurs:4, thursday:4,
  fri:5, friday:5, sat:6, saturday:6,
};
const DAY_KEYS = Object.keys(DAY_MAP).join("|");
const MONTH_MAP = {
  jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,
  jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,
  oct:9,october:9,nov:10,november:10,dec:11,december:11,
};
const MONTH_KEYS = Object.keys(MONTH_MAP).join("|");
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function extractTags(text) {
  const tags = [];
  const cleaned = text.replace(/#([a-zA-Z0-9_-]+)/g, (match, p1) => {
    const id = TAG_LOOKUP[normalizeTagKey(p1)];
    if (id && !tags.includes(id)) { tags.push(id); return " "; }
    return match;
  });
  return { tags, cleaned };
}
function extractDate(text) {
  const lower = text.toLowerCase();
  const now = new Date();
  let m;
  if ((m = lower.match(/\b(today|tonight)\b/))) return { ts: startOfDay(now).getTime(), matched: m[0] };
  if ((m = lower.match(/\b(tomorrow|tmrw|tmr)\b/))) return { ts: startOfDay(addDays(now, 1)).getTime(), matched: m[0] };
  if ((m = lower.match(/\bthis\s+weekend\b/))) return { ts: startOfDay(nextWeekday(now, 6)).getTime(), matched: m[0] };
  if ((m = lower.match(/\bnext\s+week\b/))) return { ts: startOfDay(addDays(now, 7)).getTime(), matched: m[0] };
  if ((m = lower.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/))) {
    const n = parseInt(m[1], 10);
    const unit = m[2].startsWith("week") ? 7 : 1;
    return { ts: startOfDay(addDays(now, n * unit)).getTime(), matched: m[0] };
  }
  const dayRe = new RegExp(`\\b(?:next\\s+)?(${DAY_KEYS})(?:\\s+(?:morning|afternoon|evening|night))?\\b`);
  if ((m = lower.match(dayRe))) {
    const target = DAY_MAP[m[1]];
    let date = nextWeekday(now, target);
    if (/^next\s+/.test(m[0]) && target === now.getDay()) date = addDays(date, 7);
    return { ts: startOfDay(date).getTime(), matched: m[0] };
  }
  const monRe = new RegExp(`\\b(${MONTH_KEYS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`);
  if ((m = lower.match(monRe))) {
    const month = MONTH_MAP[m[1]];
    const day = parseInt(m[2], 10);
    let candidate = new Date(now.getFullYear(), month, day);
    if (candidate.getTime() < startOfDay(now).getTime() - MS_DAY) candidate.setFullYear(now.getFullYear() + 1);
    return { ts: startOfDay(candidate).getTime(), matched: m[0] };
  }
  if ((m = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/))) {
    const mo = parseInt(m[1], 10) - 1;
    const dy = parseInt(m[2], 10);
    let yr = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (yr < 100) yr += 2000;
    if (mo >= 0 && mo < 12 && dy >= 1 && dy <= 31) {
      let candidate = new Date(yr, mo, dy);
      if (!m[3] && candidate.getTime() < startOfDay(now).getTime() - MS_DAY) candidate.setFullYear(yr + 1);
      return { ts: startOfDay(candidate).getTime(), matched: m[0] };
    }
  }
  return { ts: null, matched: null };
}
function extractUrgency(text) {
  let level = 0;
  let cleaned = text;
  cleaned = cleaned.replace(/!{3,}/g, () => { level = Math.max(level, 3); return " "; });
  cleaned = cleaned.replace(/!{2}/g, () => { level = Math.max(level, 2); return " "; });
  cleaned = cleaned.replace(/\b(asap|critical)\b/gi, () => { level = Math.max(level, 3); return " "; });
  cleaned = cleaned.replace(/\burgent\b/gi, () => { level = Math.max(level, 2); return " "; });
  cleaned = cleaned.replace(/\b(important|priority)\b/gi, () => { level = Math.max(level, 1); return " "; });
  cleaned = cleaned.replace(/!\s*$/, () => { level = Math.max(level, 1); return ""; });
  return { urgency: level || null, cleaned };
}
function parseQuickInput(input) {
  const chunks = input
    .split(/\s*[\n,;]\s*|\s+and\s+(?=\b(?:oliver|ollie|josh|joshua)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return chunks.map(parseChunk).filter((t) => t.text);
}
function parseChunk(chunk) {
  let text = chunk;
  const tagResult = extractTags(text);
  text = tagResult.cleaned;
  const tags = tagResult.tags;

  let person = "unassigned";
  if (NAME_PATTERNS.oliver.test(text)) {
    person = "oliver";
    text = text.replace(NAME_PATTERNS.oliver, " ");
  } else if (NAME_PATTERNS.josh.test(text)) {
    person = "josh";
    text = text.replace(NAME_PATTERNS.josh, " ");
  }

  const dateResult = extractDate(text);
  if (dateResult.matched) text = text.replace(new RegExp(escapeRegex(dateResult.matched), "i"), " ");
  const dueDate = dateResult.ts;

  const urgencyResult = extractUrgency(text);
  text = urgencyResult.cleaned;
  const urgency = urgencyResult.urgency;

  text = text
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–—]+/, "")
    .replace(/[\s:\-–—]+$/, "")
    .replace(/^(to|for|should|needs? to|has to|gotta|must)\s+/i, "")
    .toLowerCase()
    .trim();

  return { person, text, dueDate, urgency, tags };
}

// 12. data normalization
function normalizeTask(t) {
  if (typeof t.urgent === "boolean") {
    if (t.urgent && !t.urgency) t.urgency = 2;
    delete t.urgent;
  } else if (typeof t.urgent === "number" && !t.urgency) {
    t.urgency = t.urgent;
    delete t.urgent;
  }
  return t;
}

// 13. sorting
function getSortFn(mode) {
  switch (mode) {
    case "due":
      return (a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const ad = a.dueDate || Number.POSITIVE_INFINITY;
        const bd = b.dueDate || Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.createdAt || 0) - (b.createdAt || 0);
      };
    case "newest":
      return (a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      };
    case "oldest":
      return (a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      };
    case "priority":
    default:
      return (a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.done) {
          const au = a.urgency || 0;
          const bu = b.urgency || 0;
          if (au !== bu) return bu - au;
        }
        const ad = a.dueDate || Number.POSITIVE_INFINITY;
        const bd = b.dueDate || Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.createdAt || 0) - (b.createdAt || 0);
      };
  }
}

// 14. render
function render() {
  const sortFn = getSortFn(sortMode);
  for (const person of PEOPLE) {
    const list = person === "oliver" ? oliverList : joshList;
    const countEl = person === "oliver" ? oliverCount : joshCount;
    let items = tasks.filter((t) => t.person === person);
    if (filterTag) items = items.filter((t) => (t.tags || []).includes(filterTag));
    items.sort(sortFn);
    const open = items.filter((t) => !t.done).length;
    countEl.textContent = `${open} open · ${items.length} total`;
    list.innerHTML = "";
    items.forEach((t) => list.appendChild(buildTaskEl(t)));
  }
}

function buildTaskEl(t) {
  const li = document.createElement("li");
  const lvl = t.urgency || 0;
  li.className = "task-item" + (t.done ? " done" : "") + (lvl ? ` lvl-${lvl}` : "");
  li.dataset.id = t.id;

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "task-checkbox";
  cb.checked = !!t.done;
  cb.addEventListener("change", () => toggleDone(t.id, cb.checked));
  li.appendChild(cb);

  const body = document.createElement("div");
  body.className = "task-body";
  const main = document.createElement("div");
  main.className = "task-main";

  const span = document.createElement("span");
  span.className = "task-text";
  span.textContent = (t.text || "").toLowerCase();
  span.title = "click to edit";
  span.setAttribute("autocapitalize", "none");
  span.setAttribute("spellcheck", "true");
  span.addEventListener("click", () => makeEditable(span, t.id));
  main.appendChild(span);

  const meta = buildMetaEl(t);
  if (meta) main.appendChild(meta);
  body.appendChild(main);

  // notes — plain-text view with click-to-edit
  const notesPanel = document.createElement("div");
  notesPanel.className = "task-notes";
  const hasNotes = !!t.notes;

  const notesView = document.createElement("p");
  notesView.className = "task-notes-text";
  notesView.textContent = (t.notes || "").toLowerCase();
  notesView.title = "click to edit";

  const notesEdit = document.createElement("div");
  notesEdit.className = "task-notes-edit";
  notesEdit.hidden = true;

  const notesArea = document.createElement("textarea");
  notesArea.className = "task-notes-input";
  notesArea.placeholder = "add a note…";
  notesArea.rows = 1;
  notesArea.setAttribute("autocapitalize", "none");
  notesArea.setAttribute("autocorrect", "on");
  notesArea.setAttribute("spellcheck", "true");
  bindLowercaseInput(notesArea);
  notesArea.addEventListener("input", () => autoResize(notesArea));

  const notesSave = document.createElement("button");
  notesSave.type = "button";
  notesSave.className = "task-notes-save";
  notesSave.textContent = "save";

  notesEdit.appendChild(notesArea);
  notesEdit.appendChild(notesSave);
  notesPanel.appendChild(notesView);
  notesPanel.appendChild(notesEdit);
  if (!hasNotes) notesPanel.hidden = true;
  body.appendChild(notesPanel);

  function enterNotesEdit() {
    notesPanel.hidden = false;
    notesView.hidden = true;
    notesEdit.hidden = false;
    notesArea.value = (t.notes || "").toLowerCase();
    requestAnimationFrame(() => {
      autoResize(notesArea);
      notesArea.focus();
      notesArea.setSelectionRange(notesArea.value.length, notesArea.value.length);
    });
  }
  function exitNotesEdit() {
    notesEdit.hidden = true;
    if (t.notes) {
      notesView.hidden = false;
      notesPanel.hidden = false;
    } else {
      notesView.hidden = true;
      notesPanel.hidden = true;
    }
  }

  notesView.addEventListener("click", enterNotesEdit);
  notesSave.addEventListener("click", async () => {
    const v = notesArea.value.trim().toLowerCase();
    if (v !== (t.notes || "")) {
      await updateTask(t.id, { notes: v || null });
      // snapshot will re-render this task
    } else {
      exitNotesEdit();
    }
  });

  const tagPicker = buildTagPickerEl(t);
  body.appendChild(tagPicker);
  li.appendChild(body);

  const actions = buildActionsEl(t, { notesPanel, notesEdit, enterNotesEdit, exitNotesEdit, tagPicker });
  li.appendChild(actions);
  return li;
}

function buildMetaEl(t) {
  const tags = t.tags || [];
  if (!tags.length && !t.dueDate && !t.urgency) return null;
  const meta = document.createElement("div");
  meta.className = "task-meta";

  for (const tagId of tags) {
    const def = TAGS[tagId];
    if (!def) continue;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `task-tag tag-${def.color}`;
    pill.title = "click to remove";
    pill.innerHTML = `<span>${def.label}</span><span class="tag-x" aria-hidden="true">×</span>`;
    pill.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newTags = (t.tags || []).filter((x) => x !== tagId);
      await updateTask(t.id, { tags: newTags });
    });
    meta.appendChild(pill);
  }

  if (t.dueDate) {
    const due = formatDueLabel(t.dueDate);
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `task-due due-${due.cls}`;
    pill.title = "click to change date";
    pill.innerHTML =
      `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>` +
      `<span>${due.label}</span>`;
    pill.addEventListener("click", (e) => { e.stopPropagation(); openDateModal(t); });
    meta.appendChild(pill);
  }

  if (t.urgency) {
    const lvl = t.urgency;
    const u = document.createElement("button");
    u.type = "button";
    u.className = `task-urgency lvl-${lvl}`;
    u.title = lvl === 3 ? "click to clear" : "click to escalate";
    u.innerHTML = `<span>${"!".repeat(lvl)}</span>`;
    u.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = lvl === 3 ? null : lvl + 1;
      await updateTask(t.id, { urgency: next });
    });
    meta.appendChild(u);
  }

  return meta;
}

function buildTagPickerEl(t) {
  const wrap = document.createElement("div");
  wrap.className = "tag-picker";
  wrap.hidden = true;
  const inner = document.createElement("div");
  inner.className = "tag-picker-inner";
  for (const id of Object.keys(TAGS)) {
    const def = TAGS[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tag-option tag-${def.color}`;
    btn.dataset.tagId = id;
    const isOn = (t.tags || []).includes(id);
    if (isOn) btn.classList.add("on");
    btn.innerHTML = `<span>${def.label}</span>`;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const cur = t.tags || [];
      const newTags = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      await updateTask(t.id, { tags: newTags });
    });
    inner.appendChild(btn);
  }
  wrap.appendChild(inner);
  return wrap;
}

function buildActionsEl(t, { notesPanel, notesEdit, enterNotesEdit, exitNotesEdit, tagPicker }) {
  const actions = document.createElement("div");
  actions.className = "task-actions";

  if (!t.dueDate) {
    const b = document.createElement("button");
    b.className = "task-action-btn";
    b.title = "set date";
    b.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
    b.addEventListener("click", () => openDateModal(t));
    actions.appendChild(b);
  }
  if (!t.urgency) {
    const b = document.createElement("button");
    b.className = "task-action-btn";
    b.title = "mark urgent";
    b.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><circle cx="12" cy="19" r="1"/></svg>`;
    b.addEventListener("click", () => updateTask(t.id, { urgency: 1 }));
    actions.appendChild(b);
  }
  const tagBtn = document.createElement("button");
  tagBtn.className = "task-action-btn";
  tagBtn.title = "tags";
  tagBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/></svg>`;
  if ((t.tags || []).length) tagBtn.classList.add("has-data");
  tagBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    tagPicker.hidden = !tagPicker.hidden;
    if (!tagPicker.hidden) tagBtn.classList.add("active"); else tagBtn.classList.remove("active");
  });
  actions.appendChild(tagBtn);

  const notesBtn = document.createElement("button");
  notesBtn.className = "task-action-btn";
  notesBtn.title = "notes";
  notesBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`;
  if (t.notes) notesBtn.classList.add("has-data");
  notesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!notesEdit.hidden) {
      exitNotesEdit();
      notesBtn.classList.remove("active");
    } else {
      enterNotesEdit();
      notesBtn.classList.add("active");
    }
  });
  actions.appendChild(notesBtn);

  const del = document.createElement("button");
  del.className = "task-action-btn task-delete";
  del.title = "delete";
  del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
  del.addEventListener("click", () => removeTask(t.id));
  actions.appendChild(del);

  return actions;
}
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// 15. inline edit
function makeEditable(span, id) {
  if (span.getAttribute("contenteditable") === "true") return;
  span.setAttribute("contenteditable", "true");
  span.focus();
  bindLowercaseContentEditable(span);
  const range = document.createRange();
  range.selectNodeContents(span);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async () => {
    span.removeAttribute("contenteditable");
    const newText = span.textContent.trim().toLowerCase();
    const original = tasks.find((t) => t.id === id);
    if (!original) return;
    if (!newText) { span.textContent = (original.text || "").toLowerCase(); return; }
    const parsed = parseChunk(newText);
    const updates = {};
    if (parsed.text && parsed.text !== original.text) updates.text = parsed.text;
    if (parsed.dueDate && parsed.dueDate !== original.dueDate) updates.dueDate = parsed.dueDate;
    if (parsed.urgency && parsed.urgency > (original.urgency || 0)) updates.urgency = parsed.urgency;
    if (parsed.tags && parsed.tags.length) {
      const merged = Array.from(new Set([...(original.tags || []), ...parsed.tags]));
      if (merged.length !== (original.tags || []).length) updates.tags = merged;
    }
    if (Object.keys(updates).length) await updateTask(id, updates);
    span.removeEventListener("blur", finish);
    span.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); span.blur(); }
    else if (e.key === "Escape") {
      span.textContent = (tasks.find((t) => t.id === id)?.text || "").toLowerCase();
      span.blur();
    }
  };
  span.addEventListener("blur", finish);
  span.addEventListener("keydown", onKey);
}

// 16. date modal
let dateModalTaskId = null;
function openDateModal(task) {
  dateModalTaskId = task.id;
  dateModalInput.value = task.dueDate ? toDateInputValue(task.dueDate) : "";
  dateModal.hidden = false;
  dateModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => dateModal.classList.add("open"));
}
function closeDateModal() {
  dateModal.classList.remove("open");
  dateModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  setTimeout(() => { dateModal.hidden = true; }, 220);
  dateModalTaskId = null;
}
async function commitModalDate(ts) {
  if (!dateModalTaskId) return;
  await updateTask(dateModalTaskId, { dueDate: ts });
  closeDateModal();
}
dateModalClose.addEventListener("click", closeDateModal);
dateModalBackdrop.addEventListener("click", closeDateModal);
dateModalClear.addEventListener("click", () => commitModalDate(null));
dateModalDone.addEventListener("click", () => {
  const ts = parseDateInputValue(dateModalInput.value);
  commitModalDate(ts);
});
dateModalInput.addEventListener("change", () => {
  const ts = parseDateInputValue(dateModalInput.value);
  if (ts !== null) commitModalDate(ts);
});
dateQuickRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".date-quick");
  if (!btn) return;
  const offset = parseInt(btn.dataset.offset, 10);
  commitModalDate(startOfDay(addDays(new Date(), offset)).getTime());
});
// day-of-week — advances to NEXT occurrence (if today is mon, "mon" = 7 days from now)
dateDayRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".date-day");
  if (!btn) return;
  const target = parseInt(btn.dataset.day, 10);
  const x = new Date();
  const diff = (target - x.getDay() + 7) % 7;
  x.setDate(x.getDate() + (diff === 0 ? 7 : diff));
  commitModalDate(startOfDay(x).getTime());
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !dateModal.hidden) closeDateModal();
});

// 17. firestore crud
async function addTask(person, text, extras = {}) {
  if (!firebaseReady) return alert("firebase not configured.");
  if (!PEOPLE.includes(person) || !text.trim()) return;
  await addDoc(tasksCol, {
    person,
    text: text.trim().toLowerCase(),
    done: false,
    urgency: extras.urgency || null,
    dueDate: extras.dueDate || null,
    tags: extras.tags || [],
    notes: (extras.notes || "").toLowerCase() || null,
    addedBy: me,
    createdAt: Date.now(),
    serverTime: serverTimestamp(),
  });
}
async function updateTask(id, patch) {
  if (!firebaseReady) return;
  if (patch.text !== undefined && typeof patch.text === "string") patch.text = patch.text.toLowerCase();
  if (patch.notes !== undefined && typeof patch.notes === "string") patch.notes = patch.notes.toLowerCase();
  await updateDoc(doc(tasksCol, id), patch);
}
async function toggleDone(id, done) { await updateTask(id, { done }); }
async function removeTask(id) { if (firebaseReady) await deleteDoc(doc(tasksCol, id)); }
async function clearCompleted() {
  if (!firebaseReady) return;
  const snap = await getDocs(query(tasksCol, where("done", "==", true)));
  if (snap.empty) {
    setQuickStatus("nothing to clear", "");
    setTimeout(() => setQuickStatus("", ""), 1600);
    return;
  }
  if (!confirm(`delete ${snap.size} completed task${snap.size === 1 ? "" : "s"}?`)) return;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// 18. realtime sync
function subscribe() {
  if (!firebaseReady) { setSync("offline · firebase not configured", "error"); return; }
  setSync("connecting", "");
  const q = query(tasksCol, orderBy("createdAt", "asc"));
  onSnapshot(q,
    (snap) => {
      tasks = snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() }));
      render();
      checkForNewTasks();
      setSync("synced", "live");
    },
    (err) => { console.error("snapshot error:", err); setSync("sync error", "error"); }
  );
}
function setSync(text, kind) {
  syncStatus.textContent = text;
  syncPill.className = "sync-pill" + (kind ? " " + kind : "");
}

// 19. quick add
async function handleQuickAdd() {
  const note = quickInput.value.trim();
  if (!note) return;
  if (!firebaseReady) { setQuickStatus("firebase not configured", "error"); return; }
  addBtn.disabled = true;
  try {
    const parsed = parseQuickInput(note);
    if (!parsed.length) { setQuickStatus("no tasks found", "error"); return; }
    let added = 0;
    for (const t of parsed) {
      let person = t.person;
      const text = t.text;
      if (!text) continue;
      if (!PEOPLE.includes(person)) {
        const choice = prompt(`who is this for?\n\n"${text}"\n\ntype: oliver, josh, or skip`, "oliver");
        if (!choice) continue;
        const lower = choice.toLowerCase().trim();
        if (lower === "skip") continue;
        if (!PEOPLE.includes(lower)) continue;
        person = lower;
      }
      await addTask(person, text, { dueDate: t.dueDate, urgency: t.urgency, tags: t.tags });
      added++;
    }
    if (added > 0) {
      quickInput.value = "";
      setQuickStatus(`added ${added} task${added === 1 ? "" : "s"}`, "success");
      setTimeout(() => setQuickStatus("", ""), 2200);
    } else {
      setQuickStatus("nothing added", "error");
    }
  } catch (err) {
    console.error(err);
    setQuickStatus("something went wrong", "error");
  } finally {
    addBtn.disabled = false;
  }
}
function setQuickStatus(text, cls) {
  quickStatus.textContent = text;
  quickStatus.className = "qa-status" + (cls ? " " + cls : "");
}

// 20. manual add
document.querySelectorAll(".manual-add").forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const person = form.dataset.person;
    const input = form.querySelector(".manual-input");
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";
    const parsed = parseChunk(raw);
    const text = parsed.text || raw;
    await addTask(person, text, { dueDate: parsed.dueDate, urgency: parsed.urgency, tags: parsed.tags });
  });
});

// 21. wiring
addBtn.addEventListener("click", handleQuickAdd);
quickInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleQuickAdd(); }
});
clearDoneBtn.addEventListener("click", clearCompleted);
sortModeSel.addEventListener("change", () => {
  sortMode = sortModeSel.value;
  setPref("sortMode", sortMode);
  render();
});
filterTagSel.addEventListener("change", () => {
  filterTag = filterTagSel.value;
  setPref("filterTag", filterTag);
  render();
});

// 22. boot
subscribe();
render();
