---
name: medusa-cart-taxes
description: >-
  Use when cart tax lines are missing or stale, or when deciding when a storefront must call the Calculate Cart Taxes route.
---
# medusa-cart-taxes

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Items marked *(verified)* were checked against docs.medusajs.com on 2026-10-15; items marked *(per Medusa Cloud Assistant, not verified in docs)* came from a Medusa Cloud Assistant chat and must be re-checked before use. Re-check everything after Medusa upgrades.

## Facts
- `POST /store/carts/{id}/taxes` (Calculate Cart Taxes) forces a fresh tax calculation, even when the region's `automatic_taxes` is disabled, and calls a third-party tax provider if you use one *(verified: https://docs.medusajs.com/resources/commerce-modules/cart/tax-lines)*.
- With `automatic_taxes` **enabled**: adding an item or shipping method calculates its tax lines; **changing region or locale recalculates all**; changing quantity reuses existing rates; removing an item doesn't recalc others *(verified, same page)*.
- With `automatic_taxes` **disabled**: tax lines are only calculated via the Calculate Cart Taxes route *(verified)*.
- Tax lines need a shipping-address **country**; rates come from that country, not the region's list. Single-country regions prefill it *(verified)*.
- Updating address fields (other than what triggers region change) is **not** listed as a recalculation trigger, so the safe pattern is: **update address → call `/store/carts/{id}/taxes`** *(the docs' trigger table supports this; "address doesn't auto-recalc" is per Medusa Cloud Assistant)*.
- The route persists tax lines via `upsertTaxLinesWorkflow`, takes **no request body**, and doesn't expose `force_tax_calculation` *(per Medusa Cloud Assistant, not verified in docs)*.
- `refreshCartItemsWorkflow` refreshes prices, promotions, taxes and payment collection *(per Medusa Cloud Assistant, not verified in docs)*.
- Works for guest and customer carts with a publishable API key. Known issue #16601: an invalid/expired customer JWT is treated as a guest on routes that allow unauthenticated access, see [references/known-issues.md](../../references/known-issues.md).
