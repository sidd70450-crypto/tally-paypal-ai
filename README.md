# 🧾 Tally — AI agents that run a small business's money on PayPal

**Tally** puts two AI agents on top of PayPal, one on each side of a sale:

| | Who uses it | What the agent does with PayPal |
|---|---|---|
| ☕ **Shopping concierge** (`/shop`) | Customers of *Ember & Oak Coffee*, a sample small roastery | Chats about taste, budget and who the gift is for, searches the real catalog, builds the cart, **creates a PayPal order** and shows the **PayPal Smart Payment Button** so the customer can pay |
| 🧾 **Tally, the finance clerk** (`/console`) | The shop owner | Turns plain requests, or a dropped-in **PO, timesheet, receipt or screenshot**, into **PayPal Invoices, payment links, reminders, refunds and Payouts**, and answers cash-flow questions. Every money movement shows up live in an **AG Grid** ledger |

The two sides share one ledger. A purchase in the storefront shows up in the owner's console a moment later. The owner can then say *"refund that order, the beans arrived stale"* and Tally finds the capture and refunds it through PayPal.

### Why it matters
Small merchants lose hours every week on invoicing, chasing late payers, refunds and paying contractors. Tally does that work from plain English, and **spending guardrails** keep a human in charge. Refunds and payouts above a set limit are **held for one-click human approval** and never run on their own. An agent also cannot split a payment to get under the limit.

---

## ✨ Features

- **A polished, animated dark UI:** aurora background, glass panels, cursor-following spotlights, 3D-tilt product cards, KPIs that count up, a pulsing AI orb while the agent works, coin bursts when money moves, and a landing page with a live typewriter demo and an interactive money-flow diagram. It respects `prefers-reduced-motion`.

- **Agentic commerce, end to end:** the AI shopper turns a request into a PayPal order and the customer pays with the PayPal button. The AI clerk then reconciles the payment, refunds it, or pays contractors from it.
- **Documents to money:** drag a purchase order PDF, a photo of a timesheet or a CSV into the chat. The AI reads it (vision and PDF input), pulls out names, emails, line items and prices, and sends the PayPal invoice or payout batch.
- **Human-in-the-loop guardrails:** `AUTO_REFUND_LIMIT` and `AUTO_PAYOUT_LIMIT` decide which actions need approval. A held action appears as an approval card, and it reaches PayPal only after a person clicks **Approve & send**.
- **Tally drives the grid:** say *"show me overdue invoices"* or *"only payouts, biggest first"*, and Tally applies AG Grid filters, sorting and row highlights on your screen live (`control_ledger_view`), with a "Tally filtered…" chip to clear it.
- **PayPal Agent Toolkit built in:** PayPal's official `@paypal/agent-toolkit` adds disputes, transaction search and shipment-tracking tools to the same agent loop as Tally's custom PayPal tools.
- **Live AG Grid ledger:** rows are pushed over Server-Sent Events and update in place, changed statuses flash, overdue invoices are flagged automatically, and the grid has quick filter, column filters, sorting, pinned IDs, pay-link cells and CSV export.
- **Easy to pick up:** a numbered **"Try the full loop"** strip walks a new user through selling, invoicing, paying, refunding and asking, and each step ticks off as it really happens. Sample documents load with one click. Clicking a ledger row opens a **detail drawer** with one-click actions (remind, cancel, full or 50% refund) that Tally carries out. **Guardrail limits can be changed live**, toasts announce each payment, and an **"Admin time saved"** KPI shows the work Tally has taken off the owner.
- **Visible agent work:** each tool call (for example `create_invoice` or `refund_payment`) appears in the chat with its inputs and the PayPal response, next to a summary of the model's reasoning.
- **Auto-sync:** open invoices, orders and payouts are re-checked against PayPal every 20 seconds. Orders the buyer has approved are captured automatically.
- **Mock mode:** with no PayPal keys, every PayPal call is simulated, so judges can try the full flow in a minute.

## 🔌 PayPal integration

| PayPal API | Endpoint(s) | Used for |
|---|---|---|
| OAuth 2.0 | `POST /v1/oauth2/token` | Client-credentials token, cached |
| **Orders v2** | `POST /v2/checkout/orders`, `GET /v2/checkout/orders/{id}`, `POST …/capture` | Concierge checkout and the clerk's payment links |
| **JS SDK: Smart Payment Buttons** | `paypal.Buttons({ createOrder, onApprove })` | Customer approval of the order the AI created |
| **Invoicing v2** | `POST /v2/invoicing/invoices`, `…/{id}/send`, `…/{id}/remind`, `…/{id}/cancel`, `GET …/{id}` | Billing wholesale clients, chasing late payers |
| **Payments v2** | `POST /v2/payments/captures/{id}/refund` | Full and partial refunds |
| **Payouts v1** | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{batch_id}` | Paying contractors and suppliers by email |

Every write sends a `PayPal-Request-Id` idempotency key.

**Plus PayPal's official Agent Toolkit** (`@paypal/agent-toolkit`): `list_disputes`, `get_dispute`, `list_transactions`, `create_shipment_tracking` and `get_shipment_tracking` are loaded from the toolkit, given Gemini-compatible schemas, and run through `toolkit.handleToolCall()` in the same loop ([src/tools.js](src/tools.js)).

## 🤖 AI integration

- **Model:** **Google Gemini** (`gemini-3.5-flash` by default, free tier) via the Gemini API with function calling. Anthropic **Claude** is supported as a drop-in alternative (`AI_PROVIDER=claude`).
- **How it is used:** a custom tool-use loop ([src/agent.js](src/agent.js)). The **clerk** has 9 custom tools plus 5 from PayPal's Agent Toolkit, and the **concierge** has 5 ([src/tools.js](src/tools.js)). Claude decides which tools to call, chains them (for example *sync → query ledger → send reminders*) and calls independent tools in parallel.
- **Multimodal:** PDFs and images are sent to the model as inline data, and it extracts the invoice or payout details from them.
- **Reasoning summaries** (Gemini thought summaries / Claude adaptive thinking) are shown in the UI. Free-tier quotas are handled automatically: per-minute limits are retried with backoff, and when a model hits its daily quota Tally switches to the next model in the chain mid-conversation.
- **Safety:** the system prompt plus guardrails enforced in code. Limits are checked on the server and do not depend on the model.

## 🏗️ Architecture

```
 Browser (/shop)                    Browser (/)  merchant console
 concierge chat + PayPal Buttons    Tally chat · approvals · AG Grid ledger
        │  SSE (agent events)              │  SSE (agent events + live ledger)
        ▼                                  ▼
 ┌──────────────────────── Node / Express (server.js) ─────────────────────────┐
 │ agent.js   AI tool-use loop (Gemini, or Claude)                              │
 │ tools.js   concierge tools · clerk tools · guardrails → approvals queue     │
 │ paypal.js  Orders · Invoicing · Refunds · Payouts (sandbox, or mock)         │
 │ store.js   JSON ledger + event bus                                           │
 └──────────────────────────────────────────────────────────────────────────────┘
```

No build step: the server is plain Node, and the frontend is vanilla JS with AG Grid Community from a CDN.

---

## 🚀 Run it

**Requirements:** Node 20 or newer, a free [Gemini API key](https://aistudio.google.com/apikey) (or an Anthropic key), and optionally a [PayPal sandbox app](https://developer.paypal.com/dashboard/applications/sandbox).

```bash
git clone <this repo> && cd tally-paypal-ai
npm install
cp .env.example .env      # add GEMINI_API_KEY, plus PayPal sandbox keys (optional)
npm start
```

Open **http://localhost:3000** for the animated landing page, **/console** for the merchant console and **/shop** for the storefront.

> Without `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` the app runs in **mock mode**, which simulates PayPal so the whole flow can be tried with only a free Gemini key.

### PayPal sandbox setup (5 minutes)
1. Go to developer.paypal.com → **Apps & Credentials** → Sandbox → **Create App** (Merchant), then copy the Client ID and Secret into `.env`.
2. In the app's features, make sure **Invoicing**, **Payouts** and (for the toolkit's transaction search) **Transaction search** are enabled. After changing features, PayPal may keep returning a cached token for a while; the app retries with a fresh token on 401. Use a **US** sandbox business account: PayPal blocks Payouts from some countries (`PAYOUT_NOT_AVAILABLE`).
3. Under **Sandbox accounts**, use the default *Personal* account (or create one) to pay in the storefront with the PayPal button.

### Deploy to Render
The repo includes [`render.yaml`](render.yaml). Choose **New → Blueprint**, select the repo, and fill in `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.

The blueprint turns on **hosted mode** (`HOSTED=1`): the demo ledger is shared, so the Reset button is hidden and `/api/reset` needs the generated `ADMIN_TOKEN` (`curl -X POST -H "x-admin-token: <token>" https://<app>/api/reset`).

> **Free-tier note:** the hosted demo runs on a free Gemini key, and free-tier quotas are per model per day. Tally automatically switches between four Gemini models when one runs out. If every model is exhausted, the chat says so; running locally with your own free key avoids that.

## 🎬 Try these

**Storefront (`/shop`)**
- "A gift for a pour-over nerd under $50" → the agent picks items, fills the cart and checks out → pay with the sandbox buyer account.

**Console (`/console`)**
- "Invoice Blue Bottle Cafe (orders@bluebottle.example) for 40lb House Espresso at $19/lb, due in 10 days"
- Drop in [`samples/wholesale-purchase-order.txt`](samples/wholesale-purchase-order.txt): "Invoice this PO"
- Drop in [`samples/contractor-timesheet.csv`](samples/contractor-timesheet.csv): "Pay everyone on this timesheet" → total $155, **held for approval** → click Approve
- "Refund the last storefront order — beans arrived stale"
- "Who still owes us money? Nudge anyone overdue."
- "Give me a quick cash-flow summary"

## ⚙️ Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `gemini` | `gemini` or `claude` |
| `GEMINI_API_KEY` | – | Free Gemini key (aistudio.google.com/apikey) |
| `GEMINI_MODELS` | `gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest` | Model chain: when one model hits its free-tier daily quota, Tally switches to the next automatically |
| `GEMINI_THINKING` | `low` | Gemini thinking level (`low` keeps replies fast) |
| `ANTHROPIC_API_KEY` | – | Only if `AI_PROVIDER=claude` |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude model |
| `CLAUDE_EFFORT` | `low` | `low` / `medium` / `high`; higher effort means deeper reasoning but slower replies |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | – | Sandbox REST credentials; leave empty for mock mode |
| `AUTO_REFUND_LIMIT` | `50` | Refunds above this need human approval |
| `AUTO_PAYOUT_LIMIT` | `100` | Payout batches above this need human approval |
| `MAX_INVOICE` | `10000` | Hard cap per invoice |
| `HOSTED` | – | `1` hides Reset and protects `/api/reset` with `ADMIN_TOKEN` |
| `PAYPAL_AGENT_TOOLKIT` | on | `off` disables the PayPal Agent Toolkit tools |

## License
[MIT](LICENSE)
