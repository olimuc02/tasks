// =====================================================================
// Tasks · Oliver & Josh
// Firebase-synced shared task list with built-in Quick Capture parser.
// Features: name routing · natural-language dates · urgency · tags · notes · sort
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------------------
// 1.  Firebase config
// ---------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDu-bAYH7t7rf-y3Fs0K1GjyvjFrSTDSSc",
  authDomain: "tasks-oj.firebaseapp.com",
  projectId: "tasks-oj",
  storageBucket: "tasks-oj.firebasestorage.app",
  messagingSenderId: "165391193367",
  appId: "1:165391193367:web:5c839c148f4b4d00a95352",
};

// ---------------------------------------------------------------------
// 2.  Tag definitions
// ---------------------------------------------------------------------
const TAGS = {
  "d1-fitness":    { label: "D1 Fitness",    color: "red" },
  "atlas-mobile":  { label: "Atlas Mobile",  color: "purple" },
  "atlas-ceu":     { label: "Atlas CEU",     color: "green" },
  "josh-personal": { label: "Josh Personal", color: "orange" },
  "hospitals":     { label: "Hospitals",     color: "yellow" },
  "social-media":  { label: "Social Media",  color: "blue" },
  "property-inv":  { label: "Property Inv",  color: "maroon" },
};

// Build a normalized lookup so #d1fitness, #d1-fitness, #D1Fitness all match.
const normalizeTagKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const TAG_LOOKUP = {};
for (const id of Object.keys(TAGS)) {
  TAG_LOOKUP[normalizeTagKey(id)] = id;
  TAG_LOOKUP[normalizeTagKey(TAGS[id].label)] = id;
}

// ---------------------------------------------------------------------
// 3.  Init Firebase
// ---------------------------------------------------------------------
let db;
let firebaseReady = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  firebaseReady = true;
} catch (err) {
  console.error("Firebase init failed:", err);
}
const tasksCol = firebaseReady ? collection(db, "tasks") : null;

// ---------------------------------------------------------------------
// 4.  DOM
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// 5.  State
// ---------------------------------------------------------------------
let tasks = [];
const PEOPLE = ["oliver", "josh"];

const getPref = (k, fallback) => localStorage.getItem(k) || fallback;
const setPref = (k, v) => localStorage.setItem(k, v);

let sortMode = getPref("sortMode", "priority");
let filterTag = getPref("filterTag", "");

sortModeSel.value = sortMode;

// Populate filter dropdown
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

// ---------------------------------------------------------------------
// 6.  Hero date
// ---------------------------------------------------------------------
function renderDate() {
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  heroDate.textContent = `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}
renderDate();

// ---------------------------------------------------------------------
// 7.  Date helpers
// ---------------------------------------------------------------------
const MS_DAY = 86400000;
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
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
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return { label: days[new Date(ts).getDay()], cls: "soon" };
  }
  return { label: shortDate(new Date(ts)), cls: "later" };
}
function shortDate(d) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ---------------------------------------------------------------------
// 8.  Quick Capture parser
// ---------------------------------------------------------------------
const NAME_PATTERNS = {
  oliver: /\b(oliver|ollie)\b/i,
  josh: /\b(josh|joshua)\b/i,
};

const DAY_MAP = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};
const DAY_KEYS = Object.keys(DAY_MAP).join("|");

const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_KEYS = Object.keys(MONTH_MAP).join("|");

function extractTags(text) {
  const tags = [];
  const matched = [];
  const re = /#([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = TAG_LOOKUP[normalizeTagKey(m[1])];
    if (id && !tags.includes(id)) {
      tags.push(id);
      matched.push(m[0]);
    }
  }
  return { tags, matched };
}

function extractDate(text) {
  const lower = text.toLowerCase();
  const now = new Date();
  let m;

  if ((m = lower.match(/\b(today|tonight)\b/)))
    return { ts: startOfDay(now).getTime(), matched: m[0] };
  if ((m = lower.match(/\b(tomorrow|tmrw|tmr)\b/)))
    return { ts: startOfDay(addDays(now, 1)).getTime(), matched: m[0] };
  if ((m = lower.match(/\bthis\s+weekend\b/)))
    return { ts: startOfDay(nextWeekday(now, 6)).getTime(), matched: m[0] };
  if ((m = lower.match(/\bnext\s+week\b/)))
    return { ts: startOfDay(addDays(now, 7)).getTime(), matched: m[0] };
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
    if (candidate.getTime() < startOfDay(now).getTime() - MS_DAY) {
      candidate.setFullYear(now.getFullYear() + 1);
    }
    return { ts: startOfDay(candidate).getTime(), matched: m[0] };
  }
  if ((m = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/))) {
    const mo = parseInt(m[1], 10) - 1;
    const dy = parseInt(m[2], 10);
    let yr = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (yr < 100) yr += 2000;
    if (mo >= 0 && mo < 12 && dy >= 1 && dy <= 31) {
      let candidate = new Date(yr, mo, dy);
      if (!m[3] && candidate.getTime() < startOfDay(now).getTime() - MS_DAY) {
        candidate.setFullYear(yr + 1);
      }
      return { ts: startOfDay(candidate).getTime(), matched: m[0] };
    }
  }
  return { ts: null, matched: null };
}

function extractUrgency(text) {
  const matched = [];
  let urgent = false;
  const w = text.match(/\b(urgent|asap|important|priority|critical)\b/i);
  if (w) { urgent = true; matched.push(w[0]); }
  if (/!{2,}/.test(text)) { urgent = true; matched.push("!!"); }
  if (/!\s*$/.test(text.trim())) { urgent = true; matched.push("!"); }
  return { urgent, matched };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  // 1. Tags first (so #joshpersonal doesn't trigger name detection on "josh")
  const { tags, matched: tagMatches } = extractTags(text);
  for (const m of tagMatches) text = text.replace(new RegExp(escapeRegex(m), "i"), " ");

  // 2. Person
  let person = "unassigned";
  if (NAME_PATTERNS.oliver.test(text)) {
    person = "oliver";
    text = text.replace(NAME_PATTERNS.oliver, " ");
  } else if (NAME_PATTERNS.josh.test(text)) {
    person = "josh";
    text = text.replace(NAME_PATTERNS.josh, " ");
  }

  // 3. Date
  const { ts: dueDate, matched: dateMatch } = extractDate(text);
  if (dateMatch) text = text.replace(new RegExp(escapeRegex(dateMatch), "i"), " ");

  // 4. Urgency
  const { urgent, matched: urgencyMatches } = extractUrgency(text);
  for (const u of urgencyMatches) text = text.replace(new RegExp(escapeRegex(u), "i"), " ");
  text = text.replace(/!{2,}/g, "").replace(/!\s*$/, "");

  // 5. Clean up text
  text = text
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–—]+/, "")
    .replace(/[\s:\-–—]+$/, "")
    .replace(/^(to|for|should|needs? to|has to|gotta|must)\s+/i, "")
    .trim();
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);

  return { person, text, dueDate, urgent, tags };
}

// ---------------------------------------------------------------------
// 9.  Sorting
// ---------------------------------------------------------------------
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
        if (!a.done && (a.urgent || false) !== (b.urgent || false)) return a.urgent ? -1 : 1;
        const ad = a.dueDate || Number.POSITIVE_INFINITY;
        const bd = b.dueDate || Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.createdAt || 0) - (b.createdAt || 0);
      };
  }
}

// ---------------------------------------------------------------------
// 10. Render
// ---------------------------------------------------------------------
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
  li.className = "task-item" + (t.done ? " done" : "") + (t.urgent ? " urgent" : "");
  li.dataset.id = t.id;

  // Checkbox
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "task-checkbox";
  cb.checked = !!t.done;
  cb.addEventListener("change", () => toggleDone(t.id, cb.checked));
  li.appendChild(cb);

  // Body
  const body = document.createElement("div");
  body.className = "task-body";

  // Main row: text + meta
  const main = document.createElement("div");
  main.className = "task-main";

  const span = document.createElement("span");
  span.className = "task-text";
  span.textContent = t.text;
  span.title = "Click to edit";
  span.addEventListener("click", () => makeEditable(span, t.id));
  main.appendChild(span);

  const meta = buildMetaEl(t);
  if (meta) main.appendChild(meta);

  body.appendChild(main);

  // Notes panel (hidden by default)
  const notesPanel = document.createElement("div");
  notesPanel.className = "task-notes";
  if (!t.notes) notesPanel.hidden = true;
  const notesArea = document.createElement("textarea");
  notesArea.className = "task-notes-input";
  notesArea.placeholder = "Add a note…";
  notesArea.value = t.notes || "";
  notesArea.rows = 2;
  // Auto-resize
  notesArea.addEventListener("input", () => autoResize(notesArea));
  notesArea.addEventListener("blur", async () => {
    const v = notesArea.value.trim();
    if (v !== (t.notes || "")) {
      await updateTask(t.id, { notes: v || null });
    }
  });
  notesPanel.appendChild(notesArea);
  body.appendChild(notesPanel);
  // Resize after appending so it has a layout
  if (t.notes) requestAnimationFrame(() => autoResize(notesArea));

  // Tag picker (hidden by default)
  const tagPicker = buildTagPickerEl(t);
  body.appendChild(tagPicker);

  li.appendChild(body);

  // Action buttons
  const actions = buildActionsEl(t, { notesPanel, notesArea, tagPicker });
  li.appendChild(actions);

  return li;
}

function buildMetaEl(t) {
  const tags = t.tags || [];
  if (!tags.length && !t.dueDate && !t.urgent) return null;

  const meta = document.createElement("div");
  meta.className = "task-meta";

  // Tags
  for (const tagId of tags) {
    const def = TAGS[tagId];
    if (!def) continue;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `task-tag tag-${def.color}`;
    pill.title = "Click to remove";
    pill.innerHTML = `<span>${def.label}</span><span class="tag-x" aria-hidden="true">×</span>`;
    pill.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newTags = (t.tags || []).filter((x) => x !== tagId);
      await updateTask(t.id, { tags: newTags });
    });
    meta.appendChild(pill);
  }

  // Date pill
  if (t.dueDate) {
    const due = formatDueLabel(t.dueDate);
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `task-due due-${due.cls}`;
    pill.title = "Click to change date";
    pill.innerHTML =
      `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>` +
      `<span>${due.label}</span>`;
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      editDate(t);
    });
    meta.appendChild(pill);
  }

  // Urgent indicator
  if (t.urgent) {
    const u = document.createElement("button");
    u.type = "button";
    u.className = "task-urgent";
    u.title = "Click to clear urgency";
    u.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 4v10"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>`;
    u.addEventListener("click", (e) => {
      e.stopPropagation();
      updateTask(t.id, { urgent: false });
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
    btn.innerHTML =
      (isOn
        ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : "") + `<span>${def.label}</span>`;
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

function buildActionsEl(t, { notesPanel, notesArea, tagPicker }) {
  const actions = document.createElement("div");
  actions.className = "task-actions";

  // +Date (only if not set)
  if (!t.dueDate) {
    const b = document.createElement("button");
    b.className = "task-action-btn";
    b.title = "Set date";
    b.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
    b.addEventListener("click", () => editDate(t));
    actions.appendChild(b);
  }

  // +Urgent (only if not urgent)
  if (!t.urgent) {
    const b = document.createElement("button");
    b.className = "task-action-btn";
    b.title = "Mark urgent";
    b.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><circle cx="12" cy="19" r="1"/></svg>`;
    b.addEventListener("click", () => updateTask(t.id, { urgent: true }));
    actions.appendChild(b);
  }

  // Tag picker toggle
  const tagBtn = document.createElement("button");
  tagBtn.className = "task-action-btn";
  tagBtn.title = "Tags";
  tagBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/></svg>`;
  if ((t.tags || []).length) tagBtn.classList.add("has-data");
  tagBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    tagPicker.hidden = !tagPicker.hidden;
    if (!tagPicker.hidden) tagBtn.classList.add("active");
    else tagBtn.classList.remove("active");
  });
  actions.appendChild(tagBtn);

  // Notes toggle
  const notesBtn = document.createElement("button");
  notesBtn.className = "task-action-btn";
  notesBtn.title = "Notes";
  notesBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`;
  if (t.notes) notesBtn.classList.add("has-data");
  notesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notesPanel.hidden = !notesPanel.hidden;
    if (!notesPanel.hidden) {
      notesBtn.classList.add("active");
      notesArea.focus();
      requestAnimationFrame(() => autoResize(notesArea));
    } else {
      notesBtn.classList.remove("active");
    }
  });
  actions.appendChild(notesBtn);

  // Delete
  const del = document.createElement("button");
  del.className = "task-action-btn task-delete";
  del.title = "Delete";
  del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
  del.addEventListener("click", () => removeTask(t.id));
  actions.appendChild(del);

  return actions;
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// ---------------------------------------------------------------------
// 11. Inline text editing (re-runs parser to catch new keywords)
// ---------------------------------------------------------------------
function makeEditable(span, id) {
  if (span.getAttribute("contenteditable") === "true") return;
  span.setAttribute("contenteditable", "true");
  span.focus();
  const range = document.createRange();
  range.selectNodeContents(span);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async () => {
    span.removeAttribute("contenteditable");
    const newText = span.textContent.trim();
    const original = tasks.find((t) => t.id === id);
    if (!original) return;
    if (!newText) { span.textContent = original.text; return; }

    const parsed = parseChunk(newText);
    const updates = {};
    if (parsed.text && parsed.text !== original.text) updates.text = parsed.text;
    if (parsed.dueDate && parsed.dueDate !== original.dueDate) updates.dueDate = parsed.dueDate;
    if (parsed.urgent && !original.urgent) updates.urgent = true;
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
      span.textContent = tasks.find((t) => t.id === id)?.text || "";
      span.blur();
    }
  };
  span.addEventListener("blur", finish);
  span.addEventListener("keydown", onKey);
}

// ---------------------------------------------------------------------
// 12. Date editing — invisible <input type="date"> popup
// ---------------------------------------------------------------------
function editDate(task) {
  const input = document.createElement("input");
  input.type = "date";
  input.value = task.dueDate ? toDateInputValue(task.dueDate) : "";
  Object.assign(input.style, {
    position: "fixed", top: "50%", left: "50%",
    transform: "translate(-50%, -50%)",
    opacity: "0", pointerEvents: "none", width: "1px", height: "1px",
  });
  document.body.appendChild(input);

  let resolved = false;
  const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };

  input.addEventListener("change", async () => {
    if (resolved) return;
    resolved = true;
    const ts = parseDateInputValue(input.value);
    await updateTask(task.id, { dueDate: ts });
    cleanup();
  });
  input.addEventListener("blur", () => {
    setTimeout(() => { if (!resolved) cleanup(); }, 200);
  });

  if (typeof input.showPicker === "function") {
    try { input.showPicker(); } catch { input.focus(); input.click(); }
  } else {
    input.focus();
    input.click();
  }
}

// ---------------------------------------------------------------------
// 13. Firestore CRUD
// ---------------------------------------------------------------------
async function addTask(person, text, extras = {}) {
  if (!firebaseReady) return alert("Firebase not configured.");
  if (!PEOPLE.includes(person) || !text.trim()) return;
  await addDoc(tasksCol, {
    person,
    text: text.trim(),
    done: false,
    urgent: !!extras.urgent,
    dueDate: extras.dueDate || null,
    tags: extras.tags || [],
    notes: extras.notes || null,
    createdAt: Date.now(),
    serverTime: serverTimestamp(),
  });
}
async function updateTask(id, patch) {
  if (!firebaseReady) return;
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
  if (!confirm(`Delete ${snap.size} completed task${snap.size === 1 ? "" : "s"}?`)) return;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ---------------------------------------------------------------------
// 14. Realtime sync
// ---------------------------------------------------------------------
function subscribe() {
  if (!firebaseReady) {
    setSync("offline · firebase not configured", "error");
    return;
  }
  setSync("connecting", "");
  const q = query(tasksCol, orderBy("createdAt", "asc"));
  onSnapshot(q,
    (snap) => {
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      setSync("synced", "live");
    },
    (err) => { console.error("Snapshot error:", err); setSync("sync error", "error"); }
  );
}
function setSync(text, kind) {
  syncStatus.textContent = text;
  syncPill.className = "sync-pill" + (kind ? " " + kind : "");
}

// ---------------------------------------------------------------------
// 15. Quick Add handler
// ---------------------------------------------------------------------
async function handleQuickAdd() {
  const note = quickInput.value.trim();
  if (!note) return;
  if (!firebaseReady) {
    setQuickStatus("firebase not configured", "error");
    return;
  }
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
        const choice = prompt(`Who is this for?\n\n"${text}"\n\nType: oliver, josh, or skip`, "oliver");
        if (!choice) continue;
        const lower = choice.toLowerCase().trim();
        if (lower === "skip") continue;
        if (!PEOPLE.includes(lower)) continue;
        person = lower;
      }
      await addTask(person, text, { dueDate: t.dueDate, urgent: t.urgent, tags: t.tags });
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

// ---------------------------------------------------------------------
// 16. Manual add
// ---------------------------------------------------------------------
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
    await addTask(person, text, { dueDate: parsed.dueDate, urgent: parsed.urgent, tags: parsed.tags });
  });
});

// ---------------------------------------------------------------------
// 17. Wiring
// ---------------------------------------------------------------------
addBtn.addEventListener("click", handleQuickAdd);
quickInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    handleQuickAdd();
  }
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

// ---------------------------------------------------------------------
// 18. Boot
// ---------------------------------------------------------------------
subscribe();
render();
