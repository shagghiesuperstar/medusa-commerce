---
name: inventory-sync-tips
description: >-
  Use when syncing stock from an external inventory system (ERP or warehouse) into Medusa, or debugging stock that looks wrong on the storefront.
---
# inventory-sync-tips

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Model
- In Medusa v2, stock lives on **inventory items** linked to variants, with **location levels** per stock location: stocked, reserved, available *(verified: Admin API > Inventory Items)*.
- `inventory_levels {sku}` shows all three. Storefront availability depends on the variant's `manage_inventory` and the sales channel's stock locations.

## Rules
1. **Pick one source of truth per field** and write it down: for example, external system for quantity and catalog, Medusa for retail price. Never two-way sync the same field.
2. **Pilot one SKU end to end** (external qty → Medusa level → storefront PDP) before batching.
3. Always dry-run `inventory_level_update` and read `before`. The tool warns if the new stock is below reserved.
4. **Don't mass-publish zero-quantity items** created by a sync. Keep them as drafts until stock arrives.
5. Map pack sizes explicitly (e.g. case vs unit). If the external system has no case SKU, document the 1x mapping rather than guessing.
6. The tool only updates *existing* location levels. Creating levels or locations is an Admin task.
7. Scheduled syncs: log every write (sku, location, before, after) and alert on failures. Silent green is worse than a loud failure.
