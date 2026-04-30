// =====================================================================
// Tasks · Oliver & Josh
// Firebase-synced shared task list with built-in Quick Capture parser
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
// 2.  Init Firebase
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
// 4.  Local state
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
// 6.  Render task lists
// ---------------------------------------------------------------------
function render() {
  for (const person of PEOPLE) {
    const list = person === "oliver" ? oliverList : joshList;
    const countEl = person === "oliver" ? oliverCount : joshCount;
    const items = tasks
      .filter((t) => t.person === person)
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });

    const open = items.filter((t) => !t.done).length;
    countEl.textContent = `${open} open · ${items.length} total`;

    list.innerHTML = "";
    for (const t of items) {
      const li = document.createElement("li");
      li.className = "task-item" + (t.done ? " done" : "");
      li.dataset.id = t.id;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "task-checkbox";
      cb.checked = !!t.done;
      cb.addEventListener("change", () => toggleDone(t.id, cb.checked));

      const span = document.createElement("span");
      span.className = "task-text";
      span.textContent = t.text;
      span.title = "Click to edit";
      span.addEventListener("click", () => makeEditable(span, t.id));

      const del = document.createElement("button");
      del.className = "task-delete";
      del.title = "Delete";
      del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      del.addEventListener("click", () => removeTask(t.id));

      li.append(cb, span, del);
      list.appendChild(li);
    }
  }
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
    if (newText && original && newText !== original.text) {
      await updateTask(id, { text: newText });
    } else if (!newText) {
      span.textContent = original?.text || "";
    }
    span.removeEventListener("blur", finish);
    span.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      span.blur();
    } else if (e.key === "Escape") {
      span.textContent = tasks.find((t) => t.id === id)?.text || "";
      span.blur();
    }
  };
  span.addEventListener("blur", finish);
  span.addEventListener("keydown", onKey);
}

// ---------------------------------------------------------------------
// 7.  Firestore CRUD
// ---------------------------------------------------------------------
async function addTask(person, text) {
  if (!firebaseReady) return alert("Firebase not configured.");
  if (!PEOPLE.includes(person) || !text.trim()) return;
  await addDoc(tasksCol, {
    person,
    text: text.trim(),
    done: false,
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
// 8.  Realtime sync
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
// 9.  Quick Capture parser (replaces the AI)
//
// Looks for "oliver"/"ollie" or "josh"/"joshua" anywhere in the input,
// strips the name and connector words, capitalises the first letter,
// and routes the rest to the right person.
//
// Splits multiple tasks on newlines, commas, semicolons,
// or " and " when the next chunk also contains a name.
// ---------------------------------------------------------------------
const NAME_PATTERNS = {
  oliver: /\b(oliver|ollie)\b/i,
  josh: /\b(josh|joshua)\b/i,
};

function parseQuickInput(input) {
  const chunks = input
    .split(/\s*[\n,;]\s*|\s+and\s+(?=\b(?:oliver|ollie|josh|joshua)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  return chunks.map(parseChunk).filter((t) => t.text);
}

function parseChunk(chunk) {
  let person = "unassigned";
  let text = chunk;

  if (NAME_PATTERNS.oliver.test(chunk)) {
    person = "oliver";
    text = chunk.replace(NAME_PATTERNS.oliver, " ");
  } else if (NAME_PATTERNS.josh.test(chunk)) {
    person = "josh";
    text = chunk.replace(NAME_PATTERNS.josh, " ");
  }

  // Clean up: collapse spaces, strip leading/trailing punctuation,
  // strip leading connector words like "to", "for", "should", "needs to"
  text = text
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–—]+/, "")
    .replace(/[\s:\-–—]+$/, "")
    .replace(/^(to|for|should|needs? to|has to|gotta|must)\s+/i, "")
    .trim();

  // Capitalise first letter
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);

  return { person, text };
}

// ---------------------------------------------------------------------
// 10. Quick Add handler
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
        // Couldn't detect a name — ask
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

      await addTask(person, text);
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
// 11. Manual add (per-person input)
// ---------------------------------------------------------------------
document.querySelectorAll(".manual-add").forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const person = form.dataset.person;
    const input = form.querySelector(".manual-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await addTask(person, text);
  });
});

// ---------------------------------------------------------------------
// 12. Quick Add wiring
// ---------------------------------------------------------------------
addBtn.addEventListener("click", handleQuickAdd);
quickInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    handleQuickAdd();
  }
});

// ---------------------------------------------------------------------
// 13. Footer
// ---------------------------------------------------------------------
clearDoneBtn.addEventListener("click", clearCompleted);

// ---------------------------------------------------------------------
// 14. Boot
// ---------------------------------------------------------------------
subscribe();
render();
