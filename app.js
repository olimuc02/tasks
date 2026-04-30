// =====================================================================
// Tasks · Oliver & Josh
// Firebase-synced shared task list with built-in Quick Capture parser
// (name detection + natural-language dates + urgency)
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
// 2.  Init
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
// 3.  DOM
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

// ---------------------------------------------------------------------
// 4.  State
// ---------------------------------------------------------------------
let tasks = [];
const PEOPLE = ["oliver", "josh"];

// ---------------------------------------------------------------------
// 5.  Hero date
// ---------------------------------------------------------------------
function renderDate() {
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  heroDate.textContent = `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}
renderDate();

// ---------------------------------------------------------------------
// 6.  Date helpers
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
  // 0 = Sunday … 6 = Saturday. If target is today, return today.
  const x = new Date(from);
  const cur = x.getDay();
  const diff = (target - cur + 7) % 7;
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
// 7.  Quick Capture parser — name + date + urgency
// ---------------------------------------------------------------------
const NAME_PATTERNS = {
  oliver: /\b(oliver|ollie)\b/i,
  josh: /\b(josh|joshua)\b/i,
};

const DAY_MAP = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const DAY_KEYS = Object.keys(DAY_MAP).join("|");

const MONTH_MAP = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};
const MONTH_KEYS = Object.keys(MONTH_MAP).join("|");

/**
 * Try to extract a date from a chunk of text. Returns { ts, matched } or { ts: null }.
 * `matched` is the substring to remove from the task text.
 */
function extractDate(text) {
  const lower = text.toLowerCase();
  const now = new Date();
  let match;

  // today / tonight
  if ((match = lower.match(/\b(today|tonight)\b/))) {
    return { ts: startOfDay(now).getTime(), matched: match[0] };
  }
  // tomorrow / tmrw / tom
  if ((match = lower.match(/\b(tomorrow|tmrw|tmr)\b/))) {
    return { ts: startOfDay(addDays(now, 1)).getTime(), matched: match[0] };
  }
  // this weekend
  if ((match = lower.match(/\bthis\s+weekend\b/))) {
    return { ts: startOfDay(nextWeekday(now, 6)).getTime(), matched: match[0] };
  }
  // next week
  if ((match = lower.match(/\bnext\s+week\b/))) {
    return { ts: startOfDay(addDays(now, 7)).getTime(), matched: match[0] };
  }
  // in N days/weeks
  if ((match = lower.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/))) {
    const n = parseInt(match[1], 10);
    const unit = match[2].startsWith("week") ? 7 : 1;
    return { ts: startOfDay(addDays(now, n * unit)).getTime(), matched: match[0] };
  }
  // (next) day-name [morning/night/evening] — strip optional time-of-day word
  const dayRegex = new RegExp(
    `\\b(?:next\\s+)?(${DAY_KEYS})(?:\\s+(?:morning|afternoon|evening|night))?\\b`
  );
  if ((match = lower.match(dayRegex))) {
    const target = DAY_MAP[match[1]];
    let date = nextWeekday(now, target);
    // If "next <day>" and today happens to be that day, push 7 days.
    if (/^next\s+/.test(match[0]) && target === now.getDay()) {
      date = addDays(date, 7);
    }
    return { ts: startOfDay(date).getTime(), matched: match[0] };
  }
  // month + day, e.g. "may 5", "may 5th", "december 12"
  const monRegex = new RegExp(`\\b(${MONTH_KEYS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`);
  if ((match = lower.match(monRegex))) {
    const month = MONTH_MAP[match[1]];
    const day = parseInt(match[2], 10);
    let year = now.getFullYear();
    let candidate = new Date(year, month, day);
    if (candidate.getTime() < startOfDay(now).getTime() - MS_DAY) {
      candidate.setFullYear(year + 1);
    }
    return { ts: startOfDay(candidate).getTime(), matched: match[0] };
  }
  // numeric: M/D or M-D (no year). Avoid eating things like "1/2" cup.
  if ((match = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/))) {
    const m = parseInt(match[1], 10) - 1;
    const d = parseInt(match[2], 10);
    let y = match[3] ? parseInt(match[3], 10) : now.getFullYear();
    if (y < 100) y += 2000;
    if (m >= 0 && m < 12 && d >= 1 && d <= 31) {
      let candidate = new Date(y, m, d);
      if (!match[3] && candidate.getTime() < startOfDay(now).getTime() - MS_DAY) {
        candidate.setFullYear(y + 1);
      }
      return { ts: startOfDay(candidate).getTime(), matched: match[0] };
    }
  }

  return { ts: null, matched: null };
}

/**
 * Returns { urgent, matched }. `matched` is an array of substrings to strip.
 */
function extractUrgency(text) {
  const matched = [];
  let urgent = false;

  const wordMatch = text.match(/\b(urgent|asap|important|priority|critical)\b/i);
  if (wordMatch) {
    urgent = true;
    matched.push(wordMatch[0]);
  }
  // double-or-more exclamation marks anywhere (less aggressive than single !)
  if (/!{2,}/.test(text)) {
    urgent = true;
    matched.push("!!");
  }
  // Single trailing "!" — also flags urgency, but we keep it more conservative
  if (/!\s*$/.test(text.trim())) {
    urgent = true;
    matched.push("!");
  }
  return { urgent, matched };
}

function parseQuickInput(input) {
  // Split on newlines, commas, semicolons, or " and " before another name
  const chunks = input
    .split(/\s*[\n,;]\s*|\s+and\s+(?=\b(?:oliver|ollie|josh|joshua)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  return chunks.map(parseChunk).filter((t) => t.text);
}

function parseChunk(chunk) {
  let person = "unassigned";
  let text = chunk;

  // Person
  if (NAME_PATTERNS.oliver.test(chunk)) {
    person = "oliver";
    text = text.replace(NAME_PATTERNS.oliver, " ");
  } else if (NAME_PATTERNS.josh.test(chunk)) {
    person = "josh";
    text = text.replace(NAME_PATTERNS.josh, " ");
  }

  // Date
  const { ts: dueDate, matched: dateMatch } = extractDate(text);
  if (dateMatch) {
    text = text.replace(new RegExp(dateMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  }

  // Urgency
  const { urgent, matched: urgencyMatches } = extractUrgency(text);
  for (const u of urgencyMatches) {
    text = text.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  }
  // Strip any remaining stray !!
  text = text.replace(/!{2,}/g, "");
  // If only a trailing "!" remains because we matched it but it's still there
  text = text.replace(/!\s*$/, "");

  // Clean up
  text = text
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–—]+/, "")
    .replace(/[\s:\-–—]+$/, "")
    .replace(/^(to|for|should|needs? to|has to|gotta|must)\s+/i, "")
    .trim();

  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);

  return { person, text, dueDate, urgent };
}

// ---------------------------------------------------------------------
// 8.  Render
// ---------------------------------------------------------------------
function render() {
  for (const person of PEOPLE) {
    const list = person === "oliver" ? oliverList : joshList;
    const countEl = person === "oliver" ? oliverCount : joshCount;

    const items = tasks
      .filter((t) => t.person === person)
      .sort((a, b) => {
        // 1. unfinished above finished
        if (a.done !== b.done) return a.done ? 1 : -1;
        // 2. urgent unfinished first
        if (!a.done) {
          if ((a.urgent || false) !== (b.urgent || false)) return a.urgent ? -1 : 1;
        }
        // 3. by due date (with date first, no-date last)
        const ad = a.dueDate || Infinity;
        const bd = b.dueDate || Infinity;
        if (ad !== bd) return ad - bd;
        // 4. by created
        return (a.createdAt || 0) - (b.createdAt || 0);
      });

    const open = items.filter((t) => !t.done).length;
    countEl.textContent = `${open} open · ${items.length} total`;

    list.innerHTML = "";
    for (const t of items) items.length && list.appendChild(buildTaskEl(t));
  }
}

function buildTaskEl(t) {
  const li = document.createElement("li");
  li.className =
    "task-item" +
    (t.done ? " done" : "") +
    (t.urgent ? " urgent" : "");
  li.dataset.id = t.id;

  // Checkbox
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "task-checkbox";
  cb.checked = !!t.done;
  cb.addEventListener("change", () => toggleDone(t.id, cb.checked));
  li.appendChild(cb);

  // Body (text + meta inline)
  const body = document.createElement("div");
  body.className = "task-body";

  const span = document.createElement("span");
  span.className = "task-text";
  span.textContent = t.text;
  span.title = "Click to edit";
  span.addEventListener("click", () => makeEditable(span, t.id));
  body.appendChild(span);

  // Meta — date pill, urgent indicator
  const meta = document.createElement("span");
  meta.className = "task-meta";

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

  if (meta.children.length > 0) body.appendChild(meta);
  li.appendChild(body);

  // Actions: add date / mark urgent (only when missing) + delete
  const actions = document.createElement("div");
  actions.className = "task-actions";

  if (!t.dueDate) {
    const addDate = document.createElement("button");
    addDate.className = "task-action-btn";
    addDate.title = "Add date";
    addDate.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
    addDate.addEventListener("click", () => editDate(t));
    actions.appendChild(addDate);
  }
  if (!t.urgent) {
    const addUrg = document.createElement("button");
    addUrg.className = "task-action-btn";
    addUrg.title = "Mark urgent";
    addUrg.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><circle cx="12" cy="19" r="1"/></svg>`;
    addUrg.addEventListener("click", () => updateTask(t.id, { urgent: true }));
    actions.appendChild(addUrg);
  }

  const del = document.createElement("button");
  del.className = "task-action-btn task-delete";
  del.title = "Delete";
  del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
  del.addEventListener("click", () => removeTask(t.id));
  actions.appendChild(del);

  li.appendChild(actions);
  return li;
}

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
    if (!newText) {
      span.textContent = original.text;
      return;
    }

    // Re-parse the edited text so users can add date/urgency by typing keywords
    const parsed = parseChunk(newText);
    const updates = {};
    if (parsed.text && parsed.text !== original.text) updates.text = parsed.text;
    if (parsed.dueDate && parsed.dueDate !== original.dueDate) updates.dueDate = parsed.dueDate;
    if (parsed.urgent && !original.urgent) updates.urgent = true;

    if (Object.keys(updates).length > 0) await updateTask(id, updates);
    span.removeEventListener("blur", finish);
    span.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      span.blur();
    } else if (e.key === "Escape") {
      const original = tasks.find((t) => t.id === id);
      span.textContent = original?.text || "";
      span.blur();
    }
  };
  span.addEventListener("blur", finish);
  span.addEventListener("keydown", onKey);
}

// ---------------------------------------------------------------------
// 9.  Date editing — invisible <input type="date"> popup
// ---------------------------------------------------------------------
function editDate(task) {
  const input = document.createElement("input");
  input.type = "date";
  input.value = task.dueDate ? toDateInputValue(task.dueDate) : "";
  // Hide visually but keep it in DOM so showPicker works.
  Object.assign(input.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    opacity: "0",
    pointerEvents: "none",
    width: "1px",
    height: "1px",
  });
  document.body.appendChild(input);

  let resolved = false;
  const cleanup = () => {
    if (input.parentNode) input.parentNode.removeChild(input);
  };

  input.addEventListener("change", async () => {
    if (resolved) return;
    resolved = true;
    const ts = parseDateInputValue(input.value);
    await updateTask(task.id, { dueDate: ts });
    cleanup();
  });
  // Some browsers fire "blur" without "change" if user dismisses. Clean up.
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!resolved) cleanup();
    }, 200);
  });

  // Try modern showPicker first, fall back to focus+click
  if (typeof input.showPicker === "function") {
    try { input.showPicker(); }
    catch { input.focus(); input.click(); }
  } else {
    input.focus();
    input.click();
  }
}

// ---------------------------------------------------------------------
// 10.  Firestore CRUD
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
    createdAt: Date.now(),
    serverTime: serverTimestamp(),
  });
}
async function updateTask(id, patch) {
  if (!firebaseReady) return;
  await updateDoc(doc(tasksCol, id), patch);
}
async function toggleDone(id, done) {
  await updateTask(id, { done });
}
async function removeTask(id) {
  if (!firebaseReady) return;
  await deleteDoc(doc(tasksCol, id));
}
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
// 11. Realtime sync
// ---------------------------------------------------------------------
function subscribe() {
  if (!firebaseReady) {
    setSync("offline · firebase not configured", "error");
    return;
  }
  setSync("connecting", "");
  const q = query(tasksCol, orderBy("createdAt", "asc"));
  onSnapshot(
    q,
    (snap) => {
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      setSync("synced", "live");
    },
    (err) => {
      console.error("Snapshot error:", err);
      setSync("sync error", "error");
    }
  );
}
function setSync(text, kind) {
  syncStatus.textContent = text;
  syncPill.className = "sync-pill" + (kind ? " " + kind : "");
}

// ---------------------------------------------------------------------
// 12. Quick Add handler
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
    if (!parsed.length) {
      setQuickStatus("no tasks found", "error");
      return;
    }

    let added = 0;
    for (const t of parsed) {
      let person = t.person;
      const text = t.text;
      if (!text) continue;

      if (!PEOPLE.includes(person)) {
        const choice = prompt(
          `Who is this for?\n\n"${text}"\n\nType: oliver, josh, or skip`,
          "oliver"
        );
        if (!choice) continue;
        const lower = choice.toLowerCase().trim();
        if (lower === "skip") continue;
        if (!PEOPLE.includes(lower)) continue;
        person = lower;
      }

      await addTask(person, text, { dueDate: t.dueDate, urgent: t.urgent });
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
// 13. Manual add (per-person input)
// ---------------------------------------------------------------------
document.querySelectorAll(".manual-add").forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const person = form.dataset.person;
    const input = form.querySelector(".manual-input");
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";

    // Run the parser on this single chunk so dates/urgency keywords work here too.
    const parsed = parseChunk(raw);
    const text = parsed.text || raw;
    await addTask(person, text, { dueDate: parsed.dueDate, urgent: parsed.urgent });
  });
});

// ---------------------------------------------------------------------
// 14. Wiring
// ---------------------------------------------------------------------
addBtn.addEventListener("click", handleQuickAdd);
quickInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    handleQuickAdd();
  }
});
clearDoneBtn.addEventListener("click", clearCompleted);

// ---------------------------------------------------------------------
// 15. Boot
// ---------------------------------------------------------------------
subscribe();
render();
