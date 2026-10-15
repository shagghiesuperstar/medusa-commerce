// Bundled mock Medusa v2 backend + mock docs. Binds 127.0.0.1 only. Dummy keys only.
import http from "node:http";
const PORT = Number(process.env.MOCK_PORT || 19000), DOCS = Number(process.env.MOCK_DOCS_PORT || 19050);
const SK = process.env.MOCK_SECRET || "sk_test_mock", PK = process.env.MOCK_PK || "pk_test_mock";
const db = {
  products: [
    { id: "prod_1", title: "Sample Tee", handle: "sample-tee", status: "published", thumbnail: null, sales_channels: [{ id: "sc_1" }], categories: [], tags: [{ id: "ptag_1", value: "new" }],
      variants: [{ id: "variant_1", title: "S", sku: "TEE-S", manage_inventory: true, prices: [{ id: "price_1", amount: 20, currency_code: "usd" }, { id: "price_2", amount: 18, currency_code: "eur" }], options: [] }] },
    { id: "prod_2", title: "Draft Mug", handle: "draft-mug", status: "draft", sales_channels: [], categories: [], tags: [], metadata: {}, variants: [{ id: "variant_2", title: "Default", sku: "MUG-1", prices: [{ id: "price_3", amount: 12, currency_code: "usd" }] }] },
    { id: "prod_3", title: "Zero Stock Draft", handle: "zero-stock", status: "draft", thumbnail: "https://cdn.example.com/z.png", sales_channels: [{ id: "sc_1" }], categories: [], tags: [], variants: [{ id: "variant_3", title: "Default", sku: "ZERO-1", manage_inventory: true, prices: [{ id: "price_4", amount: 9, currency_code: "usd" }] }] },
    { id: "prod_4", title: "Ready Draft", handle: "ready-draft", status: "draft", thumbnail: "https://cdn.example.com/r.png", sales_channels: [{ id: "sc_1" }], categories: [], tags: [], variants: [{ id: "variant_4", title: "Default", sku: "READY-1", manage_inventory: true, prices: [{ id: "price_5", amount: 30, currency_code: "usd" }] }] },
  ],
  inventory: [{ id: "iitem_1", sku: "TEE-S", title: "Sample Tee S", location_levels: [{ location_id: "sloc_1", stocked_quantity: 10, reserved_quantity: 2, available_quantity: 8 }] },
    { id: "iitem_3", sku: "ZERO-1", title: "Zero", location_levels: [{ location_id: "sloc_1", stocked_quantity: 0, reserved_quantity: 0, available_quantity: 0 }] },
    { id: "iitem_4", sku: "READY-1", title: "Ready", location_levels: [{ location_id: "sloc_1", stocked_quantity: 5, reserved_quantity: 0, available_quantity: 5 }] }],
  orders: [{ id: "order_1", display_id: 1, status: "pending", payment_status: "captured", fulfillment_status: "not_fulfilled", total: 20, currency_code: "usd", created_at: "2026-10-01T00:00:00Z", email: "buyer@example.com", shipping_address: { city: "Example" }, items: [], fulfillments: [] }],
  categories: [{ id: "pcat_1", name: "Apparel", handle: "apparel", is_active: true, is_internal: false, parent_category_id: null }],
  tags: [{ id: "ptag_1", value: "new" }], channels: [{ id: "sc_1", name: "Default Sales Channel", is_disabled: false }],
  api_keys: [
    { id: "apk_1", title: "Storefront Key", type: "publishable", redacted: "pk_test_••••abcd", revoked_at: null, sales_channels: [{ id: "sc_1", name: "Default Sales Channel" }] },
    { id: "apk_2", title: "Orphan Key", type: "publishable", redacted: "pk_test_••••orph", revoked_at: null, sales_channels: [] },
    { id: "apk_3", title: "Revoked Key", type: "publishable", redacted: "pk_test_••••rev", revoked_at: "2026-01-01T00:00:00Z", sales_channels: [] },
    { id: "apk_sec", title: "Secret", type: "secret", redacted: "sk_test_••••sec", revoked_at: null, sales_channels: [] },
  ],
};
const pick = (o, fields) => { if (!fields) return o; const keep = fields.split(",").filter((f) => !f.startsWith("*") && !f.includes(".")).concat(fields.split(",").filter((f) => f.startsWith("*")).map((f) => f.slice(1).split(".")[0])).concat(fields.split(",").filter((f) => f.includes(".") && !f.startsWith("*")).map((f) => f.split(".")[0])); const r = { id: o.id }; for (const k of keep) if (k in o) r[k] = o[k]; return r; };
const send = (res, s, b) => res.writeHead(s, { "Content-Type": "application/json" }).end(JSON.stringify(b));
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); const p = u.pathname; const f = u.searchParams.get("fields");
  let body = ""; for await (const c of req) body += c; const j = body ? JSON.parse(body) : {};
  if (p === "/health") return res.writeHead(200).end("OK");
  if (p.startsWith("/store/")) {
    if (req.headers["x-publishable-api-key"] !== PK) return send(res, 400, { type: "not_allowed", message: "Publishable API key required in the request header: x-publishable-api-key." });
    if (p === "/store/_obs_error") return send(res, 503, { type: "unexpected_state", message: "OBS_STORE_ERROR_VERBATIM: simulated store failure" });
    const vis = db.products.filter((x) => x.status === "published" && x.sales_channels.some((s) => s.id === "sc_1"));
    return send(res, 200, { products: vis.map((x) => pick(x, f)), count: vis.length, offset: 0, limit: 20 });
  }
  if (!p.startsWith("/admin/")) return send(res, 404, { message: "not found" });
  if (req.headers.authorization !== `Basic ${SK}`) return send(res, 401, { type: "unauthorized", message: "Unauthorized" });
  let m;
  const list = (k, arr) => send(res, 200, { [k]: arr.map((x) => pick(x, f)), count: arr.length, offset: 0, limit: 20 });
  if (p === "/admin/products" && req.method === "GET") { const st = u.searchParams.get("status[]"); const q = u.searchParams.get("q"); return list("products", db.products.filter((x) => (!st || x.status === st) && (!q || x.title.toLowerCase().includes(q.toLowerCase())))); }
  if (p === "/admin/products" && req.method === "POST") { if (!j.options?.length || !j.variants?.length) return send(res, 400, { message: "options and variants required" }); const prod = { id: `prod_${db.products.length + 1}`, ...j, sales_channels: j.sales_channels || [], categories: j.categories || [], tags: j.tags || [], variants: j.variants.map((v, i) => ({ id: `variant_n${i}`, ...v })) }; db.products.push(prod); return send(res, 200, { product: prod }); }
  if ((m = p.match(/^\/admin\/products\/([^/]+)$/))) { const prod = db.products.find((x) => x.id === m[1]); if (!prod) return send(res, 404, { message: `Product with id: ${m[1]} was not found` }); if (req.method === "POST") Object.assign(prod, j); return send(res, 200, { product: pick(prod, req.method === "POST" ? null : f) }); }
  if ((m = p.match(/^\/admin\/products\/([^/]+)\/variants$/))) { const prod = db.products.find((x) => x.id === m[1]); if (!prod) return send(res, 404, { message: "not found" }); return list("variants", prod.variants); }
  if ((m = p.match(/^\/admin\/products\/([^/]+)\/variants\/([^/]+)$/))) { const prod = db.products.find((x) => x.id === m[1]); const v = prod?.variants.find((x) => x.id === m[2]); if (!v) return send(res, 404, { message: "not found" }); if (req.method === "POST") { if (j.prices) v.prices = j.prices.map((x, i) => ({ id: x.id || `price_new${i}`, ...x })); return send(res, 200, { product: prod }); } return send(res, 200, { variant: v }); }
  if (p === "/admin/inventory-items") { const sku = u.searchParams.get("sku"); return list("inventory_items", db.inventory.filter((x) => !sku || x.sku === sku)); }
  if ((m = p.match(/^\/admin\/inventory-items\/([^/]+)$/))) { const it = db.inventory.find((x) => x.id === m[1]); return it ? send(res, 200, { inventory_item: it }) : send(res, 404, { message: "not found" }); }
  if ((m = p.match(/^\/admin\/inventory-items\/([^/]+)\/location-levels\/([^/]+)$/)) && req.method === "POST") { const it = db.inventory.find((x) => x.id === m[1]); const l = it?.location_levels.find((x) => x.location_id === m[2]); if (!l) return send(res, 404, { message: "not found" }); l.stocked_quantity = j.stocked_quantity; l.available_quantity = l.stocked_quantity - l.reserved_quantity; return send(res, 200, { inventory_item: it }); }
  if (p === "/admin/orders") return list("orders", db.orders);
  if ((m = p.match(/^\/admin\/orders\/([^/]+)$/))) { const o = db.orders.find((x) => x.id === m[1]); return o ? send(res, 200, { order: pick(o, f) }) : send(res, 404, { message: "not found" }); }
  if (p === "/admin/product-categories") return list("product_categories", db.categories);
  if (p === "/admin/product-tags") return list("product_tags", db.tags);
  if (p === "/admin/sales-channels") return list("sales_channels", db.channels);
  if (p === "/admin/api-keys") {
    const type = u.searchParams.get("type");
    let arr = db.api_keys;
    if (type) arr = arr.filter((k) => k.type === type);
    return list("api_keys", arr);
  }
  return send(res, 404, { message: "not found" });
}).listen(PORT, "127.0.0.1", () => console.error(`mock medusa on 127.0.0.1:${PORT}`));
// A backend that resets every connection (simulates blocked egress / TLS reset).
const RESET = Number(process.env.MOCK_RESET_PORT || 19098);
import("node:net").then(({ default: net }) => net.createServer((sock) => sock.destroy()).listen(RESET, "127.0.0.1", () => console.error(`mock reset on 127.0.0.1:${RESET}`)));
http.createServer((req, res) => {
  if (req.url === "/llms.txt") return res.writeHead(200).end("# Medusa\n- [Admin API Reference](http://127.0.0.1:" + DOCS + "/api/admin): authentication with secret API keys, products, inventory\n- [Product Module](http://127.0.0.1:" + DOCS + "/resources/commerce-modules/product): products, variants, draft status\n- [Sales Channel Module](http://127.0.0.1:" + DOCS + "/resources/commerce-modules/sales-channel): publishable API keys scope store requests\n");
  if (req.url === "/api/admin") return res.writeHead(200).end("# Admin API\n## Authentication\nPass the API key token in the Authorization Basic header.\n## Products\nstatus can be draft or published.\n");
  res.writeHead(404).end();
}).listen(DOCS, "127.0.0.1", () => console.error(`mock docs on 127.0.0.1:${DOCS}`));
