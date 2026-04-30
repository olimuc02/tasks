// =====================================================================
// Tasks · Oliver & Josh
// Firebase-synced shared task list with Claude-powered Quick Capture
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
// 1.  CONFIG  — paste your Firebase web config here
// ---------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "PASTE_YOUR_FIREBASE_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "0000000000",
  appId: "1:0000000000:web:abcdef",
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
const addAIBtn = $("#addWithAI");
const syncStatus = $("#syncStatus");
const syncPill = $("#syncPill");
const settingsBtn = $("#settingsBtn");
const settingsModal = $("#settingsModal");
const closeSettings = $("#closeSettings");
const cancelSettings = $("#cancelSettings");
const saveSettings = $("#saveSettings");
const apiKeyInput = $("#apiKeyInput");
const firebaseStatus = $("#firebaseStatus");
const clearDoneBtn = $("#clearDoneBtn");
const heroDate = $("#heroDate");

// ---------------------------------------------------------------------
// 4.  Local state
// ---------------------------------------------------------------------
let tasks = [];
const PEOPLE = ["oliver", "josh"];

const getApiKey = () => localStorage.getItem("anthropic_api_key") || "";
const setApiKey = (k) => localStorage.setItem("anthropic_api_key", k);

// ---------------------------------------------------------------------
// 5.  Hero date
// ---------------------------------------------------------------------
function renderDate() {
  const d = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
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
      li.className = "task-item" + (t.done ? " done" : "") + (t._pending ? " pending" : "");
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
  if (!firebaseReady) return alert("Firebase not configured. Open settings.");
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
// 9.  AI Quick Capture
// ---------------------------------------------------------------------
const SYSTEM_PROMPT = `You turn rough notes into clean shared task list items for two people: Oliver and Josh.

Rules:
- Output STRICT JSON only, no prose, no markdown.
- Schema: {"tasks":[{"person":"oliver"|"josh"|"unassigned","text":"..."}]}
- Each note may contain ONE or MULTIPLE tasks — split them appropriately.
- If a name is mentioned ("oliver", "josh", "ollie", "j"), assign accordingly.
- If both names appear with different tasks, split into separate items.
- If no name is given, use "person":"unassigned" — the client will prompt the user.
- Rewrite each task as a clear, concise imperative sentence (start with a verb when natural). Keep dates/times if given.
- Do NOT add information that wasn't there. Don't invent details.
- Maximum ~12 words per task. Sentence case preferred.

Examples:
Input: "oliver pick up dry cleaning thurs"
Output: {"tasks":[{"person":"oliver","text":"Pick up dry cleaning Thursday"}]}

Input: "josh book table sat night for 4, oliver call mum"
Output: {"tasks":[{"person":"josh","text":"Book table for 4 on Saturday night"},{"person":"oliver","text":"Call mum"}]}

Input: "buy milk"
Output: {"tasks":[{"person":"unassigned","text":"Buy milk"}]}`;

async function callClaude(noteText) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("no API key — open settings");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: noteText }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`API ${res.status}: ${errBody.slice(0, 100)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("AI returned invalid JSON");
  }
  if (!Array.isArray(parsed.tasks)) throw new Error("AI returned wrong shape");
  return parsed.tasks;
}

async function handleQuickAdd() {
  const note = quickInput.value.trim();
  if (!note) return;
  if (!firebaseReady) {
    setQuickStatus("firebase not configured", "error");
    return;
  }

  addAIBtn.disabled = true;
  setQuickStatus("thinking…", "thinking");

  try {
    const aiTasks = await callClaude(note);
    if (!aiTasks.length) {
      setQuickStatus("no tasks found", "error");
      return;
    }
    let added = 0;
    for (const t of aiTasks) {
      let person = (t.person || "").toLowerCase();
      const text = (t.text || "").trim();
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
    setQuickStatus(err.message || "AI error", "error");
  } finally {
    addAIBtn.disabled = false;
  }
}

function setQuickStatus(text, cls) {
  quickStatus.textContent = text;
  quickStatus.className = "qa-status" + (cls ? " " + cls : "");
}

// ---------------------------------------------------------------------
// 10. Manual add
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
// 11. Quick Add wiring
// ---------------------------------------------------------------------
addAIBtn.addEventListener("click", handleQuickAdd);
quickInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    handleQuickAdd();
  }
});

// ---------------------------------------------------------------------
// 12. Settings modal
// ---------------------------------------------------------------------
function openSettings() {
  apiKeyInput.value = getApiKey();
  if (firebaseReady) {
    firebaseStatus.textContent = `connected · project ${firebaseConfig.projectId}`;
    firebaseStatus.style.color = "var(--josh)";
  } else {
    firebaseStatus.textContent = "not configured — edit firebaseConfig in app.js";
    firebaseStatus.style.color = "var(--oliver)";
  }
  settingsModal.hidden = false;
}
function closeModal() { settingsModal.hidden = true; }

settingsBtn.addEventListener("click", openSettings);
closeSettings.addEventListener("click", closeModal);
cancelSettings.addEventListener("click", closeModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeModal();
});
saveSettings.addEventListener("click", () => {
  setApiKey(apiKeyInput.value.trim());
  closeModal();
  setQuickStatus("api key saved", "success");
  setTimeout(() => setQuickStatus("", ""), 1800);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.hidden) closeModal();
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

if (!getApiKey()) {
  setQuickStatus("set your API key in settings", "");
}
