# Devpost submission kit

## Tagline
AI agents on both sides of the sale: a shopping concierge that checks out with PayPal, and a finance clerk that invoices, refunds and pays people on PayPal, with a human holding the purse strings.

## Inspiration
Small-business owners don't need another dashboard. They need someone to *do the money work*: send the invoice, chase the late payer, refund the unhappy customer, pay the photographer. We wanted to see what happens when an AI agent can actually operate a PayPal account, and how to make that safe.

## What it does
**Tally** has two AI agents (powered by Google Gemini) that share one live PayPal ledger:

1. **Shopping concierge (agentic commerce).** A customer says *"a gift for a pour-over nerd under $50."* The agent searches the real catalog, builds a cart within that budget, **creates a PayPal order** and shows the **PayPal Smart Payment Button**. The customer pays, and the order is captured.
2. **Tally, the AI finance clerk.** The owner types or **drops in a document** (a purchase-order PDF, a photo of a timesheet, a CSV). Tally reads it and acts through PayPal: **Invoicing v2** (create, send, remind, cancel), **Orders v2** payment links, **Payments v2** refunds and **Payouts**. It answers questions like *"who still owes us money?"* after syncing live statuses from PayPal.
3. **Guardrails.** Refunds over $50 and payout batches over $100 (both configurable) are **held for human approval**. They appear as approval cards and reach PayPal only after a person clicks *Approve & send*. The limits are enforced in server code, not only in the prompt.
4. **Tally drives the grid.** "Show me overdue invoices" filters, sorts and highlights the AG Grid on screen.
5. **Live AG Grid ledger.** Every agent action and every customer payment appears in the ledger as it happens. Changed statuses flash, overdue invoices are flagged automatically, and the grid supports filtering and CSV export.

## How we built it
- **AI:** **Google Gemini** (`gemini-3.5-flash`) via the Gemini API, in a custom function-calling loop (19 tools across the two agents, including PayPal's official Agent Toolkit) with parallel tool calls, thought summaries shown in the UI, and PDF and image input for reading documents. The loop also supports Anthropic Claude as a drop-in alternative.
- **PayPal:** Orders v2 with the JS SDK Smart Buttons, Invoicing v2, Payments v2 refunds, Payouts v1, OAuth client credentials, and `PayPal-Request-Id` idempotency keys, all on the sandbox.
- **App:** Node/Express, Server-Sent Events that stream agent steps and ledger changes, a vanilla-JS frontend, and **AG Grid Community** for the ledger. It deploys to **Render** with the included `render.yaml`.

## Challenges
- Making agent actions **trustworthy**. Approval gates are enforced in code, and every tool call is shown with its inputs and the PayPal response.
- Keeping the merchant ledger in sync with PayPal's asynchronous states (invoice SENT → PAID, order APPROVED → capture, payout PENDING → SUCCESS).
- Sharing state between the two agents so that the clerk can refund an order the concierge sold.

## Accomplishments
A full agentic-commerce loop that runs on real PayPal sandbox APIs: an AI sells, a customer pays, an AI refunds, and an AI pays contractors, with a person approving anything risky.

## What's next
- PayPal webhooks in place of polling
- Vaulted payment methods, so the concierge can reorder subscriptions within a spending mandate the customer has signed
- Dispute-response drafting, with evidence pulled from the ledger
- Multi-merchant onboarding with PayPal Partner Referrals

## Built with
paypal-orders-api, paypal-invoicing-api, paypal-payouts, paypal-js-sdk, google-gemini, gemini-api, node.js, express, ag-grid, server-sent-events, render

## Tools: which AI was used, and how
- **Google Gemini (gemini-3.5-flash, Gemini API):** powers both agents. It plans and calls tools that wrap the PayPal REST APIs, reads uploaded PDFs and images to extract invoice and payout data, writes personalised reminder notes, and summarises cash flow from the ledger.
- **Claude Code:** used as a coding assistant while building the project.

---

# 🎬 3-minute demo script

Before recording: start with a clean ledger (click *Reset demo*), use real sandbox keys, and keep three tabs open: the landing page `/`, the console `/console` and the storefront `/shop`.

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Landing page: the typewriter demo plays and the money-flow diagram animates | "Small businesses lose hours on money admin. Tally gives them AI agents that operate PayPal, on both sides of the sale." |
| 0:15–0:55 | `/shop`: click *"A gift for a pour-over nerd under $50"*. The agent searches, fills the cart, then *"checkout please"*. Pay with the **sandbox buyer** in the PayPal popup | "The concierge builds a cart within my budget from the real catalog, creates a PayPal order, and I pay with PayPal. The agent never touches card details." |
| 0:55–1:10 | Switch to the console: the new order row flashes into the AG Grid and *Collected* goes up | "That sale lands in the owner's live ledger right away." |
| 1:10–1:40 | Drag `wholesale-purchase-order.txt` into the chat: "Invoice this PO". Expand the `create_invoice` tool chip and open the pay link | "Tally reads the purchase order, extracts the line items, and sends a real PayPal invoice." |
| 1:40–2:10 | Drop `contractor-timesheet.csv`: "Pay everyone on this timesheet". The approval card appears. Click **Approve & send**, and the payout rows appear | "Paying contractors totals $155, which is over my $100 limit, so the agent can't send it alone. I approve it with one click and PayPal Payouts sends it." |
| 2:10–2:35 | "Refund the last storefront order — beans arrived stale" → the refund row appears, the order shows REFUNDED | "Tally finds the capture from the concierge's sale and refunds it through PayPal." |
| 2:35–2:55 | "Show me only payouts, biggest first" (the grid filters live), then "Who still owes us money?" | "And it answers questions about the business after syncing live with PayPal." |
| 2:55–3:00 | Logo / repo URL | "Tally: AI agents that move money on PayPal, with a human holding the purse strings." |
