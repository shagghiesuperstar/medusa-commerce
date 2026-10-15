---
name: catalog-hygiene
description: >-
  Use for catalog audits: categories, tags, handles, sales-channel links, missing images/prices, drafts piling up, and storefront visibility. Read-only first; fixes go through draft-only, dry-run tools.
---
# catalog-hygiene

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Audit (read-only)
1. `list_categories`, `list_tags`: look for near-duplicates (case, plural, spacing) and internal or inactive categories still in use.
2. `list_products` with `fields` such as `id,title,handle,status,thumbnail,*sales_channels,*categories,variants.sku`, paginated with limit/offset *(verified: Admin API > Select Fields, Pagination)*.
3. Flag products with no thumbnail, no category, no sales channel, variants without SKU or price, or duplicate handles/SKUs.
4. Compare `list_products {status:"published"}` with `store_products`. A published product missing from the store is usually not linked to the publishable key's sales channel, or has no price in the region.
5. Report a table. Change nothing during the audit.

## Fixing
- Drafts: `draft_product_update` (dry-run first).
- Published products: change them in Medusa Admin, or extend the plugin deliberately with a new skill and test (compound-learnings). This plugin does not edit live products.
- Metadata merges at the top level, but **nested objects are replaced** and an empty string deletes a key *(verified: Admin API > Manage Metadata)*.
- Keep any list duplicated between backend and storefront (for example a shipping-restriction list) byte-identical, and check it with a hash in CI. *UNVERIFIED (not in official docs): team practice.*
