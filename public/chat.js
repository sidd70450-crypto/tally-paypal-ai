// Shared chat client: streams agent events over SSE (POST + fetch reader).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Minimal, safe markdown: bold, italics, code, links, lists, tables, paragraphs.
export function md(src) {
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">link ↗</a>')
    .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<i>$2</i>");
  const lines = src.split("\n");
  let out = "", i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().slice(1, -1).split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out += "<table>" + body.map((r, ri) => "<tr>" + cells(r).map((c) => ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</table>";
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      out += "<ul>";
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) out += `<li>${inline(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>`;
      out += "</ul>";
      continue;
    }
    if (/^#{1,4}\s/.test(l)) { out += `<p><b>${inline(l.replace(/^#+\s/, ""))}</b></p>`; i++; continue; }
    if (l.trim()) out += `<p>${inline(l)}</p>`;
    i++;
  }
  return out;
}

const TOOL_LABELS = {
  create_invoice: "Creating PayPal invoice", create_payment_link: "Creating PayPal checkout link", send_invoice_reminder: "Sending PayPal reminder",
  cancel_invoice: "Cancelling invoice", refund_payment: "Refunding via PayPal", send_payouts: "Sending PayPal Payouts", query_ledger: "Reading ledger",
  sync_with_paypal: "Syncing with PayPal", search_products: "Searching catalog", add_to_cart: "Adding to cart", remove_from_cart: "Removing from cart",
  view_cart: "Checking cart", start_checkout: "Creating PayPal order", control_ledger_view: "Updating your ledger view",
};

export function createChat({ el, endpoint, sessionId, onEvent, onBusy }) {
  const scroll = () => (el.scrollTop = el.scrollHeight);
  const add = (cls, html) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; el.appendChild(d); scroll(); return d; };
  const steps = new Map();
  let busy = false;

  async function send(message, attachments = []) {
    if (busy) return;
    busy = true;
    const chips = attachments.map((a) => `<span class="attach-chip">📎 ${esc(a.name)}</span><br>`).join("");
    add("msg user", chips + esc(message || "").replace(/\n/g, "<br>"));
    onBusy?.(true);
    let typing = add("typing", "<span></span>");
    const moveTyping = () => { el.appendChild(typing); scroll(); };
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message, attachments }) });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (!chunk.startsWith("data: ")) continue;
          const ev = JSON.parse(chunk.slice(6));
          handle(ev);
          onEvent?.(ev);
          moveTyping();
        }
      }
    } catch (err) {
      add("msg err", esc(err.message));
    } finally {
      typing.remove();
      busy = false;
      onBusy?.(false);
    }

    function handle(ev) {
      if (ev.type === "text") add("msg agent", md(ev.text));
      else if (ev.type === "thinking") {
        const d = add("step thinking done", `<details><summary><span class="dot"></span>💭 Reasoning</summary><pre>${esc(ev.text)}</pre></details>`);
      } else if (ev.type === "tool_call") {
        const d = add("step", `<details><summary><span class="dot"></span><span class="tool">${esc(ev.name)}</span> ${esc(TOOL_LABELS[ev.name] || "")}…</summary><pre>${esc(JSON.stringify(ev.input, null, 2))}</pre></details>`);
        steps.set(ev.id, d);
      } else if (ev.type === "tool_result") {
        const d = steps.get(ev.id);
        if (!d) return;
        const pending = ev.output?.status === "PENDING_HUMAN_APPROVAL";
        d.classList.add(ev.isError ? "fail" : pending ? "pending" : "done");
        const sum = d.querySelector("summary");
        sum.innerHTML = `<span class="dot"></span><span class="tool">${esc(ev.name)}</span> ${ev.isError ? "failed" : pending ? "⏸ held for human approval" : "✓ " + esc(TOOL_LABELS[ev.name] || "done")}`;
        d.querySelector("pre").textContent += "\n\n→ " + JSON.stringify(ev.output, null, 2);
      } else if (ev.type === "error") add("msg err", esc(ev.text));
    }
  }

  return { send, add, isBusy: () => busy };
}

export function readFiles(fileList) {
  return Promise.all([...fileList].map((f) => new Promise((resolve, reject) => {
    const r = new FileReader();
    const isText = /^text\/|json|csv/.test(f.type) || /\.(txt|csv|md|json)$/i.test(f.name);
    r.onload = () => resolve(isText
      ? { name: f.name, media_type: f.type || "text/plain", text: r.result }
      : { name: f.name, media_type: f.type, data: String(r.result).split(",")[1] });
    r.onerror = reject;
    isText ? r.readAsText(f) : r.readAsDataURL(f);
  })));
}

export const sessionId = (key) => {
  let id = null;
  try { id = sessionStorage.getItem(key); } catch {}
  if (!id) { id = Math.random().toString(36).slice(2); try { sessionStorage.setItem(key, id); } catch {} }
  return id;
};
