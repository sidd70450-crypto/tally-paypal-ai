// Thin PayPal REST client (sandbox by default) with a mock mode so the app
// runs end-to-end even before credentials are configured.
import crypto from "node:crypto";

const BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

export const MOCK = !(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

let token = null;
let tokenExp = 0;

async function getToken() {
  if (token && Date.now() < tokenExp - 60_000) return token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  token = json.access_token;
  tokenExp = Date.now() + json.expires_in * 1000;
  return token;
}

export class PayPalError extends Error {
  constructor(status, body) {
    const issue = body?.details?.[0];
    super(`PayPal ${status}: ${body?.name || ""} ${issue ? `${issue.issue} - ${issue.description || ""}` : body?.message || ""}`.trim());
    this.status = status;
    this.body = body;
  }
}

async function api(method, path, body, extraHeaders = {}, retried = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID(),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    // Token revoked or expired early: fetch a fresh one and retry once.
    token = null;
    return api(method, path, body, extraHeaders, true);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(res.status, json);
  return json;
}

const money = (value, currency = "USD") => ({ currency_code: currency, value: Number(value).toFixed(2) });
const mockId = (p) => `${p}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const mockState = new Map(); // id -> object, for mock mode

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// ---------- Invoicing v2 ----------
export async function createAndSendInvoice({ recipient_name, recipient_email, items, currency = "USD", due_in_days = 14, note, memo }) {
  const [given_name, ...rest] = (recipient_name || "Customer").split(" ");
  const total = items.reduce((s, i) => s + Number(i.unit_amount) * Number(i.quantity || 1), 0);
  if (MOCK) {
    const id = mockId("INV2");
    const inv = { id, status: "SENT", total, link: `/mock/invoice/${id}` };
    mockState.set(id, inv);
    return { id, status: "SENT", total, payer_link: inv.link, invoice_number: String(1000 + mockState.size) };
  }
  const draft = await api("POST", "/v2/invoicing/invoices", {
    detail: {
      currency_code: currency,
      invoice_date: today(),
      note: note || "Thank you for your business!",
      memo,
      payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: addDays(due_in_days) },
    },
    primary_recipients: [{
      billing_info: { name: { given_name, surname: rest.join(" ") || undefined }, email_address: recipient_email },
    }],
    items: items.map((i) => ({
      name: i.name,
      description: i.description,
      quantity: String(i.quantity || 1),
      unit_amount: money(i.unit_amount, currency),
      unit_of_measure: "QUANTITY",
    })),
  });
  const id = draft.id;
  const sent = await api("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: true, send_to_recipient: true });
  return {
    id,
    status: "SENT",
    total,
    invoice_number: draft.detail?.invoice_number,
    payer_link: sent.href || draft.detail?.metadata?.recipient_view_url,
  };
}

export async function getInvoice(id) {
  if (MOCK) return mockState.get(id) || { id, status: "SENT" };
  const inv = await api("GET", `/v2/invoicing/invoices/${id}`);
  return { id, status: inv.status, due_amount: inv.due_amount, payments: inv.payments, payer_link: inv.detail?.metadata?.recipient_view_url };
}

export async function remindInvoice(id, note) {
  if (MOCK) return { id, reminded: true };
  await api("POST", `/v2/invoicing/invoices/${id}/remind`, {
    subject: "Friendly reminder: invoice due",
    note: note || "Just a friendly reminder that this invoice is awaiting payment.",
    send_to_invoicer: false,
    send_to_recipient: true,
  });
  return { id, reminded: true };
}

export async function cancelInvoice(id, note) {
  if (MOCK) { const i = mockState.get(id); if (i) i.status = "CANCELLED"; return { id, status: "CANCELLED" }; }
  await api("POST", `/v2/invoicing/invoices/${id}/cancel`, {
    subject: "Invoice cancelled", note: note || "This invoice has been cancelled.", send_to_invoicer: false, send_to_recipient: true,
  });
  return { id, status: "CANCELLED" };
}

// ---------- Orders v2 ----------
export async function createOrder({ items, currency = "USD", description, return_url, cancel_url, brand_name = "Ember & Oak Coffee" }) {
  const item_total = items.reduce((s, i) => s + Number(i.unit_amount) * Number(i.quantity || 1), 0);
  if (MOCK) {
    const id = mockId("ORD");
    mockState.set(id, { id, status: "CREATED", total: item_total });
    return { id, status: "CREATED", total: item_total, approve_link: `/mock/approve/${id}` };
  }
  const order = await api("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      description: description?.slice(0, 127),
      amount: { ...money(item_total, currency), breakdown: { item_total: money(item_total, currency) } },
      items: items.map((i) => ({
        name: i.name.slice(0, 127),
        quantity: String(i.quantity || 1),
        unit_amount: money(i.unit_amount, currency),
        category: "PHYSICAL_GOODS",
        sku: i.sku,
      })),
    }],
    payment_source: return_url ? {
      paypal: { experience_context: { brand_name, user_action: "PAY_NOW", return_url, cancel_url: cancel_url || return_url, shipping_preference: "NO_SHIPPING" } },
    } : undefined,
  });
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
  return { id: order.id, status: order.status, total: item_total, approve_link: approve?.href };
}

export async function getOrder(id) {
  if (MOCK) return mockState.get(id) || { id, status: "CREATED" };
  const o = await api("GET", `/v2/checkout/orders/${id}`);
  const capture = o.purchase_units?.[0]?.payments?.captures?.[0];
  return { id, status: o.status, capture_id: capture?.id, payer: o.payer };
}

export async function captureOrder(id) {
  if (MOCK) {
    const o = mockState.get(id) || { id };
    o.status = "COMPLETED"; o.capture_id = mockId("CAP");
    return { id, status: "COMPLETED", capture_id: o.capture_id, payer_email: "buyer@example.com", payer_name: "Sandbox Buyer" };
  }
  const o = await api("POST", `/v2/checkout/orders/${id}/capture`, {});
  const capture = o.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    id, status: o.status, capture_id: capture?.id,
    payer_email: o.payer?.email_address,
    payer_name: [o.payer?.name?.given_name, o.payer?.name?.surname].filter(Boolean).join(" "),
  };
}

// ---------- Payments v2: refunds ----------
export async function refundCapture(capture_id, amount, currency = "USD", note) {
  if (MOCK) return { id: mockId("REF"), status: "COMPLETED" };
  const body = {};
  if (amount) body.amount = money(amount, currency);
  if (note) body.note_to_payer = note.slice(0, 255);
  const r = await api("POST", `/v2/payments/captures/${capture_id}/refund`, body);
  return { id: r.id, status: r.status };
}

// ---------- Payouts v1 ----------
export async function createPayout(items, subject = "You have a payout!") {
  if (MOCK) {
    const id = mockId("PAYOUT");
    mockState.set(id, { id, status: "SUCCESS" });
    return { batch_id: id, status: "PENDING" };
  }
  const r = await api("POST", "/v1/payments/payouts", {
    sender_batch_header: {
      sender_batch_id: `tally_${Date.now()}`,
      email_subject: subject,
      email_message: "You received a payment via Tally.",
    },
    items: items.map((i, idx) => ({
      recipient_type: "EMAIL",
      amount: { value: Number(i.amount).toFixed(2), currency: i.currency || "USD" },
      receiver: i.email,
      note: i.note || "Thanks!",
      sender_item_id: `item_${Date.now()}_${idx}`,
    })),
  });
  return { batch_id: r.batch_header.payout_batch_id, status: r.batch_header.batch_status };
}

export async function getPayout(batch_id) {
  if (MOCK) return { batch_id, status: "SUCCESS" };
  const r = await api("GET", `/v1/payments/payouts/${batch_id}`);
  return { batch_id, status: r.batch_header.batch_status };
}

export const clientId = () => process.env.PAYPAL_CLIENT_ID || "";
