---
name: medusa-event-forwarding
description: >-
  Forward real Medusa backend events (order.placed, inventory-level.updated) to the
  plugin's optional events webhook. Docs-first: store events need a backend subscriber;
  the plugin only emits its own in-process observability events.
---
# medusa-event-forwarding

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED.

## What this plugin emits vs what Medusa emits

The plugin's in-process event stream (`events_poll_since`, optional `MEDUSA_EVENTS_WEBHOOK_URL`, and `/events` SSE) captures **plugin-side** signals only: HTTP errors, health up/down transitions, publishable-key warnings, audit rows, and remediation runs. It does **not** receive Medusa commerce events by itself.

**Real store events** (`order.placed`, `inventory-level.updated`, product updates, etc.) are emitted inside the Medusa backend. To forward them to the same webhook the plugin uses, you add a **subscriber** (or workflow hook) in the Medusa app that POSTs to your URL. That code lives in the backend repo, not in this plugin.

## Plugin webhook (verified in this plugin)

| Variable | Required | What |
| --- | --- | --- |
| `MEDUSA_EVENTS_WEBHOOK_URL` | optional | HTTPS endpoint that accepts JSON POSTs |
| `MEDUSA_EVENTS_WEBHOOK_SECRET` | optional | HMAC-SHA256 secret; sent as header `X-Medusa-Plugin-Signature` (hex digest of the raw body) |

Delivery retries with exponential backoff and fails loud (`webhook_delivery_failed` events) if all attempts fail. Agents poll with `events_poll_since { cursor }`.

## Backend subscriber sketch (docs-first)

1. Call `medusa_docs` with query like `subscribers events order.placed` and open the matching official page.
2. In the Medusa backend, register a subscriber for the event names you need. Common ones:
   - `order.placed` — *(verify current name in official docs; event naming has changed across versions)*
   - `inventory-level.updated` — *(verify in official docs)*
3. In the handler, POST a small JSON payload to the **same** webhook URL you configured for the plugin. Sign with the same HMAC secret if you use one.
4. Keep PII out of the payload by default (order id / display id, not email or address).

Example shape (illustrative — re-check against official Subscriber docs before shipping):

```ts
// src/subscribers/forward-to-ops-webhook.ts  (runs in the Medusa backend)
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createHmac } from "node:crypto"

export default async function forward({ event, container }: SubscriberArgs<{ id: string }>) {
  const url = process.env.OPS_EVENTS_WEBHOOK_URL
  const secret = process.env.OPS_EVENTS_WEBHOOK_SECRET
  if (!url) return
  const body = JSON.stringify({
    type: "medusa.store_event",
    name: event.name,
    data: { id: event.data.id },
    timestamp: new Date().toISOString(),
  })
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Medusa-Plugin-Signature"] = createHmac("sha256", secret).update(body).digest("hex")
  const res = await fetch(url, { method: "POST", headers, body })
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`)
}

export const config: SubscriberConfig = {
  event: ["order.placed", "inventory-level.updated"],
}
```

### Gaps — say **"not in official docs"** when true

- Whether every event name above is stable for your Medusa minor version: **re-check with `medusa_docs`**; if the index has no match, mark **UNVERIFIED**.
- Built-in "forward all events to an external webhook" as a core feature: **not in official docs** (use a subscriber or a community module).
- This plugin opening a remote connection *into* your Medusa event bus: **not supported**; traffic is outbound from the backend (or from the plugin for plugin-local events only).

## Agent checklist

1. `medusa_docs` for subscribers / the specific event name.
2. Confirm `MEDUSA_EVENTS_WEBHOOK_URL` is reachable from the Medusa backend (and from the plugin host if you also want plugin events).
3. Prefer `events_poll_since` for agent loops; use the webhook for Slack/Pager/ops pipelines.
4. Never put secret API keys or customer PII into event payloads.
