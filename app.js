// =====================================================================
// tasks · oliver & josh
// firebase-synced shared task list
// features: name routing · natural-language dates · urgency levels (1/2/3)
//           · tags · notes · sort · auto-lowercase · iphone-friendly modals
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
// 1.  firebase config
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
// 2.  tag definitions (labels are lowercase)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// 3.  init firebase
// ---------------------------------------------------------------------
let db;
let firebaseReady = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  firebaseReady = true;
} catch (err) {
  console.error("firebase init failed:", err);
}
const tasksCol = firebaseReady ? collection(db, "tasks") : null;

// ---------------------------------------------------------------------
// 4.  dom
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

// date modal
const dateModal = $("#dateModal");
const dateModalInput = $("#dateModalInput");
const dateModalClose = $("#dateModalClose");
const dateModalBackdrop = $("#dateModalBackdrop");
const dateModalDone = $("#dateModalDone");
const dateModalClear = $("#dateModalClear");
const dateQuickRow = $("#dateQuickRow");

// urgency modal
const urgencyModal = $("#urgencyModal");
const urgencyModalOptions = $("#urgencyModalOptions");

// tag modal
const tagModal = $("#tagModal");
const tagModalGrid = $("#tagModalGrid");

// delete modal
const deleteModal = $("#deleteModal");
const deleteModalText = $("#deleteModalText");
const deleteModalConfirm = $("#deleteModalConfirm");

// due-today section
const todaySection = $("#todaySection");
const todayList = $("#todayList");
const todayCount = $("#todayCount");

// ---------------------------------------------------------------------
// 5.  state
// ---------------------------------------------------------------------
let tasks = [];
const PEOPLE = ["oliver", "josh"];

const getPref = (k, fallback) => localStorage.getItem(k) || fallback;
const setPref = (k, v) => localStorage.setItem(k, v);

let sortMode = getPref("sortMode", "tag");
// migrate legacy "priority" pref → "urgency"
if (sortMode === "priority") { sortMode = "urgency"; setPref("sortMode", "urgency"); }
let filterTag = getPref("filterTag", "");
sortModeSel.value = sortMode;

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
// 6.  auto-lowercase helpers — run on every input event
// ---------------------------------------------------------------------
function bindLowercaseInput(el) {
  if (el.dataset.lcBound) return;
  el.dataset.lcBound = "1";
  el.addEventListener("input", () => {
    if (el.value !== el.value.toLowerCase()) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.toLowerCase();
      try { el.setSelectionRange(start, end); } catch { /* noop */ }
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
// apply to static inputs
bindLowercaseInput(quickInput);
document.querySelectorAll(".manual-input").forEach(bindLowercaseInput);

// ---------------------------------------------------------------------
// 7.  hero date
// ---------------------------------------------------------------------
function renderDate() {
  const d = new Date();
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  heroDate.textContent = `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}
renderDate();

// ---------------------------------------------------------------------
// 8.  date helpers
// ---------------------------------------------------------------------
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
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return { label: days[new Date(ts).getDay()], cls: "soon" };
  }
  return { label: shortDate(new Date(ts)), cls: "later" };
}
function shortDate(d) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
function isDueToday(ts) {
  if (!ts) return false;
  return startOfDay(new Date(ts)).getTime() === startOfDay(new Date()).getTime();
}

// ---------------------------------------------------------------------
// 9.  parser — name + date + urgency-level + tags
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

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function extractTags(text) {
  const tags = [];
  const cleaned = text.replace(/#([a-zA-Z0-9_-]+)/g, (match, p1) => {
    const id = TAG_LOOKUP[normalizeTagKey(p1)];
    if (id && !tags.includes(id)) {
      tags.push(id);
      return " ";
    }
    return match;
  });
  return { tags, cleaned };
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
  return chunks.map((c) => parseChunk(c, { detectPerson: true })).filter((t) => t.text);
}

// detectPerson:
//   true  → strip the person's name from the task text and route to that column (used by the global quick add)
//   false → leave names in the text literally (used by the per-column manual add and inline edit,
//           because the column already determines the assignee — and "josh" might be in the task text)
function parseChunk(chunk, { detectPerson = true } = {}) {
  let text = chunk;

  // 1. tags first (so #joshpersonal doesn't trigger name detection on "josh")
  const tagResult = extractTags(text);
  text = tagResult.cleaned;
  const tags = tagResult.tags;

  // 2. person — only when caller wants name-based routing
  let person = "unassigned";
  if (detectPerson) {
    if (NAME_PATTERNS.oliver.test(text)) {
      person = "oliver";
      text = text.replace(NAME_PATTERNS.oliver, " ");
    } else if (NAME_PATTERNS.josh.test(text)) {
      person = "josh";
      text = text.replace(NAME_PATTERNS.josh, " ");
    }
  }

  // 3. date
  const dateResult = extractDate(text);
  if (dateResult.matched) {
    text = text.replace(new RegExp(escapeRegex(dateResult.matched), "i"), " ");
  }
  const dueDate = dateResult.ts;

  // 4. urgency
  const urgencyResult = extractUrgency(text);
  text = urgencyResult.cleaned;
  const urgency = urgencyResult.urgency;

  // 5. clean up — always lowercase
  text = text
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–—]+/, "")
    .replace(/[\s:\-–—]+$/, "")
    .replace(/^(to|should|needs? to|has to|gotta|must)\s+/i, "")
    .toLowerCase()
    .trim();

  return { person, text, dueDate, urgency, tags };
}

// ---------------------------------------------------------------------
// 10. data normalization (migrates old urgent: bool → urgency: number)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// 11. sorting
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
    case "tag":
      return (a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        // tagged tasks first, alphabetical by primary tag; untagged last
        const at = (a.tags && a.tags[0]) || null;
        const bt = (b.tags && b.tags[0]) || null;
        if (at !== bt) {
          if (at === null) return 1;
          if (bt === null) return -1;
          return at.localeCompare(bt);
        }
        return (a.createdAt || 0) - (b.createdAt || 0);
      };
    case "urgency":
    case "priority": // legacy
    default:
      return (a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.done) {
          const au = a.urgency || 0;
          const bu = b.urgency || 0;
          if (au !== bu) return bu - au; // higher level first
        }
        const ad = a.dueDate || Number.POSITIVE_INFINITY;
        const bd = b.dueDate || Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.createdAt || 0) - (b.createdAt || 0);
      };
  }
}

// ---------------------------------------------------------------------
// 12. render
// ---------------------------------------------------------------------
function render() {
  const sortFn = getSortFn(sortMode);

  // ---------- due today (mixed people, full width) ----------
  let todayItems = tasks.filter((t) => isDueToday(t.dueDate));
  if (filterTag) todayItems = todayItems.filter((t) => (t.tags || []).includes(filterTag));
  // sort: open first, then highest urgency, then oldest first
  todayItems.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const au = a.urgency || 0;
    const bu = b.urgency || 0;
    if (au !== bu) return bu - au;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  if (todayItems.length === 0) {
    todaySection.hidden = true;
  } else {
    todaySection.hidden = false;
    const openToday = todayItems.filter((t) => !t.done).length;
    todayCount.textContent = openToday > 0
      ? `${openToday} open · ${todayItems.length} total`
      : "all clear";
    todayList.innerHTML = "";
    todayItems.forEach((t) => todayList.appendChild(buildTaskEl(t, { showPerson: true })));
  }

  // ---------- per-person columns ----------
  for (const person of PEOPLE) {
    const list = person === "oliver" ? oliverList : joshList;
    const countEl = person === "oliver" ? oliverCount : joshCount;

    let items = tasks.filter((t) => t.person === person);
    if (filterTag) items = items.filter((t) => (t.tags || []).includes(filterTag));
    items.sort(sortFn);

    const open = items.filter((t) => !t.done).length;
    countEl.textContent = `${open} open · ${items.length} total`;

    list.innerHTML = "";
    if (sortMode === "tag") {
      let currentSection = "__init__";
      items.forEach((t) => {
        const section = t.done
          ? "__done__"
          : ((t.tags && t.tags[0]) || "__notag__");
        if (section !== currentSection) {
          currentSection = section;
          list.appendChild(buildTagGroupHeader(section));
        }
        list.appendChild(buildTaskEl(t));
      });
    } else {
      items.forEach((t) => list.appendChild(buildTaskEl(t)));
    }
  }
}

function buildTagGroupHeader(section) {
  const li = document.createElement("li");
  li.className = "tag-group-header";

  let label;
  let colorClass = "";
  if (section === "__done__") {
    label = "completed";
    colorClass = "tag-group-done";
  } else if (section === "__notag__") {
    label = "no tag";
    colorClass = "tag-group-untagged";
  } else {
    const def = TAGS[section];
    label = def ? def.label : section;
    colorClass = def ? `tag-group-${def.color}` : "";
  }

  li.classList.add(colorClass);
  li.innerHTML = `<span class="tag-group-dot" aria-hidden="true"></span><span class="tag-group-label">${label}</span>`;
  return li;
}

function buildTaskEl(t, { showPerson = false } = {}) {
  const li = document.createElement("li");
  const lvl = t.urgency || 0;
  li.className =
    "task-item" +
    (t.done ? " done" : "") +
    (lvl ? ` lvl-${lvl}` : "") +
    (showPerson ? ` task-of-${t.person}` : "");
  li.dataset.id = t.id;

  // checkbox
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "task-checkbox";
  cb.checked = !!t.done;
  cb.addEventListener("change", () => toggleDone(t.id, cb.checked));
  li.appendChild(cb);

  // body
  const body = document.createElement("div");
  body.className = "task-body";

  // main row: text + meta
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

  const meta = buildMetaEl(t, { showPerson });
  if (meta) main.appendChild(meta);

  body.appendChild(main);

  // small description below the task (replaces the old notes panel)
  body.appendChild(buildDescEl(t));

  li.appendChild(body);

  // actions
  const actions = buildActionsEl(t);
  li.appendChild(actions);

  return li;
}

function buildMetaEl(t, { showPerson = false } = {}) {
  const tags = t.tags || [];
  const hasContent = tags.length || t.dueDate || t.urgency || (showPerson && t.person);
  if (!hasContent) return null;

  const meta = document.createElement("div");
  meta.className = "task-meta";

  // person pill — only on the mixed "due today" list
  if (showPerson && t.person) {
    const personPill = document.createElement("span");
    personPill.className = `task-person task-person-${t.person}`;
    personPill.textContent = t.person;
    meta.appendChild(personPill);
  }

  // tags
  for (const tagId of tags) {
    const def = TAGS[tagId];
    if (!def) continue;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `task-tag tag-${def.color}`;
    pill.title = "tap to edit tags";
    pill.innerHTML = `<span>${def.label}</span>`;
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      openTagModal(t);
    });
    meta.appendChild(pill);
  }

  // date pill — opens date modal
  if (t.dueDate) {
    const due = formatDueLabel(t.dueDate);
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `task-due due-${due.cls}`;
    pill.title = "tap to change date";
    pill.innerHTML =
      `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>` +
      `<span>${due.label}</span>`;
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      openDateModal(t);
    });
    meta.appendChild(pill);
  }

  // urgency pill — opens urgency modal (no more cycling)
  if (t.urgency) {
    const lvl = t.urgency;
    const u = document.createElement("button");
    u.type = "button";
    u.className = `task-urgency lvl-${lvl}`;
    u.title = "tap to change urgency";
    u.innerHTML = `<span>${"!".repeat(lvl)}</span>`;
    u.addEventListener("click", (e) => {
      e.stopPropagation();
      openUrgencyModal(t);
    });
    meta.appendChild(u);
  }

  return meta;
}

// ---------------------------------------------------------------------
// description: small inline subtitle under the task.
// stored in the same `notes` firestore field for backward-compat.
// click to edit, enter / blur to save, escape to cancel.
// ---------------------------------------------------------------------
function buildDescEl(t) {
  const el = document.createElement("div");
  el.className = "task-desc";
  el.setAttribute("autocapitalize", "none");
  el.setAttribute("spellcheck", "true");

  const value = (t.notes || "").trim();
  if (value) {
    el.textContent = value;
  } else {
    el.classList.add("empty");
    el.textContent = "+ description";
  }
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    makeDescEditable(el, t);
  });
  return el;
}

function makeDescEditable(el, t) {
  if (el.getAttribute("contenteditable") === "true") return;

  // clear placeholder if showing it
  if (el.classList.contains("empty")) {
    el.textContent = "";
    el.classList.remove("empty");
  }
  el.classList.add("editing");
  el.setAttribute("contenteditable", "true");
  el.focus();

  bindLowercaseContentEditable(el);

  // place caret at end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const original = (t.notes || "").trim();
  let cancelled = false;

  const finish = async () => {
    el.removeEventListener("blur", finish);
    el.removeEventListener("keydown", onKey);
    el.removeAttribute("contenteditable");
    el.classList.remove("editing");

    if (cancelled) {
      // restore original value
      if (original) {
        el.textContent = original;
        el.classList.remove("empty");
      } else {
        el.textContent = "+ description";
        el.classList.add("empty");
      }
      return;
    }

    const newText = el.textContent.trim().toLowerCase();
    if (newText === original) {
      // unchanged — just restore proper display
      if (!newText) { el.textContent = "+ description"; el.classList.add("empty"); }
      return;
    }

    // optimistic local update + display
    t.notes = newText || null;
    if (!newText) { el.textContent = "+ description"; el.classList.add("empty"); }
    else { el.textContent = newText; el.classList.remove("empty"); }
    await updateTask(t.id, { notes: newText || null });
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      el.blur();
    }
  };

  el.addEventListener("blur", finish);
  el.addEventListener("keydown", onKey);
}

function buildActionsEl(t) {
  const actions = document.createElement("div");
  actions.className = "task-actions";

  // date — opens modal (set or change)
  const dateBtn = document.createElement("button");
  dateBtn.className = "task-action-btn";
  dateBtn.title = t.dueDate ? "change date" : "set date";
  dateBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
  if (t.dueDate) dateBtn.classList.add("has-data");
  dateBtn.addEventListener("click", (e) => { e.stopPropagation(); openDateModal(t); });
  actions.appendChild(dateBtn);

  // urgency — opens modal
  const urgBtn = document.createElement("button");
  urgBtn.className = "task-action-btn";
  urgBtn.title = t.urgency ? "change urgency" : "set urgency";
  urgBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><circle cx="12" cy="19" r="1"/></svg>`;
  if (t.urgency) urgBtn.classList.add("has-data");
  urgBtn.addEventListener("click", (e) => { e.stopPropagation(); openUrgencyModal(t); });
  actions.appendChild(urgBtn);

  // tags — opens modal
  const tagBtn = document.createElement("button");
  tagBtn.className = "task-action-btn";
  tagBtn.title = "tags";
  tagBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/></svg>`;
  if ((t.tags || []).length) tagBtn.classList.add("has-data");
  tagBtn.addEventListener("click", (e) => { e.stopPropagation(); openTagModal(t); });
  actions.appendChild(tagBtn);

  // delete — opens confirm modal
  const del = document.createElement("button");
  del.className = "task-action-btn task-delete";
  del.title = "delete";
  del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
  del.addEventListener("click", (e) => { e.stopPropagation(); openDeleteModal(t); });
  actions.appendChild(del);

  return actions;
}

// ---------------------------------------------------------------------
// 13. inline text editing
// ---------------------------------------------------------------------
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

    // Don't strip names on inline edits — task is already assigned to a column,
    // and "josh" / "oliver" might be part of the actual task text.
    const parsed = parseChunk(newText, { detectPerson: false });
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

// ---------------------------------------------------------------------
// 14. shared modal helpers
// ---------------------------------------------------------------------
function openModal(modalEl) {
  modalEl.hidden = false;
  modalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => modalEl.classList.add("open"));
}
function closeModal(modalEl) {
  modalEl.classList.remove("open");
  modalEl.setAttribute("aria-hidden", "true");
  // wait for transition before hiding
  setTimeout(() => { modalEl.hidden = true; }, 220);
  // only release scroll lock if no other modal is open
  setTimeout(() => {
    const anyOpen = document.querySelector(".date-modal.open, .action-modal.open");
    if (!anyOpen) document.body.classList.remove("modal-open");
  }, 230);
}

// ---------------------------------------------------------------------
// 15. date modal
// ---------------------------------------------------------------------
let dateModalTaskId = null;

function openDateModal(task) {
  dateModalTaskId = task.id;
  dateModalInput.value = task.dueDate ? toDateInputValue(task.dueDate) : "";
  openModal(dateModal);
}
function closeDateModal() { closeModal(dateModal); dateModalTaskId = null; }
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
  let ts = null;
  if (btn.dataset.offset !== undefined) {
    ts = startOfDay(addDays(new Date(), parseInt(btn.dataset.offset, 10))).getTime();
  } else if (btn.dataset.day !== undefined) {
    ts = startOfDay(nextWeekday(new Date(), parseInt(btn.dataset.day, 10))).getTime();
  }
  if (ts !== null) commitModalDate(ts);
});

// ---------------------------------------------------------------------
// 16. urgency modal
// ---------------------------------------------------------------------
let urgencyModalTaskId = null;

function openUrgencyModal(task) {
  urgencyModalTaskId = task.id;
  // build options fresh so the current level shows as selected
  urgencyModalOptions.innerHTML = "";
  const opts = [
    { lvl: 0, label: "none",   sub: "no urgency", cls: "urg-none", marks: "·"   },
    { lvl: 1, label: "low",    sub: "important",  cls: "urg-1",    marks: "!"   },
    { lvl: 2, label: "medium", sub: "urgent",     cls: "urg-2",    marks: "!!"  },
    { lvl: 3, label: "high",   sub: "asap",       cls: "urg-3",    marks: "!!!" },
  ];
  const cur = task.urgency || 0;
  for (const o of opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "urgency-option" + (o.lvl === cur ? " selected" : "");
    btn.dataset.level = o.lvl;
    btn.innerHTML =
      `<span class="urgency-pill ${o.cls}">${o.marks}</span>` +
      `<span class="urgency-text"><span class="urgency-label">${o.label}</span><span class="urgency-sub">${o.sub}</span></span>`;
    btn.addEventListener("click", async () => {
      const lvl = parseInt(btn.dataset.level, 10);
      await updateTask(urgencyModalTaskId, { urgency: lvl > 0 ? lvl : null });
      closeUrgencyModal();
    });
    urgencyModalOptions.appendChild(btn);
  }
  openModal(urgencyModal);
}
function closeUrgencyModal() { closeModal(urgencyModal); urgencyModalTaskId = null; }
urgencyModal.querySelectorAll("[data-modal-close]").forEach((el) =>
  el.addEventListener("click", closeUrgencyModal)
);

// ---------------------------------------------------------------------
// 17. tag modal
// ---------------------------------------------------------------------
let tagModalTaskId = null;

function openTagModal(task) {
  tagModalTaskId = task.id;
  tagModalGrid.innerHTML = "";
  const cur = task.tags || [];
  for (const id of Object.keys(TAGS)) {
    const def = TAGS[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tag-option tag-${def.color}` + (cur.includes(id) ? " on" : "");
    btn.dataset.tagId = id;
    btn.innerHTML = `<span>${def.label}</span>`;
    btn.addEventListener("click", async () => {
      // Use latest task state from the live tasks array (avoid stale closure)
      const live = tasks.find((x) => x.id === tagModalTaskId);
      const liveTags = (live && live.tags) || [];
      const newTags = liveTags.includes(id)
        ? liveTags.filter((x) => x !== id)
        : [...liveTags, id];
      btn.classList.toggle("on");
      await updateTask(tagModalTaskId, { tags: newTags });
    });
    tagModalGrid.appendChild(btn);
  }
  openModal(tagModal);
}
function closeTagModal() { closeModal(tagModal); tagModalTaskId = null; }
tagModal.querySelectorAll("[data-modal-close]").forEach((el) =>
  el.addEventListener("click", closeTagModal)
);

// ---------------------------------------------------------------------
// 18. delete modal
// ---------------------------------------------------------------------
let deleteModalTaskId = null;

function openDeleteModal(task) {
  deleteModalTaskId = task.id;
  deleteModalText.textContent = (task.text || "").toLowerCase();
  openModal(deleteModal);
}
function closeDeleteModal() { closeModal(deleteModal); deleteModalTaskId = null; }
deleteModal.querySelectorAll("[data-modal-close]").forEach((el) =>
  el.addEventListener("click", closeDeleteModal)
);
deleteModalConfirm.addEventListener("click", async () => {
  if (!deleteModalTaskId) return;
  const id = deleteModalTaskId;
  closeDeleteModal();
  await removeTask(id);
});

// ---------------------------------------------------------------------
// 19. global escape — close any open modal
// ---------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!dateModal.hidden)    closeDateModal();
  if (!urgencyModal.hidden) closeUrgencyModal();
  if (!tagModal.hidden)     closeTagModal();
  if (!deleteModal.hidden)  closeDeleteModal();
});

// ---------------------------------------------------------------------
// 20. firestore crud
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// 21. realtime sync
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
      tasks = snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() }));
      render();
      setSync("synced", "live");
    },
    (err) => { console.error("snapshot error:", err); setSync("sync error", "error"); }
  );
}
function setSync(text, kind) {
  syncStatus.textContent = text;
  syncPill.className = "sync-pill" + (kind ? " " + kind : "");
}

// ---------------------------------------------------------------------
// 22. quick add (global capture box — names ARE the routing)
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

// ---------------------------------------------------------------------
// 23. manual add (per-column — column already determines the assignee,
//      so DO NOT strip names from the text. "tell josh i love him" stays
//      verbatim when added under oliver.)
// ---------------------------------------------------------------------
document.querySelectorAll(".manual-add").forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const person = form.dataset.person;
    const input = form.querySelector(".manual-input");
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";
    const parsed = parseChunk(raw, { detectPerson: false });
    const text = parsed.text || raw;
    await addTask(person, text, { dueDate: parsed.dueDate, urgency: parsed.urgency, tags: parsed.tags });
  });
});

// ---------------------------------------------------------------------
// 24. wiring
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
// 25. boot
// ---------------------------------------------------------------------
subscribe();
render();
