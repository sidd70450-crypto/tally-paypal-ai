// Tiny JSON-file ledger of every money movement Tally's agents make, plus
// pending human approvals and a live event bus for the UI.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const FILE = path.resolve(process.env.DATA_FILE || "data/ledger.json");
fs.mkdirSync(path.dirname(FILE), { recursive: true });

export const bus = new EventEmitter();
bus.setMaxListeners(100);

let db = { entries: [], approvals: [] };
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* fresh start */ }

function save() {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  bus.emit("change");
}

export const ledger = {
  all: () => db.entries,
  get: (id) => db.entries.find((e) => e.id === id || e.paypalId === id),
  add(entry) {
    const e = { id: `T${String(db.entries.length + 1).padStart(4, "0")}`, createdAt: new Date().toISOString(), currency: "USD", ...entry };
    db.entries.unshift(e);
    save();
    return e;
  },
  update(id, patch) {
    const e = ledger.get(id);
    if (e) { Object.assign(e, patch, { updatedAt: new Date().toISOString() }); save(); }
    return e;
  },
  reset() { db = { entries: [], approvals: [] }; save(); },
};

export const approvals = {
  pending: () => db.approvals.filter((a) => a.status === "pending"),
  get: (id) => db.approvals.find((a) => a.id === id),
  add(a) {
    const rec = { id: `APR-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, status: "pending", createdAt: new Date().toISOString(), ...a };
    db.approvals.unshift(rec);
    save();
    return rec;
  },
  resolve(id, status, result) {
    const a = approvals.get(id);
    if (a) { a.status = status; a.result = result; a.resolvedAt = new Date().toISOString(); save(); }
    return a;
  },
};

// Spending guardrails for autonomous agent actions.
export const policy = {
  autoRefundLimit: Number(process.env.AUTO_REFUND_LIMIT ?? 50),
  autoPayoutLimit: Number(process.env.AUTO_PAYOUT_LIMIT ?? 100),
  maxInvoice: Number(process.env.MAX_INVOICE ?? 10000),
};
