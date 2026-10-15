---
name: draft-product-pipeline
description: >-
  Use when turning product photos or a spreadsheet row into a Medusa product. Images go to a DRAFT product only; a human reviews and publishes in Medusa Admin. Never auto-publish.
---
# draft-product-pipeline

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Pipeline (images → draft → human publish)
1. **Intake:** collect final, already-hosted image URLs (after any background-removal or template step). This plugin does not upload files; host images in your file storage first.
2. **Match:** map each image to a product/SKU with an agreed, written filename→SKU rule. If no rule is agreed, stop and ask; do not guess.
3. **Check for duplicates:** `list_products {q}` and `inventory_levels {sku}`. Update an existing draft rather than create a second one.
4. **Dry-run:** `draft_product_create` with title, handle, images (first = thumbnail), options, variants (sku + prices), category_ids, tag_ids, sales_channel_ids. Read the `warnings`.
5. **Confirm:** call again with `confirm=true`. The tool reads the product back and FAILS LOUD unless `status=draft`.
6. **Log:** record product id, sku and image URLs in a run log (CSV is fine).
7. **Hand off:** a human reviews the draft in Medusa Admin and publishes. This plugin refuses status changes.

## Rules
- v2 product create needs at least one option and one variant *(verified: Admin API > Create Product)*.
- Link the right sales channel at create time, or the product will be invisible to the storefront's publishable key once published.
- Prefer one product per run when starting out (1-item pilot), then batch.
- Image *source* quality is your call; keep originals for close-ups and only use processed cutouts where they help.
