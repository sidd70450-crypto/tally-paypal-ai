import "dotenv/config";
import express from "express";
import path from "node:path";
import { runAgent, PROVIDER, MODEL_NAME } from "./src/agent.js";
import { merchantTools, runMerchantTool, shopperTools, runShopperTool, sensitiveActions, syncAll } from "./src/tools.js";
import { ledger, approvals, policy, bus } from "./src/store.js";
import { catalog, SHOP_NAME } from "./src/catalog.js";
import * as pp from "./src/paypal.js";

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const sessions = new Map();
const session = (id) => {
  if (!sessions.has(id)) sessions.set(id, { history: [], cart: [], busy: false });
  return sessions.get(id);
};
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
const today = () => new Date().toISOString().slice(0, 10);

const MERCHANT_SYSTEM = () => `You are Tally, the AI finance clerk for ${SHOP_NAME}, a small specialty coffee roastery that sells online, does wholesale to cafes, and pays freelance contractors.
You operate the business's PayPal account through your tools: send invoices, create payment links, chase late payers, refund customers, pay contractors, and answer questions about the money.

How to work:
- When a request is clear, act immediately with tools; don't ask for confirmation. Ask a short question only if required data (like an email address) is truly missing.
- If the user attaches a document or image (a quote, timesheet, purchase order, receipt, email screenshot), read it carefully and extract names, emails, line items, quantities and prices yourself, then act.
- Before answering questions about who has paid or what is outstanding, call sync_with_paypal, then query_ledger.
- Spending guardrails: refunds over $${policy.autoRefundLimit} and payout batches over $${policy.autoPayoutLimit} are automatically held for human approval. When a tool returns PENDING_HUMAN_APPROVAL, the money has NOT moved: say it is awaiting the owner's approval in the Approvals panel, never that it was refunded or paid. Never try to split a payment to get around a limit.
- If a tool returns an error, explain it plainly; don't repeat the identical call.
- The owner is looking at a live AG Grid ledger. When they ask to see, filter, sort, highlight or clear entries (e.g. 'show me overdue invoices'), call control_ledger_view so their screen updates, then summarise briefly. Highlight the rows you act on.
- Never invent ledger entries, names, amounts or ids. Only mention rows that a tool actually returned; if a tool returned none, say so.
- Refer to entries by their ledger id (e.g. T0004) and amounts in dollars.
- Keep replies short and scannable: a one-line summary, then bullets or a small markdown table when useful. Include payer links when you create invoices or payment links.
Today is ${today()}. PayPal environment: ${pp.MOCK ? "MOCK (no credentials configured)" : "sandbox"}.`;

const SHOPPER_SYSTEM = () => `You are the friendly AI shopping concierge for ${SHOP_NAME}, an online specialty coffee shop.
Help shoppers find the right coffee, gear and gifts, build their cart, and check out with PayPal.
- Always use search_products to ground recommendations in the real catalog; never invent products or prices.
- Ask at most one short clarifying question when needed (taste, brew method, budget, recipient). If the shopper gives a budget, respect it strictly and pass it to start_checkout.
- When you recommend, add items to the cart for them if they've clearly asked you to pick, otherwise suggest 2-3 options with one-line reasons.
- When the shopper is ready, call start_checkout; a PayPal button appears for them to pay. You never handle card details.
- Be warm, concise, and a little bit coffee-nerdy. Use short paragraphs, no long lists.`;

// ---------- SSE helpers ----------
function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  return (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildUserContent(message, attachments = []) {
  const blocks = [];
  for (const a of attachments) {
    if (a.media_type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: a.media_type, data: a.data } });
    else if (a.media_type?.startsWith("image/")) blocks.push({ type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } });
    else if (a.text) blocks.push({ type: "text", text: `Attached file ${a.name}:\n${a.text}` });
  }
  blocks.push({ type: "text", text: message || "Please process the attached document." });
  return blocks;
}

async function chatHandler(req, res, kind) {
  const { sessionId = "default", message, attachments } = req.body;
  const s = session(`${kind}:${sessionId}`);
  const emit = sse(res);
  if (s.busy) { emit({ type: "error", text: "Still working on the previous message." }); return res.end(); }
  s.busy = true;
  const ctx = { sessionId, baseUrl: baseUrl(req), session: s, emit };
  try {
    await runAgent({
      system: kind === "merchant" ? MERCHANT_SYSTEM() : SHOPPER_SYSTEM(),
      tools: kind === "merchant" ? merchantTools : shopperTools,
      history: s.history,
      userContent: buildUserContent(message, attachments),
      execTool: (name, input) => (kind === "merchant" ? runMerchantTool : runShopperTool)(name, input, ctx),
      emit,
    });
  } catch (err) {
    console.error(err);
    emit({ type: "error", text: err.message });
  } finally {
    s.busy = false;
    emit({ type: "done" });
    res.end();
  }
}

app.post("/api/merchant/chat", (req, res) => chatHandler(req, res, "merchant"));
app.post("/api/shop/chat", (req, res) => chatHandler(req, res, "shop"));

// ---------- Live ledger stream ----------
app.get("/api/events", (req, res) => {
  const emit = sse(res);
  const push = () => emit({ type: "snapshot", entries: ledger.all(), approvals: approvals.pending(), policy });
  push();
  bus.on("change", push);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { bus.off("change", push); clearInterval(ping); });
});

app.get("/api/config", (req, res) => res.json({ ai: { provider: PROVIDER, model: MODEL_NAME }, hosted: HOSTED, mock: pp.MOCK, clientId: pp.clientId(), policy, shopName: SHOP_NAME, catalog }));
app.get("/api/ledger", (req, res) => res.json({ entries: ledger.all(), approvals: approvals.pending() }));
app.post("/api/sync", async (req, res) => res.json(await syncAll()));
app.post("/api/policy", (req, res) => {
  for (const k of ["autoRefundLimit", "autoPayoutLimit", "maxInvoice"]) {
    const v = Number(req.body[k]);
    if (Number.isFinite(v) && v >= 0) policy[k] = v;
  }
  bus.emit("change");
  res.json(policy);
});
app.use("/samples", express.static("samples"));
// Hosted demo: shared ledger, so wiping it needs the admin token.
const HOSTED = process.env.HOSTED === "1" || process.env.HOSTED === "true";
app.post("/api/reset", (req, res) => {
  if (HOSTED && (!process.env.ADMIN_TOKEN || req.get("x-admin-token") !== process.env.ADMIN_TOKEN)) return res.status(403).json({ error: "Reset is disabled on the hosted demo." });
  ledger.reset(); sessions.clear(); res.json({ ok: true });
});
app.post("/api/session/reset", (req, res) => {
  for (const k of [...sessions.keys()]) if (k.endsWith(`:${req.body.sessionId}`)) sessions.delete(k);
  res.json({ ok: true });
});

// Human-in-the-loop approvals for guarded agent actions
app.post("/api/approvals/:id", async (req, res) => {
  const a = approvals.get(req.params.id);
  if (!a || a.status !== "pending") return res.status(404).json({ error: "Not pending" });
  if (req.body.decision !== "approve") return res.json(approvals.resolve(a.id, "rejected"));
  try {
    const result = await sensitiveActions[a.kind](a.args);
    const s = sessions.get(`merchant:${a.sessionId}`);
    if (s && !s.busy) {
      s.history.push({ role: "user", content: [{ type: "text", text: `[system notice] The owner APPROVED ${a.id}: ${a.summary}. Result: ${JSON.stringify(result)}` }] });
      s.history.push({ role: "assistant", content: [{ type: "text", text: "Noted — that approved action has been executed on PayPal." }] });
    }
    res.json(approvals.resolve(a.id, "approved", result));
  } catch (err) {
    res.status(500).json(approvals.resolve(a.id, "failed", { error: err.message }));
  }
});

// ---------- PayPal checkout (storefront) ----------
async function captureAndRecord(orderId) {
  let c;
  try {
    c = await pp.captureOrder(orderId);
  } catch (err) {
    // Auto-sync may have captured it a moment earlier — treat as success.
    if (!/ORDER_ALREADY_CAPTURED/.test(err.message)) throw err;
    const o = await pp.getOrder(orderId);
    c = { id: orderId, status: o.status, capture_id: o.capture_id, payer_email: o.payer?.email_address, payer_name: [o.payer?.name?.given_name, o.payer?.name?.surname].filter(Boolean).join(" ") };
  }
  const e = ledger.get(orderId);
  if (e) ledger.update(e.id, { status: c.status, captureId: c.capture_id, email: c.payer_email, counterparty: e.counterparty === "Storefront shopper" ? (c.payer_name || e.counterparty) : e.counterparty });
  return { ...c, ledgerId: e?.id };
}

app.post("/api/shop/capture", async (req, res) => {
  try {
    const r = await captureAndRecord(req.body.orderId);
    const s = sessions.get(`shop:${req.body.sessionId}`);
    if (s) {
      s.cart = [];
      // Let the concierge know so its next reply has context (append-only).
      s.history.push({ role: "user", content: [{ type: "text", text: `[system notice] Payment captured via PayPal for order ${req.body.orderId}. Cart cleared.` }] });
      s.history.push({ role: "assistant", content: [{ type: "text", text: "Payment confirmed — thank you!" }] });
    }
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Buyer returns here after approving a merchant-generated payment link.
app.get("/thanks", async (req, res) => {
  let msg = "Payment cancelled.";
  if (!req.query.cancel && req.query.token) {
    try { await captureAndRecord(req.query.token); msg = "Payment complete — thank you! You can close this tab."; }
    catch (err) { msg = `Could not capture payment: ${err.message}`; }
  }
  res.send(`<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;color:#eef0f8;background:radial-gradient(60% 60% at 30% 20%,rgba(255,138,61,.3),transparent 60%),radial-gradient(60% 60% at 80% 90%,rgba(139,108,255,.3),transparent 60%),#06070c"><div style="text-align:center;padding:40px 32px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1)"><div style="font-size:52px">☕</div><h2 style="margin:10px 0 6px">${msg}</h2><p style="color:#8a8fa6;margin:0">${SHOP_NAME}</p></div>`);
});

// Mock-mode stand-ins for PayPal hosted pages
app.get("/mock/approve/:id", async (req, res) => {
  if (!pp.MOCK) return res.status(404).end();
  await captureAndRecord(req.params.id);
  res.redirect("/thanks?mock=1");
});
app.get("/mock/invoice/:id", (req, res) => {
  if (!pp.MOCK) return res.status(404).end();
  const e = ledger.get(req.params.id);
  if (e) ledger.update(e.id, { status: "PAID" });
  res.send(`<body style="font-family:system-ui;padding:40px"><h2>Mock invoice ${req.params.id} marked PAID</h2>`);
});

app.get("/shop", (req, res) => res.sendFile(path.resolve("public/shop.html")));
app.get("/console", (req, res) => res.sendFile(path.resolve("public/console.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tally running on http://localhost:${PORT}  (PayPal: ${pp.MOCK ? "MOCK" : "sandbox"})`);
  console.log(`AI: ${PROVIDER} (${MODEL_NAME})`);
  const keyVar = PROVIDER === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[keyVar]) console.warn(`⚠  ${keyVar} is not set — the AI agents will not respond. Add it to .env.`);
});
