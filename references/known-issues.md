# Known Medusa issues (reference)

Each issue number below was confirmed to exist on github.com/medusajs/medusa on 2026-10-15 (title shown is GitHub's). Status (open/fixed) and affected versions were **not** checked; re-check before relying on a workaround. Workarounds are *per Medusa Cloud Assistant, not verified in docs*.

| Issue | GitHub title (short) | Impact / workaround |
|---|---|---|
| [#16601](https://github.com/medusajs/medusa/issues/16601) | Invalid / expired JWT treated as unauthenticated when `allowUnauthenticated: true` | Logged-in shopper silently becomes a guest on store routes (e.g. cart taxes). Refresh the token client-side. |
| [#16822](https://github.com/medusajs/medusa/issues/16822) | Customer-group price lists never apply (`customer_group_id` vs `customer.groups.id`) | Workaround: write price-list rules with the `customer.groups.id` attribute. |
| [#15737](https://github.com/medusajs/medusa/issues/15737) | Creating a cart with items ignores customer-group price lists | Create the cart empty (with customer), then add items. |
| [#16502](https://github.com/medusajs/medusa/issues/16502) | Bundle (shared inventory item) oversells | Validate summed quantity in `completeCartWorkflow.hooks.validate`. |
| [#16825](https://github.com/medusajs/medusa/issues/16825) | Orphaned order on concurrent reservation failure in `completeCartWorkflow` | Reconcile orders vs reservations on a schedule. |
| [#16995](https://github.com/medusajs/medusa/issues/16995) | Multi-key deadlocks / key leakage in `RedisLockingProvider` | Lock one key per step, keep consistent key order, set timeouts. |
| [#16338](https://github.com/medusajs/medusa/issues/16338) | Admin "Create Fulfillment" ignores reservation location | Multi-location stores: pick the location explicitly; audit levels. |
| [#16012](https://github.com/medusajs/medusa/issues/16012) | Check-then-act races in payment capture/refund and promotion budgets | Promotion budgets can be exceeded under load; monitor usage. |

No issue numbers from the source chat were dropped: all eight exist.
