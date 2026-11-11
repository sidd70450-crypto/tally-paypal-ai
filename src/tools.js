// Tool definitions (JSON schema for Claude) + executors that call PayPal.
import * as pp from "./paypal.js";
import { ledger, approvals, policy } from "./store.js";
import { catalog, searchCatalog } from "./catalog.js";
import { createRequire } from "node:module";

// ---------- PayPal Agent Toolkit (official) ----------
// Adds disputes, transaction search and shipment tracking tools from PayPal's
// own agent toolkit, wired into the same agent loop as our custom tools.
const require = createRequire(import.meta.url);
let toolkit = null;
let toolkitTools = [];
function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== "object") return s;
  if (s.anyOf) { const pick = s.anyOf.find((x) => x.type !== "null") || {}; return cleanSchema({ ...pick, description: s.description || pick.description }); }
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (["$schema", "default", "pattern", "additionalProperties", "exclusiveMinimum", "exclusiveMaximum"].includes(k)) continue;
    out[k] = typeof v === "object" ? cleanSchema(v) : v;
  }
  return out;
}
if (!pp.MOCK && process.env.PAYPAL_AGENT_TOOLKIT !== "off") {
  try {
    const { PayPalAgentToolkit } = require("@paypal/agent-toolkit/openai");
    toolkit = new PayPalAgentToolkit({
      clientId: process.env.PAYPAL_CLIENT_ID,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET,
      configuration: {
        actions: { disputes: { list: true, get: true }, transactions: { list: true }, shipment: { create: true, get: true } },
        context: { sandbox: process.env.PAYPAL_ENV !== "live" },
      },
    });
    toolkitTools = toolkit.getTools().map((t) => ({
      name: t.function.name,
      description: `[PayPal Agent Toolkit] ${t.function.description.trim().split("\n")[0]}`,
      input_schema: cleanSchema(t.function.parameters),
    }));
    console.log(`[toolkit] PayPal Agent Toolkit loaded: ${toolkitTools.map((t) => t.name).join(", ")}`);
  } catch (err) {
    console.warn("[toolkit] PayPal Agent Toolkit unavailable:", err.message);
  }
}
const toolkitNames = () => new Set(toolkitTools.map((t) => t.name));

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

// ============ Merchant back-office agent ("Tally") ============
export const merchantTools = [
  {
    name: "create_invoice",
    description: "Create AND email a PayPal invoice to a customer. Use for billing clients for services or goods. Returns the PayPal invoice id and the payer link.",
    input_schema: obj({
      recipient_name: str("Customer full name"),
      recipient_email: str("Customer email address"),
      items: {
        type: "array",
        items: obj({ name: str("Line item name"), description: str("Optional detail"), quantity: num("Quantity, default 1"), unit_amount: num("Price per unit in currency units, e.g. 120.50") }, ["name", "unit_amount"]),
      },
      currency: str("ISO currency, default USD"),
      due_in_days: num("Days until due, default 14"),
      note: str("Note to the customer shown on the invoice"),
    }, ["recipient_name", "recipient_email", "items"]),
  },
  {
    name: "create_payment_link",
    description: "Create a one-off PayPal checkout link (Orders API) the merchant can share with a customer to collect payment immediately.",
    input_schema: obj({
      customer_name: str("Who the link is for"),
      items: { type: "array", items: obj({ name: str("Item"), quantity: num("Qty"), unit_amount: num("Unit price") }, ["name", "unit_amount"]) },
      description: str("Short purchase description"),
    }, ["items"]),
  },
  {
    name: "send_invoice_reminder",
    description: "Send a PayPal payment reminder for an unpaid invoice. Write a warm, specific note.",
    input_schema: obj({ ledger_id: str("Ledger id (e.g. T0003) or PayPal invoice id"), note: str("Personalised reminder note") }, ["ledger_id"]),
  },
  {
    name: "cancel_invoice",
    description: "Cancel a sent, unpaid PayPal invoice.",
    input_schema: obj({ ledger_id: str("Ledger id or PayPal invoice id"), note: str("Reason shown to customer") }, ["ledger_id"]),
  },
  {
    name: "refund_payment",
    description: `Refund a captured PayPal payment (full or partial). Refunds above the merchant's auto-approve limit are queued for human approval automatically.`,
    input_schema: obj({ ledger_id: str("Ledger id or PayPal order/capture id of the sale"), amount: num("Partial amount; omit for full refund"), reason: str("Why (shown to the customer)") }, ["ledger_id", "reason"]),
  },
  {
    name: "send_payouts",
    description: `Pay one or more people (contractors, suppliers, affiliates) by email with PayPal Payouts. Batches above the merchant's auto-approve limit are queued for human approval automatically.`,
    input_schema: obj({
      payouts: { type: "array", items: obj({ email: str("Recipient PayPal email"), name: str("Recipient name"), amount: num("Amount USD"), note: str("Memo") }, ["email", "amount"]) },
      subject: str("Email subject recipients see"),
    }, ["payouts"]),
  },
  {
    name: "query_ledger",
    description: "Read the business ledger (invoices, orders/sales, refunds, payouts). Use for questions about revenue, who owes money, cash flow, top customers, etc. Optionally filter.",
    input_schema: obj({ type: str("invoice | order | refund | payout"), status: str("Filter by status, e.g. SENT, PAID, COMPLETED"), search: str("Free-text match on customer, email, description/product, or ids") }),
  },
  {
    name: "sync_with_paypal",
    description: "Refresh the live status of every open invoice/order/payout from PayPal. Call before answering 'who has paid' style questions.",
    input_schema: obj({}),
  },
  {
    name: "control_ledger_view",
    description: "Change what the owner sees in the live AG Grid ledger on their screen: filter by type/status/text, show only overdue invoices, sort by a column, highlight specific rows, or reset the view. Use whenever the user asks to 'show', 'filter', 'sort', 'highlight' or 'clear' the ledger/grid.",
    input_schema: obj({
      type: str("Only show this entry type: invoice | order | refund | payout"),
      status: str("Only show this status, e.g. SENT, COMPLETED, REFUNDED"),
      text: str("Free-text quick filter (customer, product, id)"),
      overdue_only: { type: "boolean", description: "Show only overdue invoices" },
      sort_by: str("Column to sort by: amount | createdAt | counterparty | dueDate | status"),
      sort_dir: str("asc | desc"),
      highlight_ids: { type: "array", items: { type: "string" }, description: "Ledger ids to flash/select, e.g. ['T0003']" },
      reset: { type: "boolean", description: "Clear all filters and sorting" },
    }),
  },
];

merchantTools.push(...toolkitTools);

const fmt = (n) => `$${Number(n).toFixed(2)}`;

function findEntry(idish) {
  const e = ledger.get(idish) || ledger.all().find((x) => x.captureId === idish);
  if (!e) throw new Error(`No ledger entry matches "${idish}". Call query_ledger to find the right id.`);
  return e;
}

// Actions that actually move money out. Executed directly or after approval.
export const sensitiveActions = {
  async refund({ entryId, amount, reason }) {
    const sale = ledger.get(entryId);
    const r = await pp.refundCapture(sale.captureId, amount, sale.currency, reason);
    const refundAmt = amount || sale.amount;
    ledger.update(sale.id, { status: amount && amount < sale.amount ? "PARTIALLY_REFUNDED" : "REFUNDED" });
    const e = ledger.add({ type: "refund", counterparty: sale.counterparty, email: sale.email, amount: -refundAmt, status: r.status, paypalId: r.id, description: `Refund of ${sale.id}: ${reason}`, ref: sale.id });
    return { ok: true, refund_id: r.id, status: r.status, ledger_id: e.id, amount: refundAmt };
  },
  async payout({ payouts, subject }) {
    const r = await pp.createPayout(payouts, subject);
    const ids = payouts.map((p) => ledger.add({ type: "payout", counterparty: p.name || p.email, email: p.email, amount: -p.amount, status: r.status, paypalId: r.batch_id, description: p.note || "Payout" }).id);
    return { ok: true, batch_id: r.batch_id, status: r.status, ledger_ids: ids };
  },
};

export async function runMerchantTool(name, input, ctx) {
  switch (name) {
    case "create_invoice": {
      const total = input.items.reduce((s, i) => s + i.unit_amount * (i.quantity || 1), 0);
      if (total > policy.maxInvoice) return { error: `Invoice total ${fmt(total)} exceeds the policy max of ${fmt(policy.maxInvoice)}.` };
      const r = await pp.createAndSendInvoice(input);
      const e = ledger.add({
        type: "invoice", counterparty: input.recipient_name, email: input.recipient_email, amount: total, currency: input.currency || "USD",
        status: r.status, paypalId: r.id, link: r.payer_link, description: input.items.map((i) => i.name).join(", "),
        dueDate: new Date(Date.now() + (input.due_in_days ?? 14) * 86400000).toISOString().slice(0, 10),
      });
      return { ok: true, ledger_id: e.id, paypal_invoice_id: r.id, invoice_number: r.invoice_number, total, status: r.status, payer_link: r.payer_link };
    }
    case "create_payment_link": {
      const r = await pp.createOrder({ items: input.items, description: input.description, return_url: `${ctx.baseUrl}/thanks`, cancel_url: `${ctx.baseUrl}/thanks?cancel=1` });
      const e = ledger.add({ type: "order", counterparty: input.customer_name || "Customer", amount: r.total, status: r.status, paypalId: r.id, link: r.approve_link, description: input.description || input.items.map((i) => i.name).join(", "), channel: "payment link" });
      return { ok: true, ledger_id: e.id, order_id: r.id, total: r.total, payment_link: r.approve_link };
    }
    case "send_invoice_reminder": {
      const e = findEntry(input.ledger_id);
      if (e.type !== "invoice") return { error: "That entry is not an invoice." };
      await pp.remindInvoice(e.paypalId, input.note);
      ledger.update(e.id, { lastReminder: new Date().toISOString() });
      return { ok: true, reminded: e.counterparty, ledger_id: e.id };
    }
    case "cancel_invoice": {
      const e = findEntry(input.ledger_id);
      await pp.cancelInvoice(e.paypalId, input.note);
      ledger.update(e.id, { status: "CANCELLED" });
      return { ok: true, ledger_id: e.id, status: "CANCELLED" };
    }
    case "refund_payment": {
      const sale = findEntry(input.ledger_id);
      if (sale.type !== "order" || !sale.captureId) return { error: `Entry ${sale.id} is not a captured sale (status ${sale.status}). Only completed orders can be refunded.` };
      if (sale.status === "REFUNDED") return { error: "Already fully refunded." };
      const amt = input.amount || sale.amount;
      if (amt > sale.amount) return { error: `Refund ${fmt(amt)} exceeds the sale amount ${fmt(sale.amount)}.` };
      const args = { entryId: sale.id, amount: input.amount, reason: input.reason };
      if (amt > policy.autoRefundLimit) {
        const a = approvals.add({ kind: "refund", args, summary: `Refund ${fmt(amt)} to ${sale.counterparty} (${sale.id}) — "${input.reason}"`, amount: amt, sessionId: ctx.sessionId });
        return { status: "PENDING_HUMAN_APPROVAL", approval_id: a.id, message: `NOT REFUNDED YET. ${fmt(amt)} exceeds the ${fmt(policy.autoRefundLimit)} auto-approve limit, so it is waiting for the owner to approve it in the Approvals panel. Tell the user it is awaiting approval (do not say it was refunded). Do not retry.` };
      }
      return await sensitiveActions.refund(args);
    }
    case "send_payouts": {
      const total = input.payouts.reduce((s, p) => s + p.amount, 0);
      if (total > policy.autoPayoutLimit) {
        const a = approvals.add({ kind: "payout", args: input, summary: `Payout batch ${fmt(total)} to ${input.payouts.map((p) => `${p.name || p.email} (${fmt(p.amount)})`).join(", ")}`, amount: total, sessionId: ctx.sessionId });
        return { status: "PENDING_HUMAN_APPROVAL", approval_id: a.id, message: `NOT SENT YET. Batch total ${fmt(total)} exceeds the ${fmt(policy.autoPayoutLimit)} auto-approve limit, so it is waiting for the owner to approve it in the Approvals panel. Tell the user it is awaiting approval (do not say it was paid). Do not retry.` };
      }
      return await sensitiveActions.payout(input);
    }
    case "query_ledger": {
      let rows = ledger.all();
      if (input.type) rows = rows.filter((r) => r.type === input.type);
      if (input.status) rows = rows.filter((r) => r.status?.toUpperCase() === input.status.toUpperCase());
      if (input.search) { const q = input.search.toLowerCase(); rows = rows.filter((r) => `${r.id} ${r.counterparty} ${r.email} ${r.description} ${r.paypalId}`.toLowerCase().includes(q)); }
      return { count: rows.length, policy, rows: rows.slice(0, 80).map(({ link, ...r }) => r) };
    }
    case "control_ledger_view": {
      ctx.emit({ type: "grid", view: input });
      let rows = ledger.all();
      if (input.type) rows = rows.filter((r) => r.type === input.type);
      if (input.status) rows = rows.filter((r) => r.status?.toUpperCase() === input.status.toUpperCase());
      if (input.overdue_only) rows = rows.filter((r) => r.type === "invoice" && r.status === "SENT" && r.dueDate && r.dueDate < new Date().toISOString().slice(0, 10));
      if (input.text) { const q = input.text.toLowerCase(); rows = rows.filter((r) => `${r.id} ${r.counterparty} ${r.email} ${r.description} ${r.paypalId}`.toLowerCase().includes(q)); }
      if (input.reset) rows = ledger.all();
      if (input.sort_by) {
        const k = input.sort_by, dir = input.sort_dir === "asc" ? 1 : -1;
        const val = (r) => (k === "amount" ? Math.abs(r.amount) : r[k]);
        rows = [...rows].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
      }
      // Return the real rows so the model summarises actual data, never invented entries.
      return { ok: true, applied: input, visible_count: rows.length, visible_rows: rows.slice(0, 25).map(({ id, type, counterparty, amount, status, description, dueDate }) => ({ id, type, counterparty, amount, status, description, dueDate })) };
    }
    case "sync_with_paypal":
      return await syncAll();
    default: {
      if (toolkit && toolkitNames().has(name)) {
        const r = await toolkit.handleToolCall({ id: `call_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(input) } });
        try { return JSON.parse(r.content); } catch { return { result: r.content }; }
      }
      return { error: `Unknown tool ${name}` };
    }
  }
}

let syncing = null;
export function syncAll() {
  // One sync at a time (UI auto-sync + agent tool can overlap); entries checked in parallel.
  syncing ||= syncOnce().finally(() => { syncing = null; });
  return syncing;
}

async function syncOnce() {
  const changes = [];
  await Promise.all(ledger.all().map(async (e) => {
    try {
      if (e.type === "invoice" && !["PAID", "CANCELLED", "REFUNDED"].includes(e.status)) {
        const r = await pp.getInvoice(e.paypalId);
        if (r.status && r.status !== e.status) { changes.push(`${e.id} ${e.status}→${r.status}`); ledger.update(e.id, { status: r.status }); }
      } else if (e.type === "order" && ["CREATED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(e.status)) {
        const r = await pp.getOrder(e.paypalId);
        if (r.status === "APPROVED") {
          const c = await pp.captureOrder(e.paypalId);
          ledger.update(e.id, { status: c.status, captureId: c.capture_id, email: c.payer_email || e.email });
          changes.push(`${e.id} captured`);
        } else if (r.status && r.status !== e.status) { changes.push(`${e.id} ${e.status}→${r.status}`); ledger.update(e.id, { status: r.status, ...(r.capture_id ? { captureId: r.capture_id } : {}) }); }
      } else if (e.type === "payout" && ["PENDING", "PROCESSING"].includes(e.status)) {
        const r = await pp.getPayout(e.paypalId);
        if (r.status !== e.status) { changes.push(`${e.id} ${e.status}→${r.status}`); ledger.update(e.id, { status: r.status }); }
      }
    } catch (err) { changes.push(`${e.id}: ${err.message}`); }
  }));
  return { ok: true, changes };
}

// ============ Shopper agent (storefront concierge) ============
export const shopperTools = [
  {
    name: "search_products",
    description: "Search the Ember & Oak Coffee catalog. Returns matching products with sku and price.",
    input_schema: obj({ query: str("Keywords like 'gift pour over light roast'. Empty for everything."), max_price: num("Optional max unit price") }),
  },
  {
    name: "add_to_cart",
    description: "Add a product to the shopper's cart.",
    input_schema: obj({ sku: str("Product SKU"), quantity: num("Quantity, default 1") }, ["sku"]),
  },
  {
    name: "remove_from_cart",
    description: "Remove a product from the cart.",
    input_schema: obj({ sku: str("Product SKU") }, ["sku"]),
  },
  {
    name: "view_cart",
    description: "Show the cart contents and total.",
    input_schema: obj({}),
  },
  {
    name: "start_checkout",
    description: "Create a PayPal order for the current cart and show the PayPal checkout button to the shopper. Only call when the shopper says they're ready to buy. Respects the shopper's stated budget: pass it so the order is blocked if the cart exceeds it.",
    input_schema: obj({ budget: num("Shopper's stated max budget in USD, if any") }),
  },
];

const cartTotal = (cart) => cart.reduce((s, i) => s + i.price * i.quantity, 0);
const cartView = (cart) => ({ items: cart.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, line_total: +(i.price * i.quantity).toFixed(2) })), total: +cartTotal(cart).toFixed(2) });

export async function runShopperTool(name, input, ctx) {
  const cart = ctx.session.cart;
  switch (name) {
    case "search_products": {
      let res = searchCatalog(input.query, input.max_price);
      if (!res.length) res = searchCatalog("", input.max_price);
      return { products: res.slice(0, 8).map(({ emoji, ...p }) => p) };
    }
    case "add_to_cart": {
      const p = catalog.find((c) => c.sku === input.sku);
      if (!p) return { error: "Unknown SKU" };
      const line = cart.find((i) => i.sku === p.sku);
      if (line) line.quantity += input.quantity || 1; else cart.push({ ...p, quantity: input.quantity || 1 });
      ctx.emit({ type: "cart", cart: cartView(cart) });
      return cartView(cart);
    }
    case "remove_from_cart": {
      const i = cart.findIndex((c) => c.sku === input.sku);
      if (i >= 0) cart.splice(i, 1);
      ctx.emit({ type: "cart", cart: cartView(cart) });
      return cartView(cart);
    }
    case "view_cart":
      return cartView(cart);
    case "start_checkout": {
      if (!cart.length) return { error: "Cart is empty." };
      const total = cartTotal(cart);
      if (input.budget && total > input.budget) return { error: `Cart total $${total.toFixed(2)} exceeds the shopper's budget of $${input.budget}. Suggest changes before checkout.` };
      const r = await pp.createOrder({
        items: cart.map((i) => ({ name: i.name, quantity: i.quantity, unit_amount: i.price, sku: i.sku })),
        description: "Ember & Oak Coffee order (AI concierge)",
      });
      const e = ledger.add({ type: "order", counterparty: "Storefront shopper", amount: total, status: r.status, paypalId: r.id, description: cart.map((i) => `${i.quantity}× ${i.name}`).join(", "), channel: "AI concierge" });
      ctx.session.orderId = r.id;
      ctx.emit({ type: "checkout", orderId: r.id, total, ledgerId: e.id, mockApprove: pp.MOCK ? r.approve_link : null });
      return { ok: true, order_id: r.id, total, message: "PayPal checkout button is now displayed to the shopper. Tell them to click it to pay securely." };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
