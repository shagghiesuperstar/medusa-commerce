---
name: medusa-admin-orphan-links
description: >-
  Use when the Medusa Admin Locations list crashes (e.g. "null is not an object (evaluating 'a.name')") because a sales channel was hard-deleted and left orphaned stock-location ↔ sales-channel link rows.
---
# medusa-admin-orphan-links

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Items marked *(verified)* were checked against docs.medusajs.com on 2026-10-15; items marked *(per Medusa Cloud Assistant, not verified in docs)* came from a Medusa Cloud Assistant chat and must be re-checked before use. Re-check everything after Medusa upgrades.

**Hard rule: the plugin never executes SQL and never writes to a store for this.** Everything below is diagnosis plus guidance to hand to the database owner or Medusa support.

## Symptom
- Admin > Settings > Locations crashes with `null is not an object (evaluating 'a.name')` (seen on dashboard 2.17.2) *(field report, UNVERIFIED in docs)*.
- Storefront and checkout are unaffected *(per Medusa Cloud Assistant, not verified in docs)*.

## Diagnose (read-only)
- `GET /admin/stock-locations/{id}?fields=*sales_channels` → the `sales_channels` array contains `null` entries for the deleted channel *(field report)*.
- Stock location ↔ sales channel is a module link managed with Link *(verified: https://docs.medusajs.com/resources/commerce-modules/sales-channel/links-to-other-modules)*.

## Why the API can't fix it
- The orphaned sales-channel id can't be retrieved through the API, and on 2.17.2 `POST /admin/stock-locations/{id}/sales-channels` returned **404** in our testing, so you can't send a `remove` for it *(field report; UNVERIFIED)*. The path left is SQL by the DB owner or support.

## SQL guidance (for the DB owner only; do not run from the plugin)
Link table name **verified in Medusa source**: `sales_channel_stock_location` (`packages/modules/link-modules/src/definitions/sales-channel-location.ts`, id prefix `scloc`). The assistant's name was correct. Column names below follow link-table convention; confirm with `\d sales_channel_stock_location` first.

```sql
-- 1. Find orphans (read-only)
SELECT l.id, l.sales_channel_id, l.stock_location_id
FROM sales_channel_stock_location l
LEFT JOIN sales_channel sc ON sc.id = l.sales_channel_id
WHERE sc.id IS NULL AND l.deleted_at IS NULL;

-- 2. Count before
SELECT COUNT(*) FROM sales_channel_stock_location l
LEFT JOIN sales_channel sc ON sc.id = l.sales_channel_id WHERE sc.id IS NULL;

-- 3. Scoped delete, in a transaction, after a backup
BEGIN;
DELETE FROM sales_channel_stock_location l
WHERE l.sales_channel_id = '<orphan_sales_channel_id>'
  AND NOT EXISTS (SELECT 1 FROM sales_channel sc WHERE sc.id = l.sales_channel_id);
-- 4. Count after (expect 0), then COMMIT or ROLLBACK
COMMIT;
```
Prevention: soft-delete or unlink sales channels from locations before deleting them.
