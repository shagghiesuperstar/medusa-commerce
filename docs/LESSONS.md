# Lessons (generalized)

Generic lessons gathered from real Medusa v2 operations, scrubbed of all names, domains, and data. Each one cites the official docs or is marked UNVERIFIED.

### 2026-10-15: Secret key vs publishable key
- Symptom: 401 on /admin, or 400 on /store about a missing key.
- Root cause: wrong key type, or a v1-style header.
- Fix / rule: admin routes take a secret API key in `Authorization: Basic <token>`; store routes take `x-publishable-api-key`.
- Checked against: https://docs.medusajs.com/api/admin
- Encoded in: skills/getting-started/SKILL.md
- Regression: test/smoke.mjs "401 error names the key type, never the key"

### 2026-10-15: Images go to DRAFT, never auto-publish
- Symptom: automated pipelines published half-finished products.
- Root cause: create calls defaulted to or set a published status.
- Fix / rule: create with status=draft, read back to verify, and leave publishing to a human in Admin.
- Checked against: https://docs.medusajs.com/api/admin
- Encoded in: skills/draft-product-pipeline/SKILL.md
- Regression: test/smoke.mjs "LESSON images go to DRAFT"

### 2026-10-15: v2 product create needs options and variants
- Symptom: 400 on product create.
- Root cause: v2 requires at least one option and one variant.
- Fix / rule: always send a Default option and variant at minimum.
- Checked against: https://docs.medusajs.com/api/admin
- Encoded in: skills/draft-product-pipeline/SKILL.md
- Regression: test/smoke.mjs "LESSON v2 needs options + variants"

### 2026-10-15: Published but invisible on the storefront
- Symptom: a product is published in Admin but missing from the store.
- Root cause: not linked to the sales channel that the publishable key is scoped to.
- Fix / rule: set sales channels at create time; compare list_products with store_products.
- Checked against: https://docs.medusajs.com/api/store
- Encoded in: skills/catalog-hygiene/SKILL.md
- Regression: test/smoke.mjs "LESSON warns when no sales channel"

### 2026-10-15: Storefront fetches need the publishable key
- Symptom: random 4xx on /store routes from custom storefront code.
- Root cause: raw fetch() calls skipped the publishable key header that the SDK adds.
- Fix / rule: use the JS SDK's client fetch (configured with publishableKey) for /store routes.
- Checked against: https://docs.medusajs.com/resources/js-sdk
- Encoded in: skills/getting-started/SKILL.md
- Regression: test/smoke.mjs "store_products without publishable key fails loud"

### 2026-10-15: Nested metadata is replaced, not merged
- Symptom: sibling keys vanished after a metadata update.
- Root cause: Medusa merges top-level metadata but replaces nested objects.
- Fix / rule: send the full nested object; an empty string deletes a key.
- Checked against: https://docs.medusajs.com/api/admin
- Encoded in: skills/catalog-hygiene/SKILL.md
- Regression: test/smoke.mjs "draft_product_update dry-run + nested metadata warning"

### 2026-10-15: One source of truth per field; pilot one SKU
- Symptom: stock and price drift between the external inventory system and Medusa.
- Root cause: two-way sync of the same field, and batch runs before a pilot.
- Fix / rule: write down which system owns qty vs price, and pilot one SKU end to end before batching.
- Checked against: UNVERIFIED (not in official docs): operating practice
- Encoded in: skills/inventory-sync-tips/SKILL.md
- Regression: manual

### 2026-10-15: Don't drop other prices when updating one
- Symptom: other currencies disappeared after a price edit.
- Root cause: a partial prices array was sent.
- Fix / rule: send the full price list with existing price ids, changing only the target currency.
- Checked against: UNVERIFIED (not in official docs): replace-vs-merge semantics for variant prices are not stated explicitly, so the tool sends the full list either way
- Encoded in: server variant_price_update
- Regression: test/smoke.mjs "LESSON price update does not drop other currencies"

### 2026-10-15: Keep PII out of the chat by default
- Symptom: order lookups dumped customer emails and addresses into chat logs.
- Root cause: full order objects were returned.
- Fix / rule: use minimal `fields` by default, with customer data only on explicit opt-in.
- Checked against: https://docs.medusajs.com/api/admin (Select Fields)
- Encoded in: server list_orders/get_order
- Regression: test/smoke.mjs "LESSON PII-minimal"

### 2026-10-15: Builds fail where local tests pass
- Symptom: the backend builds locally but fails on the hosting build.
- Root cause: the test transpiler strips types without type-checking, and `medusa build` type-checks; config was cut from an old base.
- Fix / rule: run the real `medusa build` (or tsc) in CI before deploy; diff medusa-config against the current base.
- Checked against: UNVERIFIED (not in official docs)
- Encoded in: README Recommended architecture
- Regression: manual
