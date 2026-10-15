---
name: medusa-erp-inventory-sync
description: >-
  Use when designing a two-way ERP integration (e.g. Zoho Inventory) with Medusa v2: ERP-to-Medusa stock via webhooks, Medusa-to-ERP orders, locking, idempotency, reconciliation and cart-time stock checks.
---
# medusa-erp-inventory-sync

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Items marked *(verified)* were checked against docs.medusajs.com on 2026-10-15; items marked *(per Medusa Cloud Assistant, not verified in docs)* came from a Medusa Cloud Assistant chat and must be re-checked before use. Re-check everything after Medusa upgrades.

This is **architecture guidance for code you write in the Medusa backend**. The plugin itself never runs these workflows; for one-off stock edits use the dry-run tools in [inventory-sync-tips](../inventory-sync-tips/SKILL.md). Example ERP: a generic "Zoho Inventory".

## Direction A: ERP → Medusa (stock)
1. **Webhook API route** with the raw body preserved: `bodyParser: { preserveRawBody: true }` in `src/api/middlewares.ts` for that route *(verified: https://docs.medusajs.com/resources/recipes/erp)*. Add a middleware that checks the ERP's HMAC signature over the raw body before the handler runs *(HMAC check: standard practice, not in official docs)*.
2. **Idempotency:** hash the payload (or use the ERP's event id) and store it with the Caching Module `get`/`set` with a TTL; skip if seen *(Caching Module and TTL verified: https://docs.medusajs.com/resources/infrastructure-modules/caching; the `simpleHash` helper name is per Medusa Cloud Assistant, not verified in docs, any stable hash works)*.
3. **ID mapping via `metadata`:** e.g. `zoho_item_id` on inventory items and `zoho_warehouse_id` on stock locations. The ERP recipe stores ERP ids in `external_id` / `metadata` *(pattern verified in the ERP recipe; these exact key names are our convention)*.
4. **Write stock** with `updateInventoryLevelsWorkflow.runAsStep(...)` inside your workflow, wrapped in `acquireLockStep` / `releaseLockStep` keyed on the inventory item + location *(locking steps verified: https://docs.medusajs.com/learn/fundamentals/workflows/locks)*. Medusa does not lock this for you *(per Medusa Cloud Assistant, not verified in docs)*.
5. **Don't block the webhook.** The assistant's example `await`ed the whole workflow inside the route, so the ERP waits for the full sync and retries on timeout. That is **not** asynchronous. Better: verify + dedupe, then **emit a custom event** and return `200` right away; a subscriber on that event runs the sync workflow. Emitting from a workflow uses `emitEventStep`, which emits only after the workflow succeeds *(verified: https://docs.medusajs.com/learn/fundamentals/events-and-subscribers/emit-event)*. Returning before processing is our recommendation; the docs don't prescribe a webhook ack pattern *(not in official docs)*.

## Direction B: Medusa → ERP (orders, stock changes)
- **Order sync:** subscriber → workflow → step that creates the ERP order, with a **compensation function** passed as the third argument to `createStep` *(verified: ERP recipe + https://docs.medusajs.com/learn/fundamentals/workflows/compensation-function)*. Note: the docs recipe subscribes to **`order.created`**; the assistant said `order.placed`. Check the events reference for your version before choosing.
- The recipe's compensation **deletes the ERP order** on failure. That is a **design choice**, not a rule: many ERPs prefer cancel/void over delete for audit trails. Decide with the ERP owner.
- **Stock changes back to the ERP:** subscribe to `inventory-level.updated` and `reservation-item.updated` *(event names verified: https://docs.medusajs.com/resources/references/inventory/events)* **and** run a scheduled reconciliation job (events can be missed; jobs catch drift) *(scheduled jobs verified in the ERP recipe; "use both" is per Medusa Cloud Assistant)*.

## Cart-time stock checks
- Use `addToCartWorkflow.hooks.validate` and `completeCartWorkflow.hooks.validate` to check ERP availability *(verified: ERP recipe)*.
- Cache ERP stock ~30s to stay under the ERP's rate limits (Zoho was quoted at ~100 req/min) *(per Medusa Cloud Assistant, not verified in docs; check your ERP plan's limit)*.
- `manage_inventory: false` → variant is always considered in stock (display only); `true` → Medusa reserves and enforces stock *(verified: https://docs.medusajs.com/resources/commerce-modules/product/variant-inventory)*.

## Known risks
See [references/known-issues.md](../../references/known-issues.md): bundle oversell, concurrent-checkout orphan orders, Redis lock deadlocks, multi-location fulfillment.
