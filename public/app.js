import { createChat, readFiles, sessionId } from "/chat.js";
import { initFx, countTo, burst } from "/fx.js";
initFx();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const usd = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const config = await fetch("/api/config").then((r) => r.json());
if (config.mock) { $("mode").textContent = "Mock PayPal mode"; $("mode").classList.add("mock"); $("mode").title = "No PayPal keys configured: PayPal calls are simulated."; }
const SID = sessionId("tally-merchant");
if (config.hosted) $("resetBtn").hidden = true;
let overdueOnly = false; // set by Tally via control_ledger_view
$("aiLabel").textContent = `${config.ai.provider === "gemini" ? "Gemini" : "Claude"} + PayPal tools`;

// ---------------- Chat ----------------
const chat = createChat({ el: $("chat"), endpoint: "/api/merchant/chat", sessionId: SID, onEvent: (ev) => { if (ev.type === "grid") applyView(ev.view); }, onBusy: (b) => $("orb").classList.toggle("busy", b) });
function welcome() {
  chat.add("msg agent welcome", `
    <h3>Hi, I'm Tally 👋</h3>
    <p>I'm the AI finance clerk for Ember &amp; Oak Coffee, and I run its PayPal account. I can <b>send invoices, create payment links, chase late payers, refund customers and pay contractors</b>. Just ask in plain English.</p>
    <p>You can also <b>drop in a document</b> (a PO, timesheet, receipt or screenshot) and I'll handle it. Anything risky waits for your OK 🛡️.</p>
    <div class="row">
      <button data-sample="po">📄 Try a sample PO</button>
      <button data-sample="timesheet">🧑‍🎨 Try a sample timesheet</button>
      <button data-prompt="Give me a quick cash-flow summary">📊 Cash-flow summary</button>
    </div>`);
}
welcome();

const SUGGESTIONS = [
  "Invoice Blue Bottle Cafe (orders@bluebottle.example) for 40lb House Espresso at $19/lb, due in 10 days",
  "Make a payment link for a $65 hand grinder for Priya",
  "Who still owes us money? Nudge anyone overdue.",
  "Refund the last storefront order — beans arrived stale",
];
for (const s of SUGGESTIONS) {
  const b = document.createElement("button");
  b.textContent = s.length > 44 ? s.slice(0, 42) + "…" : s;
  b.title = s;
  b.onclick = () => { $("input").value = s; autoGrow(); $("input").focus(); };
  $("suggest").appendChild(b);
}

let pendingFiles = [];
const renderFiles = () => $("files").innerHTML = pendingFiles.map((f, i) => `<span>📎 ${esc(f.name)} <a href="#" data-rm="${i}" title="Remove">✕</a></span>`).join("");
$("files").onclick = (e) => { const i = e.target.dataset.rm; if (i != null) { e.preventDefault(); pendingFiles.splice(+i, 1); renderFiles(); } };
async function addFiles(list) { pendingFiles.push(...(await readFiles(list))); renderFiles(); }
$("file").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
const panel = $("chatPanel");
panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("dragging"); });
panel.addEventListener("dragleave", (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove("dragging"); });
panel.addEventListener("drop", (e) => { e.preventDefault(); panel.classList.remove("dragging"); addFiles(e.dataTransfer.files); });

const SAMPLES = {
  po: { file: "wholesale-purchase-order.txt", prompt: "Invoice this purchase order." },
  timesheet: { file: "contractor-timesheet.csv", prompt: "Pay everyone on this timesheet for their work." },
};
async function loadSample(key) {
  const s = SAMPLES[key];
  const text = await fetch(`/samples/${s.file}`).then((r) => r.text());
  pendingFiles = [{ name: s.file, media_type: "text/plain", text }];
  renderFiles();
  $("input").value = s.prompt; autoGrow(); $("input").focus();
}

let askedCashflow = false;
function send(text, files = pendingFiles) {
  if (chat.isBusy()) return toast("Tally is still working on the last request…");
  if (!text && !files.length) return;
  if (/cash|owe|summary|revenue/i.test(text)) askedCashflow = true;
  chat.send(text, files);
  $("input").value = ""; autoGrow(); pendingFiles = []; renderFiles();
  $("suggest").style.display = "none";
}
$("form").onsubmit = (e) => { e.preventDefault(); send($("input").value.trim()); };
$("chat").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sample],button[data-prompt]");
  if (!b) return;
  if (b.dataset.sample) loadSample(b.dataset.sample); else send(b.dataset.prompt, []);
});
function autoGrow() { const t = $("input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } });
$("input").addEventListener("input", autoGrow);
$("newChat").onclick = async () => {
  await fetch("/api/session/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: SID }) });
  $("chat").innerHTML = ""; welcome(); $("suggest").style.display = "";
};

// ---------------- Guided tour ----------------
$("tour").onclick = (e) => {
  const b = e.target.closest("button[data-step]");
  if (!b) return;
  const step = b.dataset.step;
  if (step === "sell") { window.open("/shop", "_blank"); toast("Opened the storefront. Ask the concierge for a gift and check out with PayPal; the sale will show up here live."); }
  if (step === "invoice") loadSample("po");
  if (step === "payout") loadSample("timesheet");
  if (step === "refund") { $("input").value = "Refund the last storefront order — the customer says the beans arrived stale."; autoGrow(); $("input").focus(); }
  if (step === "ask") send("Who still owes us money, and give me a quick cash-flow summary.", []);
};
function updateTour(entries) {
  const done = {
    sell: entries.some((e) => e.channel === "AI concierge" && ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(e.status)),
    invoice: entries.some((e) => e.type === "invoice"),
    payout: entries.some((e) => e.type === "payout"),
    refund: entries.some((e) => e.type === "refund"),
    ask: askedCashflow,
  };
  document.querySelectorAll("#tour button").forEach((b) => b.classList.toggle("done", !!done[b.dataset.step]));
}

// ---------------- Guardrails ----------------
let policy = config.policy;
const fillPolicy = () => { $("g-refund").value = policy.autoRefundLimit; $("g-payout").value = policy.autoPayoutLimit; $("g-invoice").value = policy.maxInvoice; };
$("guardBtn").onclick = (e) => { e.stopPropagation(); fillPolicy(); $("guardPop").hidden = !$("guardPop").hidden; };
$("guardPop").onclick = (e) => e.stopPropagation();
document.addEventListener("click", () => ($("guardPop").hidden = true));
$("g-save").onclick = async () => {
  policy = await fetch("/api/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoRefundLimit: $("g-refund").value, autoPayoutLimit: $("g-payout").value, maxInvoice: $("g-invoice").value }) }).then((r) => r.json());
  $("guardPop").hidden = true;
  toast(`🛡️ Guardrails updated: refunds ≤ <b>${usd(policy.autoRefundLimit)}</b>, payouts ≤ <b>${usd(policy.autoPayoutLimit)}</b> run automatically.`);
};

// ---------------- Toasts ----------------
function toast(html) {
  const d = document.createElement("div");
  d.className = "toast"; d.innerHTML = html;
  $("toasts").appendChild(d);
  setTimeout(() => { d.style.transition = "opacity .4s"; d.style.opacity = 0; setTimeout(() => d.remove(), 400); }, 4500);
}

// ---------------- AG Grid ledger ----------------
const STATUS = {
  PAID: "green", COMPLETED: "green", SUCCESS: "green", MARKED_AS_PAID: "green",
  SENT: "amber", CREATED: "amber", PENDING: "amber", PROCESSING: "amber", APPROVED: "blue", PAYER_ACTION_REQUIRED: "amber", UNPAID: "amber", PARTIALLY_PAID: "amber",
  REFUNDED: "gray", PARTIALLY_REFUNDED: "gray", CANCELLED: "red", DENIED: "red", FAILED: "red",
};
const TYPE_ICON = { invoice: "🧾", order: "🛒", refund: "↩️", payout: "💸" };
const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (e) => e?.type === "invoice" && e.status === "SENT" && e.dueDate && e.dueDate < today();
const statusPill = (e) => e?.status ? `<span class="pill ${isOverdue(e) ? "red" : STATUS[e.status] || "gray"}">${isOverdue(e) ? "OVERDUE" : e.status.replace(/_/g, " ")}</span>` : "";

const gridApi = agGrid.createGrid($("grid"), {
  columnDefs: [
    { field: "id", headerName: "ID", width: 88, pinned: "left" },
    { field: "type", width: 115, cellRenderer: (p) => p.value ? `<span class="type">${TYPE_ICON[p.value] || ""} ${p.value}</span>` : "", filter: true },
    { field: "counterparty", headerName: "Customer / Payee", flex: 1, minWidth: 150, filter: true },
    { field: "description", flex: 1.4, minWidth: 170, tooltipField: "description" },
    { field: "amount", width: 115, type: "rightAligned", comparator: (p, q) => Math.abs(p ?? 0) - Math.abs(q ?? 0), valueFormatter: (p) => p.value == null ? "" : usd(p.value), cellClass: (p) => p.value < 0 ? "neg" : "pos", filter: "agNumberColumnFilter" },
    { field: "status", width: 145, cellRenderer: (p) => statusPill(p.data), filter: true, enableCellChangeFlash: true },
    { headerName: "Channel", width: 125, valueGetter: (p) => p.data?.channel || { invoice: "invoice", payout: "payouts", refund: "refund" }[p.data?.type] || "" },
    { field: "dueDate", headerName: "Due", width: 105 },
    { field: "paypalId", headerName: "PayPal ID", width: 190, cellStyle: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: "12px" } },
    { field: "createdAt", headerName: "Created", width: 150, sort: "desc", valueFormatter: (p) => p.value ? new Date(p.value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "" },
  ],
  defaultColDef: { sortable: true, resizable: true },
  getRowId: (p) => p.data.id,
  rowData: [],
  rowSelection: "single",
  animateRows: true,
  tooltipShowDelay: 300,
  onRowClicked: (p) => openDrawer(p.data.id),
  isExternalFilterPresent: () => overdueOnly,
  doesExternalFilterPass: (node) => isOverdue(node.data),
  overlayNoRowsTemplate: '<div style="color:#7a6f66;text-align:center;line-height:1.6">No money has moved yet.<br>Follow the numbered steps above, or ask Tally to send an invoice.</div>',
});
$("quick").oninput = (e) => gridApi.setGridOption("quickFilterText", e.target.value);

// ---------------- Tally drives the grid ----------------
function applyView(v = {}) {
  if (v.reset) {
    overdueOnly = false;
    gridApi.setFilterModel(null);
    gridApi.setGridOption("quickFilterText", ""); $("quick").value = "";
    gridApi.applyColumnState({ state: [{ colId: "createdAt", sort: "desc" }], defaultState: { sort: null } });
    gridApi.onFilterChanged();
    $("viewChip").hidden = true;
    return;
  }
  const model = {};
  if (v.type) model.type = { filterType: "text", type: "equals", filter: v.type.toLowerCase() };
  if (v.status) model.status = { filterType: "text", type: "equals", filter: v.status.toUpperCase() };
  gridApi.setFilterModel(Object.keys(model).length ? model : null);
  overdueOnly = !!v.overdue_only;
  gridApi.setGridOption("quickFilterText", v.text || ""); $("quick").value = v.text || "";
  if (v.sort_by) gridApi.applyColumnState({ state: [{ colId: v.sort_by, sort: v.sort_dir === "asc" ? "asc" : "desc" }], defaultState: { sort: null } });
  gridApi.onFilterChanged();
  gridApi.deselectAll();
  for (const id of v.highlight_ids || []) {
    const n = gridApi.getRowNode(id);
    if (n) { n.setSelected(true); gridApi.ensureNodeVisible(n); setTimeout(() => gridApi.flashCells({ rowNodes: [n] }), 80); }
  }
  const parts = [v.type && `type: ${v.type}`, v.status && `status: ${v.status}`, overdueOnly && "overdue only", v.text && `"${v.text}"`, v.sort_by && `sorted by ${v.sort_by} ${v.sort_dir || "desc"}`, v.highlight_ids?.length && `highlighting ${v.highlight_ids.join(", ")}`].filter(Boolean);
  $("viewChipText").textContent = parts.length ? parts.join(" · ") : "custom view";
  $("viewChip").hidden = false;
  $("viewChip").classList.remove("pulse-in"); void $("viewChip").offsetWidth; $("viewChip").classList.add("pulse-in");
}
$("viewClear").onclick = () => applyView({ reset: true });
$("csvBtn").onclick = () => gridApi.exportDataAsCsv({ fileName: "tally-ledger.csv" });
$("syncBtn").onclick = async () => {
  $("syncBtn").disabled = true; $("syncBtn").textContent = "↻ Syncing…";
  const r = await fetch("/api/sync", { method: "POST" }).then((r) => r.json());
  $("syncBtn").disabled = false; $("syncBtn").textContent = "↻ Sync";
  toast(r.changes?.length ? `Synced with PayPal: ${esc(r.changes.join(", "))}` : "Synced with PayPal: everything is up to date.");
};
$("resetBtn").onclick = async () => {
  if (!confirm("Clear the demo ledger and chats? (Records in the PayPal sandbox are not deleted.)")) return;
  await fetch("/api/reset", { method: "POST" });
  try { sessionStorage.clear(); } catch {}
  location.reload();
};

// ---------------- Drawer ----------------
let entriesById = new Map();
function openDrawer(id) {
  const e = entriesById.get(id);
  if (!e) return;
  $("d-title").innerHTML = `${TYPE_ICON[e.type] || ""} ${esc(e.id)} · <span style="text-transform:capitalize">${esc(e.type)}</span>`;
  const acts = [];
  const ask = (label, prompt, cls = "") => acts.push(`<button class="btn ${cls}" data-prompt="${esc(prompt)}">${label}</button>`);
  if (e.type === "invoice" && ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(e.status)) {
    ask("🔔 Send a friendly reminder", `Send a friendly, personalised payment reminder for invoice ${e.id}.`, "primary");
    ask("✖ Cancel this invoice", `Cancel invoice ${e.id}, it was issued by mistake.`);
  }
  if (e.type === "order" && e.captureId && e.status === "COMPLETED") {
    ask("↩️ Full refund", `Fully refund ${e.id}: the customer is unhappy with the order.`, "primary");
    ask("½ Refund 50%", `Partially refund ${e.id} for half the amount as a goodwill gesture.`);
  }
  if (e.type === "order" && !e.captureId) ask("↻ Check payment status", `Sync with PayPal and tell me whether ${e.id} has been paid.`);
  ask("💬 Ask Tally about this", `Tell me about ledger entry ${e.id} and what I should do next.`);
  const links = [];
  if (e.link) links.push(`<a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener">${config.mock && e.type === "invoice" ? "🧪 Simulate customer paying (mock)" : "🔗 Open PayPal pay link"} ↗</a>`);
  const tl = [`<div>Created by ${e.channel === "AI concierge" ? "AI shopping concierge" : "Tally"} · ${new Date(e.createdAt).toLocaleString()}</div>`];
  if (e.lastReminder) tl.push(`<div>Reminder sent · ${new Date(e.lastReminder).toLocaleString()}</div>`);
  if (e.updatedAt) tl.push(`<div>Status → ${esc(e.status)} · ${new Date(e.updatedAt).toLocaleString()}</div>`);
  $("d-body").innerHTML = `
    <div class="big ${e.amount < 0 ? "neg" : ""}">${usd(e.amount)}</div>
    <div>${statusPill(e)}</div>
    <dl>
      <dt>${e.amount < 0 ? "Paid to" : "Customer"}</dt><dd>${esc(e.counterparty)}</dd>
      ${e.email ? `<dt>Email</dt><dd>${esc(e.email)}</dd>` : ""}
      <dt>Description</dt><dd>${esc(e.description)}</dd>
      ${e.dueDate ? `<dt>Due</dt><dd>${esc(e.dueDate)}${isOverdue(e) ? " <b class='neg'>(overdue)</b>" : ""}</dd>` : ""}
      <dt>PayPal ID</dt><dd><code>${esc(e.paypalId)}</code></dd>
      ${e.captureId ? `<dt>Capture ID</dt><dd><code>${esc(e.captureId)}</code></dd>` : ""}
      ${e.ref ? `<dt>Related</dt><dd><a href="#" data-open="${esc(e.ref)}">${esc(e.ref)}</a></dd>` : ""}
    </dl>
    <h4>One-click actions (Tally does it)</h4>
    <div class="actions">${acts.join("")}${links.join("")}</div>
    <h4>Timeline</h4>
    <div class="timeline">${tl.join("")}</div>`;
  $("drawer").classList.add("open"); $("scrim").classList.add("show");
}
const closeDrawer = () => { $("drawer").classList.remove("open"); $("scrim").classList.remove("show"); };
$("d-close").onclick = closeDrawer; $("scrim").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
$("d-body").onclick = (ev) => {
  const p = ev.target.closest("[data-prompt]");
  if (p) { closeDrawer(); send(p.dataset.prompt, []); return; }
  const o = ev.target.closest("[data-open]");
  if (o) { ev.preventDefault(); openDrawer(o.dataset.open); }
};

// ---------------- Live render ----------------
const MINUTES = { invoice: 12, refund: 8, payout: 7, order: 6 };
let known = null;
let prevStatus = new Map();
const fmtMins = (m) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);
function setKpi(id, value, fmt = usd) { countTo($(id), value, fmt); }

function render({ entries, approvals, policy: p }) {
  if (p) policy = p;
  entriesById = new Map(entries.map((e) => [e.id, e]));
  const first = known === null;
  known ||= new Set();
  const add = [], update = [];
  for (const e of entries) (known.has(e.id) ? update : add).push(e);
  const remove = [...known].filter((id) => !entriesById.has(id)).map((id) => ({ id }));
  gridApi.applyTransaction({ add, update, remove, addIndex: 0 });
  if (!first) {
    setTimeout(() => add.forEach((r) => { const n = gridApi.getRowNode(r.id); n && gridApi.flashCells({ rowNodes: [n] }); }), 60);
    for (const e of add) {
      if (e.type === "refund") burst($("k-ref"), "↩️", 8);
      if (e.type === "payout") burst($("k-pay"), "💸", 8);
      if (e.type === "invoice") burst($("k-out"), "🧾", 8);
    }
    for (const e of add) toast(`${TYPE_ICON[e.type] || ""} <b>${esc(e.id)}</b> ${esc(e.type)} · ${esc(e.counterparty)} · <b>${usd(e.amount)}</b>`);
    for (const e of update) {
      const was = prevStatus.get(e.id);
      if (was && was !== e.status && ["COMPLETED", "PAID", "SUCCESS"].includes(e.status) && e.type !== "refund") burst($(e.type === "payout" ? "k-pay" : "k-collected"), "💰", 12);
      if (was && was !== e.status) toast(`${["COMPLETED", "PAID", "SUCCESS"].includes(e.status) ? "💰" : "🔄"} <b>${esc(e.id)}</b> ${esc(e.counterparty)}: ${esc(was)} → <b>${esc(e.status)}</b>`);
    }
  }
  known = new Set(entriesById.keys());
  prevStatus = new Map(entries.map((e) => [e.id, e.status]));
  $("count").textContent = `${entries.length} entries`;

  const sum = (f) => entries.filter(f).reduce((s, e) => s + e.amount, 0);
  const open = entries.filter((e) => e.type === "invoice" && ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(e.status));
  setKpi("k-collected", sum((e) => (e.type === "order" && ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(e.status)) || (e.type === "invoice" && e.status === "PAID")));
  setKpi("k-out", open.reduce((s, e) => s + e.amount, 0));
  const overdue = open.filter(isOverdue).length;
  $("k-out-h").textContent = `${open.length} open invoice${open.length === 1 ? "" : "s"}${overdue ? ` · ${overdue} overdue` : ""}`;
  setKpi("k-ref", -sum((e) => e.type === "refund"));
  setKpi("k-pay", -sum((e) => e.type === "payout"));
  const reminders = entries.filter((e) => e.lastReminder).length;
  const mins = entries.reduce((s, e) => s + (MINUTES[e.type] || 0), 0) + reminders * 5;
  setKpi("k-time", mins, fmtMins);
  $("k-time-h").textContent = `${entries.length + reminders} actions handled by AI`;

  $("approvals").innerHTML = approvals.map((a) => `
    <div class="approval spot">
      <div class="ic">${a.kind === "refund" ? "↩️" : "💸"}</div>
      <div class="txt"><b>Needs your approval · ${usd(a.amount)}</b><span>${esc(a.summary)}. Held because it's over your ${usd(a.kind === "refund" ? policy.autoRefundLimit : policy.autoPayoutLimit)} guardrail.</span></div>
      <button class="btn" data-id="${a.id}" data-d="reject">Reject</button>
      <button class="btn ok" data-id="${a.id}" data-d="approve">Approve &amp; send</button>
    </div>`).join("");
  updateTour(entries);
}
$("approvals").onclick = async (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  b.parentElement.querySelectorAll("button").forEach((x) => (x.disabled = true));
  b.textContent = b.dataset.d === "approve" ? "Sending via PayPal…" : "…";
  const r = await fetch(`/api/approvals/${b.dataset.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: b.dataset.d }) }).then((r) => r.json());
  chat.add(r.status === "approved" ? "msg notice" : "msg err", esc(r.status === "approved" ? `✅ You approved: ${r.summary}. Sent via PayPal.` : r.status === "rejected" ? `🚫 You rejected: ${r.summary}` : `Failed: ${r.result?.error || r.error}`));
};

const es = new EventSource("/api/events");
es.onmessage = (m) => { const ev = JSON.parse(m.data); if (ev.type === "snapshot") render(ev); };

// Keep invoice/order statuses fresh while the console is open.
setInterval(() => { if (!document.hidden && !chat.isBusy()) fetch("/api/sync", { method: "POST" }); }, 20000);
