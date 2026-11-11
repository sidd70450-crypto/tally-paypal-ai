## Inspiration

Small business owners don't need another dashboard. They need someone to *do* the money work: send the invoice, chase the late payer, refund the unhappy customer, pay the photographer. That work is repetitive, spread across screens, and it eats hours every week that owners should spend running the business.

Most AI tools only *talk*: they draft an email or summarise a report, and the person still clicks through PayPal. Very few let AI *act*, because letting an AI move money is scary. We wanted to find out what it takes to let an AI agent operate a real PayPal account **safely**.

## What it does

**Tally** puts two AI agents on PayPal, one on each side of a sale, sharing one live ledger.

### ☕ Shopping concierge (agentic commerce)
A customer of *Ember & Oak Coffee* (our demo shop) says *"a gift for a pour-over nerd under $50."* The concierge searches the real catalog (it can't invent products or prices), builds a cart **within the budget**, creates a **PayPal order** and shows the **PayPal Smart Payment Button** in the chat. The buyer approves in PayPal and the server captures the payment. The AI never sees card details.

### 🧾 Tally, the AI finance clerk
The owner types plain English, or **drops in a document** (a purchase order, a photo of a timesheet, a receipt), and Tally acts through PayPal:

- **Invoices:** create and email PayPal invoices, send reminders, cancel
- **Payment links:** one-off PayPal checkout links
- **Refunds:** full or partial, found from the original sale
- **Payouts:** pay contractors and suppliers by email
- **Questions:** "Who still owes us money?" syncs live with PayPal first, then answers from real data
- **Disputes, transactions and shipment tracking** through PayPal's official **Agent Toolkit**
- **It drives the screen:** "show me only payouts, biggest first" makes Tally filter, sort and highlight the **AG Grid** ledger live

### 🛡️ Guardrails: a human holds the purse strings
Refunds over **\$50** and payout batches over **\$100** are **held, not executed**. An approval card appears, and money moves only after a person clicks **Approve & send**. The limits are enforced **in server code**, not just in the prompt, and the owner can adjust them live. Every tool call is shown in the chat with its inputs, PayPal's response and the agent's reasoning.

### 📒 Live ledger
Every agent action and every customer payment streams into an **AG Grid** ledger in real time. Changed rows flash, overdue invoices are flagged, and clicking a row opens one-click actions (remind, cancel, full or 50% refund) that Tally carries out.

## How we built it

**AI.** Google **Gemini** with function calling in our own agent loop. There are **19 tools**: 9 custom clerk tools, 5 from PayPal's Agent Toolkit and 5 concierge tools. Gemini reads PDFs and images for the document-to-invoice feature, and its reasoning summaries are shown in the UI. The loop also supports Anthropic Claude as a drop-in alternative.

**PayPal.** Everything runs on the PayPal sandbox:

| PayPal API | Used for |
|---|---|
| OAuth 2.0 | Client-credentials token, cached and refreshed |
| Orders v2 | Concierge checkout and payment links (create, get, capture) |
| JS SDK Smart Payment Buttons | Buyer approval of the order the AI created |
| Invoicing v2 | Create, send, remind, cancel, get |
| Payments v2 | Full and partial refunds |
| Payouts v1 | Paying contractors by email |
| Agent Toolkit | Disputes, transaction search, shipment tracking |

Every write sends a `PayPal-Request-Id` idempotency key.

**App.** Node.js and Express, Server-Sent Events for live updates, a vanilla-JS frontend with an animated dark UI, and **AG Grid Community** for the ledger. It's deployed on **Render** from a one-click blueprint, with a "hosted mode" that protects the shared demo ledger.

**Verified on the real sandbox:** invoice sent from a sample PO (\$344), storefront orders paid and captured, an auto-refund (\$24), a held refund approved by a person (\$65), and a contractor payout batch that reached `SUCCESS`.

## Challenges we ran into

- **Trusting an AI with money.** We moved the safety rules out of the prompt and into code, so a held refund or payout physically cannot run until a person approves it.
- **The AI making things up.** In testing, a model invented ledger rows when asked to filter the grid. We fixed it by making every tool return the real rows and adding a strict "never invent entries" rule. Answers are now grounded in PayPal data.
- **Free-tier limits.** Gemini's free tier caps each model per day, so Tally rotates automatically across four Gemini models, even mid-conversation, without losing the thread.
- **PayPal setup surprises.** Payouts were blocked for our first sandbox account's country, so we moved to a US sandbox business account. After enabling Invoicing, PayPal kept returning a cached token without the new permission, so the client now refreshes its token automatically.
- **Keeping two agents in sync.** The concierge's sale has to land in the clerk's ledger right away so it can be refunded, which we solved with a shared ledger and Server-Sent Events.

## Accomplishments that we're proud of

- A full **agentic commerce loop on real PayPal APIs**: an AI sells, a customer pays, an AI refunds, and an AI pays contractors, with a person approving anything risky.
- **Documents become money:** drop in a timesheet and contractors get paid, after approval.
- An AI that **controls the interface**, not just a chat box beside it.
- A finished product rather than a proof of concept: landing page, storefront, console, guided demo steps and a mobile layout.

## What we learned

- The hard part of agentic payments isn't calling the API. It's **designing trust**: approvals, limits, transparency and grounding.
- Tool results should carry the real data the model needs, or it will fill the gaps itself.
- Small UX touches, like showing each tool call and its PayPal response, make AI actions feel safe instead of magical.

## What's next for Tally

- PayPal **webhooks** in place of polling
- **Vaulted payment methods**, so the concierge can reorder within a spending limit the customer signed off
- AI-drafted **dispute responses** using evidence from the ledger
- **Multi-merchant onboarding** with PayPal Partner Referrals

*All demo transactions run in the PayPal sandbox; no real money moves.*
