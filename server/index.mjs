#!/usr/bin/env node
// Medusa Commerce MCP server for Grok Bot. Zero dependencies (Node >= 18).
// Transports: stdio (default) or Streamable HTTP JSON (MCP_TRANSPORT=http, MCP_PORT, MCP_AUTH_TOKEN).
// Principles: docs-first (medusa_docs), thin tools, read-only by default, writes dry-run unless confirm=true,
// products are only ever created/kept as DRAFT (never auto-publish), fail loud, never echo secrets.
import http from "node:http";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const VERSION = "1.5.0";
const env = process.env;
const BASE = (env.MEDUSA_BACKEND_URL || "").replace(/\/+$/, "");
const ADMIN_KEY = env.MEDUSA_ADMIN_API_KEY || "";
const PUB_KEY = env.MEDUSA_PUBLISHABLE_KEY || "";
const ALLOW_PUBLISH = /^(1|true|yes)$/i.test(env.MEDUSA_ALLOW_PUBLISH || "");
const TIMEOUT = Number(env.MEDUSA_TIMEOUT_MS || 15000);
const EVENTS_WEBHOOK_URL = env.MEDUSA_EVENTS_WEBHOOK_URL || "";
const EVENTS_WEBHOOK_SECRET = env.MEDUSA_EVENTS_WEBHOOK_SECRET || "";
const AUDIT_LOG_PATH = env.MEDUSA_AUDIT_LOG || path.join(os.homedir(), ".medusa-plugin", "audit.jsonl");
const ENABLE_REMEDIATION = /^(1|true|yes)$/i.test(env.MEDUSA_ENABLE_REMEDIATION || "");
const APPLY_REMEDIATION = /^(1|true|yes)$/i.test(env.MEDUSA_REMEDIATION_APPLY || "");
const REMEDIATION_ALLOWLIST = (env.MEDUSA_REMEDIATION_ALLOWLIST || "publishable_key_missing_sales_channel").split(",").map((s) => s.trim()).filter(Boolean);
const RATE_BUDGET_PER_MIN = Math.max(1, Number(env.MEDUSA_RATE_BUDGET_PER_MIN || 60));
const AUDIT_ACTOR = env.MEDUSA_AUDIT_ACTOR || "mcp";
const DOCS_BASE = (env.MEDUSA_DOCS_BASE || "https://docs.medusajs.com/").replace(/\/?$/, "/");
const DOCS_INDEX = env.MEDUSA_DOCS_INDEX || `${DOCS_BASE}llms.txt`;

// Every endpoint this server calls, with the official reference it was verified against (Golden Rule).
const API = "https://docs.medusajs.com/api/admin";
const DOC = {
  auth: `${API}#authentication`,
  health: "https://docs.medusajs.com/learn/deployment (\"<APP_URL>/health returns OK\")",
  products: `${API}#products`, variants: `${API}#products_getproductsidvariants`,
  inventory: `${API}#inventory-items`, orders: `${API}#orders`,
  categories: `${API}#product-categories`, tags: `${API}#product-tags`,
  sales_channels: `${API}#sales-channels`, store_products: "https://docs.medusajs.com/api/store#products",
  publishable: "https://docs.medusajs.com/api/store#publishable-api-key",
  api_keys: `${API}#api-keys`,
};

function need() {
  if (!BASE) throw new Error("MEDUSA_BACKEND_URL is not set (e.g. https://<your-backend> or http://localhost:9000)");
}
function needAdmin() {
  need();
  if (!ADMIN_KEY) throw new Error("MEDUSA_ADMIN_API_KEY is not set. Create a secret API key in Medusa Admin (Settings > Secret API Keys). See " + DOC.auth);
}
const scrub = (s) => { let t = String(s); for (const k of [ADMIN_KEY, PUB_KEY]) if (k) t = t.split(k).join("[REDACTED]"); return t; };

const RING_MAX = 200;
const obsRing = [];
function obsSurface(p, { store = false, docs = false } = {}) {
  if (docs) return "docs";
  const pathOnly = String(p).split("?")[0];
  if (pathOnly === "/health" || pathOnly.startsWith("/health/")) return "health";
  if (store || pathOnly.startsWith("/store")) return "store";
  if (pathOnly.startsWith("/admin")) return "admin";
  return "admin";
}
function obsSafePath(p) {
  const s = String(p);
  const q = s.indexOf("?");
  if (q < 0) return s;
  const pathname = s.slice(0, q);
  const params = new URLSearchParams(s.slice(q + 1));
  const out = new URLSearchParams();
  for (const [k, v] of params) {
    if (/key|token|secret|password|authorization|auth/i.test(k)) continue;
    let val = String(v);
    for (const secret of [ADMIN_KEY, PUB_KEY]) if (secret && val.includes(secret)) val = "[REDACTED]";
    out.set(k, val);
  }
  const qs = out.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
function obsRecord({ surface, path: p, status, ms, error }) {
  obsRing.push({ surface, path: obsSafePath(p), status: status ?? 0, ms: Math.round(ms), timestamp: new Date().toISOString(), ...(error ? { error: scrub(String(error)) } : {}) });
  while (obsRing.length > RING_MAX) obsRing.shift();
}
function obsStats(surface) {
  const rows = obsRing.filter((r) => !surface || r.surface === surface);
  const ms = rows.map((r) => r.ms).filter((n) => typeof n === "number").sort((a, b) => a - b);
  const latest = rows.length ? rows[rows.length - 1].ms : null;
  const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  const p95 = ms.length ? ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)] : null;
  return { samples: rows.length, latest_ms: latest, avg_ms: avg, p95_ms: p95 };
}
function obsRecentErrors(limit = 20) {
  return obsRing.filter((r) => r.error).slice(-limit).reverse();
}

// ---- event stream (in-process) ----
const EVENT_MAX = 1000;
let eventSeq = 0;
const eventLog = [];
const sseClients = new Set();
const healthPrev = { health: null, admin: null, store: null };
function emitEvent(type, data = {}) {
  const ev = { id: ++eventSeq, type, timestamp: new Date().toISOString(), ...data };
  eventLog.push(ev);
  while (eventLog.length > EVENT_MAX) eventLog.shift();
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) { try { res.write(line); } catch { sseClients.delete(res); } }
  if (EVENTS_WEBHOOK_URL) queueMicrotask(() => deliverWebhook(ev).catch((e) => {
    const fail = { id: ++eventSeq, type: "webhook_delivery_failed", timestamp: new Date().toISOString(), error: scrub(e.message || String(e)), event_id: ev.id };
    eventLog.push(fail);
    while (eventLog.length > EVENT_MAX) eventLog.shift();
  }));
  return ev;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function deliverWebhook(ev) {
  if (!EVENTS_WEBHOOK_URL) return;
  const body = JSON.stringify(ev);
  const headers = { "Content-Type": "application/json", "User-Agent": `medusa-commerce-plugin/${VERSION}` };
  if (EVENTS_WEBHOOK_SECRET) headers["X-Medusa-Plugin-Signature"] = crypto.createHmac("sha256", EVENTS_WEBHOOK_SECRET).update(body).digest("hex");
  let lastErr = "unknown";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(EVENTS_WEBHOOK_URL, { method: "POST", headers, body, signal: ac.signal });
      clearTimeout(t);
      if (res.ok) return { ok: true, status: res.status, attempts: attempt + 1 };
      lastErr = `HTTP ${res.status}`;
    } catch (e) { lastErr = e.name === "AbortError" ? "timeout" : (e.message || String(e)); }
    await sleep(100 * (2 ** attempt) + Math.floor(Math.random() * 75));
  }
  throw new Error(`webhook delivery failed after retries: ${lastErr}`);
}
async function eventsPollSince({ cursor, limit } = {}) {
  const since = Math.max(0, Number(cursor) || 0);
  const n = lim(limit, 50);
  const batch = eventLog.filter((e) => e.id > since).slice(0, n);
  return { cursor: batch.length ? batch[batch.length - 1].id : since, latest_cursor: eventSeq, count: batch.length, events: batch, webhook_configured: !!EVENTS_WEBHOOK_URL };
}
function noteHealthTransition(surface, up, detail = {}) {
  if (!["health", "admin", "store"].includes(surface)) return;
  const prev = healthPrev[surface];
  healthPrev[surface] = up;
  if (prev !== null && prev !== up) emitEvent("health_transition", { surface, from: prev ? "up" : "down", to: up ? "up" : "down", ...detail });
}

// ---- audit trail (append-only JSONL) ----
function redactDeep(v) {
  if (v == null) return v;
  if (typeof v === "string") return scrub(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|password|authorization/i.test(k) && typeof val === "string") o[k] = "[REDACTED]";
      else o[k] = redactDeep(val);
    }
    return o;
  }
  return v;
}
function appendAudit(entry) {
  const dir = path.dirname(AUDIT_LOG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const row = { timestamp: new Date().toISOString(), actor: AUDIT_ACTOR, ...entry, args: redactDeep(entry.args || {}) };
  if (row.before !== undefined) row.before = redactDeep(row.before);
  if (row.after !== undefined) row.after = redactDeep(row.after);
  if (row.result !== undefined) row.result = redactDeep(row.result);
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(row) + "\n", "utf8");
  emitEvent("audit", { tool: row.tool, dry_run: !!row.dry_run });
  return row;
}
async function auditLogQuery({ limit, tool, since } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter(Boolean); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  let rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (tool) rows = rows.filter((r) => r.tool === tool);
  if (since) rows = rows.filter((r) => String(r.timestamp) >= String(since));
  const n = lim(limit, 50);
  rows = rows.slice(-n).reverse();
  return { path: AUDIT_LOG_PATH, count: rows.length, entries: rows };
}

// ---- rate-limit awareness ----
const rateWindows = { admin: [], store: [], health: [], docs: [] };
const rateHeaders = { admin: {}, store: {}, health: {}, docs: {} };
function ratePrune(surface, now = Date.now()) {
  rateWindows[surface] = (rateWindows[surface] || []).filter((t) => now - t < 60_000);
  return rateWindows[surface];
}
function rateTrack(surface) {
  const now = Date.now();
  const w = ratePrune(surface, now);
  w.push(now);
  return { count_last_min: w.length, budget: RATE_BUDGET_PER_MIN, near_limit: w.length >= RATE_BUDGET_PER_MIN * 0.8 };
}
async function rateWaitIfNeeded(surface) {
  for (let i = 0; i < 20; i++) {
    const w = ratePrune(surface);
    if (w.length < RATE_BUDGET_PER_MIN) return;
    const oldest = w[0];
    const wait = Math.min(1000, Math.max(50, 60_000 - (Date.now() - oldest) + Math.floor(Math.random() * 40)));
    await sleep(wait);
  }
}
function parseRateHeaders(res, surface) {
  const h = {};
  const ra = res.headers.get("retry-after"); if (ra) h.retry_after = ra;
  for (const name of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset"]) {
    const v = res.headers.get(name); if (v != null) h[name] = v;
  }
  if (Object.keys(h).length) rateHeaders[surface] = { ...rateHeaders[surface], ...h, updated_at: new Date().toISOString() };
  return h;
}
function throttleHints() {
  const now = Date.now();
  const out = {};
  for (const s of Object.keys(rateWindows)) {
    const c = ratePrune(s, now).length;
    if (c >= RATE_BUDGET_PER_MIN * 0.8) out[s] = { count_last_min: c, budget: RATE_BUDGET_PER_MIN, near_limit: true, ...(rateHeaders[s] || {}) };
  }
  return Object.keys(out).length ? out : undefined;
}
function withThrottle(result) {
  const throttle = throttleHints();
  if (!throttle) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) return { ...result, throttle };
  return { value: result, throttle };
}
async function rateLimitStatus() {
  const now = Date.now();
  const surfaces = {};
  for (const s of ["admin", "store", "health", "docs"]) {
    const c = ratePrune(s, now).length;
    surfaces[s] = { count_last_min: c, budget: RATE_BUDGET_PER_MIN, near_limit: c >= RATE_BUDGET_PER_MIN * 0.8, headers: rateHeaders[s] || {} };
  }
  return { budget_per_min: RATE_BUDGET_PER_MIN, surfaces };
}

// ---- remediation hooks (OFF by default) ----
const remediationRuns = [];
async function hookPublishableKeyMissingSalesChannel({ apply }) {
  needAdmin();
  const keys = (await req("/admin/api-keys?type=publishable&fields=id,title,redacted,revoked_at,*sales_channels")).api_keys || [];
  const channels = (await req("/admin/sales-channels?fields=id,name")).sales_channels || [];
  const orphans = keys.filter((k) => !k.revoked_at && !(k.sales_channels || []).length);
  const results = [];
  for (const k of orphans) {
    if (channels.length !== 1) {
      results.push({ key_title: k.title, status: "report", message: `NO SALES CHANNEL: store has ${channels.length} sales channel(s); attach only when exactly one exists` });
      emitEvent("key_warning", { key_title: k.title, warning: "NO SALES CHANNEL", channels: channels.length });
      continue;
    }
    const sc = channels[0];
    const body = { add: [sc.id] };
    const pathSc = `/admin/api-keys/${encodeURIComponent(k.id)}/sales-channels`;
    if (!apply) {
      results.push({ key_title: k.title, status: "dry_run", would: `POST ${pathSc}`, body: { add: ["[sales_channel_id]"] }, channel_name: sc.name });
    } else {
      const before = { title: k.title, sales_channels: (k.sales_channels || []).map((c) => c.name || c.id) };
      await req(pathSc, { method: "POST", body });
      const afterKey = (await req(`/admin/api-keys?type=publishable&fields=id,title,*sales_channels`)).api_keys?.find((x) => x.id === k.id);
      const after = { title: k.title, sales_channels: (afterKey?.sales_channels || []).map((c) => c.name || c.id) };
      results.push({ key_title: k.title, status: "applied", channel_name: sc.name });
      appendAudit({ tool: "remediation:publishable_key_missing_sales_channel", args: { key_title: k.title }, before, after, result: { attached: sc.name }, dry_run: false });
    }
  }
  if (!orphans.length) results.push({ status: "noop", message: "no publishable keys missing a sales channel" });
  return results;
}
const REMEDIATION_HOOKS = {
  publishable_key_missing_sales_channel: {
    description: "Attach the store's sole sales channel to publishable keys that have none (only when exactly one sales channel exists). Verified: POST /admin/api-keys/{id}/sales-channels.",
    run: hookPublishableKeyMissingSalesChannel,
  },
};
async function runRemediationHooks({ reason } = {}) {
  if (!ENABLE_REMEDIATION) return { enabled: false, apply: false, ran: [], note: "MEDUSA_ENABLE_REMEDIATION is not set; remediation is OFF" };
  const apply = APPLY_REMEDIATION;
  const ran = [];
  for (const id of REMEDIATION_ALLOWLIST) {
    const hook = REMEDIATION_HOOKS[id];
    if (!hook) { ran.push({ hook: id, status: "unknown_hook" }); continue; }
    const results = await hook.run({ apply });
    const entry = { hook: id, at: new Date().toISOString(), apply, reason: reason || null, results };
    remediationRuns.push(entry);
    while (remediationRuns.length > 50) remediationRuns.shift();
    emitEvent("remediation", { hook: id, apply, results_count: results.length });
    if (!apply) appendAudit({ tool: `remediation:${id}`, args: { reason }, result: results, dry_run: true });
    ran.push(entry);
  }
  return { enabled: true, apply, ran };
}
async function remediationStatus({ run } = {}) {
  const hooks = Object.entries(REMEDIATION_HOOKS).map(([id, h]) => ({
    id,
    description: h.description,
    enabled: ENABLE_REMEDIATION && REMEDIATION_ALLOWLIST.includes(id),
    allowlisted: REMEDIATION_ALLOWLIST.includes(id),
    last_run: [...remediationRuns].reverse().find((r) => r.hook === id) || null,
  }));
  const base = { enabled: ENABLE_REMEDIATION, apply: APPLY_REMEDIATION, allowlist: REMEDIATION_ALLOWLIST, hooks };
  if (run) {
    if (!ENABLE_REMEDIATION) return { ...base, ran: [], note: "Refusing to run: set MEDUSA_ENABLE_REMEDIATION=true (still dry-run unless MEDUSA_REMEDIATION_APPLY=true)" };
    const out = await runRemediationHooks({ reason: "remediation_status:run" });
    return { ...base, ...out };
  }
  return base;
}


async function req(path, { method = "GET", body, admin = true, store = false, raw = false, _retried = 0 } = {}) {
  need();
  const headers = { Accept: "application/json" };
  // v2 secret API key: "Authorization: Basic <token>" (raw token accepted; base64 kept for back-compat) - see DOC.auth
  if (admin) { needAdmin(); headers.Authorization = `Basic ${ADMIN_KEY}`; }
  if (store) { if (!PUB_KEY) throw new Error("MEDUSA_PUBLISHABLE_KEY is not set; /store routes need the x-publishable-api-key header. See " + DOC.publishable); headers["x-publishable-api-key"] = PUB_KEY; }
  if (body) headers["Content-Type"] = "application/json";
  const surface = obsSurface(path, { store });
  await rateWaitIfNeeded(surface);
  rateTrack(surface);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT); const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
    status = res.status;
    parseRateHeaders(res, surface);
    // Automatic backoff on 429/503 with jitter (retry once or twice).
    if ((res.status === 429 || res.status === 503) && _retried < 2 && method === "GET") {
      const ra = res.headers.get("retry-after");
      let waitMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : 200 * (2 ** _retried);
      waitMs = Math.min(5000, waitMs + Math.floor(Math.random() * 100));
      clearTimeout(t);
      await sleep(waitMs);
      return req(path, { method, body, admin, store, raw, _retried: _retried + 1 });
    }
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 500); }
    const ms = performance.now() - t0;
    const out = { status: res.status, ok: res.ok, data, latency_ms: Math.round(ms) };
    if (raw) {
      if (!res.ok) {
        const msg = typeof data === "string" ? data : data?.message || JSON.stringify(data).slice(0, 300);
        const err = scrub(`${method} ${path} -> HTTP ${status}: ${msg}`);
        obsRecord({ surface, path, status, ms, error: err });
        emitEvent("error", { surface, path: obsSafePath(path), status, error: err });
      } else obsRecord({ surface, path, status, ms });
      return out;
    }
    if (!res.ok) {
      const hint = res.status === 401 ? " (401: wrong, revoked, or wrong-type key; admin routes need a SECRET key, store routes a PUBLISHABLE key)" : res.status === 404 ? " (404: wrong id or route)" : "";
      const msg = scrub(`${method} ${path} -> HTTP ${res.status}${hint}: ${typeof data === "string" ? data : data?.message || JSON.stringify(data).slice(0, 300)}`);
      obsRecord({ surface, path, status, ms, error: msg });
      emitEvent("error", { surface, path: obsSafePath(path), status, error: msg });
      throw new Error(msg);
    }
    obsRecord({ surface, path, status, ms });
    return data;
  } catch (e) {
    const ms = performance.now() - t0;
    if (e.name === "AbortError") {
      const msg = `${method} ${path} -> timeout after ${TIMEOUT}ms`;
      obsRecord({ surface, path, status: status || 0, ms, error: msg });
      emitEvent("error", { surface, path: obsSafePath(path), status: 0, error: msg });
      throw new Error(msg);
    }
    if (e.message?.includes("HTTP")) throw e;
    const code = e.cause?.code || e.message; const nh = /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|CERT|SSL|TLS|socket/i.test(code) ? " (network: backend down, wrong MEDUSA_BACKEND_URL, or this machine's egress/TLS to the backend is blocked; try `curl <url>/health` from the same machine)" : "";
    const msg = scrub(`${method} ${path} -> ${code}${nh}`);
    obsRecord({ surface, path, status: status || 0, ms, error: msg });
    emitEvent("error", { surface, path: obsSafePath(path), status: status || 0, error: msg });
    throw new Error(msg);
  } finally { clearTimeout(t); }
}

const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };
const lim = (n, d = 20) => Math.min(Math.max(Number(n) || d, 1), 100);
const dry = (action, request, extra = {}) => ({ dry_run: true, action, request, ...extra, next: "Review, then call again with confirm=true to execute." });

// ---- tools ----
async function storeHealth() {
  const checks = [];
  if (!BASE) return { verdict: "FAIL", checks: [{ check: "config", ok: false, error: "MEDUSA_BACKEND_URL is not set" }] };
  const h = await req("/health", { admin: false, raw: true }).catch((e) => ({ ok: false, error: e.message }));
  checks.push({ check: "backend /health", ok: !!h.ok, http_status: h.status, latency_ms: h.latency_ms, ...(h.error ? { error: h.error } : {}), doc: DOC.health });
  if (ADMIN_KEY) {
    const a = await req("/admin/products?limit=1&fields=id", { raw: true }).catch((e) => ({ ok: false, error: e.message }));
    checks.push({ check: "admin auth (secret key)", ok: !!a.ok, http_status: a.status, ...(a.ok ? { product_count: a.data?.count } : { error: a.error || `HTTP ${a.status}` }), doc: DOC.auth });
  } else checks.push({ check: "admin auth (secret key)", ok: false, error: "MEDUSA_ADMIN_API_KEY not set" });
  const warnings = [];
  if (PUB_KEY) {
    const s = await req("/store/products?limit=1&fields=id", { admin: false, store: true, raw: true }).catch((e) => ({ ok: false, error: e.message }));
    checks.push({ check: "store API (publishable key)", ok: !!s.ok, http_status: s.status, ...(s.ok ? { visible_products: s.data?.count } : { error: s.error || `HTTP ${s.status}` }), doc: DOC.publishable });
    if (s.ok && s.data?.count === 0) warnings.push("publishable key works but its sales channel exposes 0 products (check product <-> sales channel links)");
  } else warnings.push("MEDUSA_PUBLISHABLE_KEY not set: storefront visibility not checked");
  const failed = checks.filter((c) => !c.ok);
  return { verdict: failed.length ? "FAIL" : warnings.length ? "WARN" : "OK", checks, ...(warnings.length ? { warnings } : {}) };
}

const PRODUCT_FIELDS = "id,title,handle,status,thumbnail,updated_at,*variants,*categories,*tags,*sales_channels";
async function listProducts({ q, status, limit, offset, fields }) {
  const d = await req(`/admin/products${qs({ q, ...(status ? { "status[]": status } : {}), limit: lim(limit), offset, fields: fields || "id,title,handle,status,updated_at,variants.sku" })}`);
  return { count: d.count, offset: d.offset, limit: d.limit, products: d.products, doc: DOC.products };
}
async function getProduct({ id, fields }) { if (!id) throw new Error("id is required"); const d = await req(`/admin/products/${encodeURIComponent(id)}${qs({ fields: fields || PRODUCT_FIELDS })}`); return { product: d.product, doc: DOC.products }; }
async function listVariants({ product_id, limit, offset }) {
  if (!product_id) throw new Error("product_id is required");
  const d = await req(`/admin/products/${encodeURIComponent(product_id)}/variants${qs({ limit: lim(limit, 50), offset, fields: "id,title,sku,manage_inventory,*prices,*options" })}`);
  return { count: d.count, variants: d.variants, doc: DOC.variants };
}
async function inventoryLevels({ sku, q, limit, offset }) {
  const d = await req(`/admin/inventory-items${qs({ sku, q, limit: lim(limit, 50), offset, fields: "id,sku,title,*location_levels" })}`);
  const items = (d.inventory_items || []).map((i) => ({ id: i.id, sku: i.sku, title: i.title, levels: (i.location_levels || []).map((l) => ({ location_id: l.location_id, stocked_quantity: l.stocked_quantity, reserved_quantity: l.reserved_quantity, available_quantity: l.available_quantity })) }));
  return { count: d.count, inventory_items: items, doc: DOC.inventory };
}
// Orders: minimal fields by default so customer PII (email, addresses) never enters the chat unless asked.
const ORDER_FIELDS = "id,display_id,status,payment_status,fulfillment_status,total,currency_code,created_at";
async function listOrders({ status, limit, offset, created_after }) {
  const d = await req(`/admin/orders${qs({ ...(status ? { "status[]": status } : {}), ...(created_after ? { "created_at[$gte]": created_after } : {}), order: "-created_at", limit: lim(limit), offset, fields: ORDER_FIELDS })}`);
  return { count: d.count, orders: d.orders, note: "PII-minimal fields. Use get_order with include_customer=true only when needed.", doc: DOC.orders };
}
async function getOrder({ id, include_customer }) {
  if (!id) throw new Error("id is required");
  const fields = `${ORDER_FIELDS},*items,*fulfillments${include_customer ? ",email,*shipping_address" : ""}`;
  const d = await req(`/admin/orders/${encodeURIComponent(id)}${qs({ fields })}`); return { order: d.order, doc: DOC.orders };
}
async function listCategories({ q, limit }) { const d = await req(`/admin/product-categories${qs({ q, limit: lim(limit, 100), fields: "id,name,handle,is_active,is_internal,parent_category_id" })}`); return { count: d.count, product_categories: d.product_categories, doc: DOC.categories }; }
async function listTags({ q, limit }) { const d = await req(`/admin/product-tags${qs({ q, limit: lim(limit, 100), fields: "id,value" })}`); return { count: d.count, product_tags: d.product_tags, doc: DOC.tags }; }
async function listSalesChannels() { const d = await req(`/admin/sales-channels${qs({ fields: "id,name,is_disabled" })}`); return { count: d.count, sales_channels: d.sales_channels, doc: DOC.sales_channels }; }
async function storeProducts({ q, limit, region_id }) { const d = await req(`/store/products${qs({ q, region_id, limit: lim(limit), fields: "id,title,handle" })}`, { admin: false, store: true }); return { count: d.count, products: d.products, note: "What a shopper sees through this publishable key's sales channel(s).", doc: DOC.store_products }; }

const optIn = (what) => { if (!ALLOW_PUBLISH) throw new Error(`Refusing ${what}: live-store writes are disabled. Set MEDUSA_ALLOW_PUBLISH=true (operator opt-in) AND pass confirm=true. Default is draft-only.`); };
const gate = (what, confirm) => ({ opt_in: ALLOW_PUBLISH ? "MEDUSA_ALLOW_PUBLISH=true" : "MISSING: set MEDUSA_ALLOW_PUBLISH=true before confirm=true works", what });

// ---- writes: draft-only, dry-run unless confirm=true ----
async function draftProductCreate({ title, handle, description, images, options, variants, category_ids, tag_ids, sales_channel_ids, metadata, confirm }) {
  if (!title) throw new Error("title is required");
  if (!Array.isArray(options) || !options.length || !Array.isArray(variants) || !variants.length) throw new Error("v2 requires at least one option and one variant (e.g. options=[{title:'Default',values:['Default']}], variants=[{title:'Default',sku:'...',options:{Default:'Default'},prices:[{amount:1000,currency_code:'usd'}]}]). See " + DOC.products);
  const imgs = (images || []).filter(Boolean);
  const body = { title, status: "draft", ...(handle ? { handle } : {}), ...(description ? { description } : {}),
    ...(imgs.length ? { thumbnail: imgs[0], images: imgs.map((url) => ({ url })) } : {}), options, variants,
    ...(category_ids?.length ? { categories: category_ids.map((id) => ({ id })) } : {}), ...(tag_ids?.length ? { tags: tag_ids.map((id) => ({ id })) } : {}),
    ...(sales_channel_ids?.length ? { sales_channels: sales_channel_ids.map((id) => ({ id })) } : {}), ...(metadata ? { metadata } : {}) };
  const warnings = [];
  if (!sales_channel_ids?.length) warnings.push("no sales_channel_ids: product will not be visible to any publishable key once published");
  if (!imgs.length) warnings.push("no images");
  if (!confirm) return dry("POST /admin/products", body, { warnings, doc: DOC.products });
  const d = await req("/admin/products", { method: "POST", body });
  const back = await req(`/admin/products/${encodeURIComponent(d.product.id)}?fields=id,status,handle,thumbnail`);
  if (back.product.status !== "draft") throw new Error(`FAIL LOUD: created product ${d.product.id} reads back status=${back.product.status}, expected draft. Check it in Medusa Admin now.`);
  return { dry_run: false, created: back.product, warnings, verified: "read back status=draft", doc: DOC.products };
}
async function draftProductUpdate({ id, patch, confirm }) {
  if (!id || !patch || typeof patch !== "object") throw new Error("id and patch are required");
  if ("status" in patch && patch.status !== "draft") throw new Error("Refusing to change status: this plugin never publishes. Publish in Medusa Admin after human review.");
  const cur = (await req(`/admin/products/${encodeURIComponent(id)}?fields=id,title,status,metadata`)).product;
  if (cur.status !== "draft") throw new Error(`Refusing: product ${id} is '${cur.status}', not draft. This tool only edits drafts.`);
  const warnings = [];
  if (patch.metadata && Object.values(patch.metadata).some((v) => v && typeof v === "object" && !Array.isArray(v))) warnings.push("nested metadata objects are REPLACED, not merged; pass the whole nested object");
  if (!confirm) return dry(`POST /admin/products/${id}`, patch, { current: cur, warnings, doc: DOC.products });
  const d = await req(`/admin/products/${encodeURIComponent(id)}`, { method: "POST", body: patch });
  return { dry_run: false, product: { id: d.product.id, status: d.product.status, title: d.product.title }, warnings, doc: DOC.products };
}
async function variantPriceUpdate({ product_id, variant_id, currency_code, amount, confirm }) {
  if (!product_id || !variant_id || !currency_code || amount === undefined) throw new Error("product_id, variant_id, currency_code and amount are required");
  if (!(Number(amount) >= 0)) throw new Error("amount must be a non-negative number in the currency's main unit as stored by your store (check an existing price first)");
  const cc = String(currency_code).toLowerCase();
  const pst = (await req(`/admin/products/${encodeURIComponent(product_id)}?fields=id,status`)).product.status;
  const live = pst !== "draft";
  if (live && confirm) optIn(`price change on ${pst} product ${product_id}`);
  const v = (await req(`/admin/products/${encodeURIComponent(product_id)}/variants/${encodeURIComponent(variant_id)}?fields=id,sku,*prices`)).variant;
  const prices = (v.prices || []).map((p) => ({ id: p.id, amount: p.amount, currency_code: p.currency_code, ...(p.rules && Object.keys(p.rules).length ? { rules: p.rules } : {}) }));
  const hit = prices.find((p) => p.currency_code === cc && !p.rules);
  if (hit) hit.amount = Number(amount); else prices.push({ amount: Number(amount), currency_code: cc });
  // Send the full price list (existing ids kept) so other currencies/rule prices are not dropped.
  const body = { prices };
  if (!confirm) return dry(`POST /admin/products/${product_id}/variants/${variant_id}`, body, { sku: v.sku, product_status: pst, before: v.prices, ...(live ? { live_store_write: gate("price change on a live product") } : {}), doc: DOC.variants });
  const d = await req(`/admin/products/${encodeURIComponent(product_id)}/variants/${encodeURIComponent(variant_id)}`, { method: "POST", body });
  return { dry_run: false, product_id, variant_id, sent: body, product_status: d.product?.status, doc: DOC.variants };
}
async function inventoryLevelUpdate({ inventory_item_id, location_id, stocked_quantity, confirm }) {
  if (!inventory_item_id || !location_id || stocked_quantity === undefined) throw new Error("inventory_item_id, location_id and stocked_quantity are required");
  const n = Number(stocked_quantity); if (!Number.isInteger(n) || n < 0) throw new Error("stocked_quantity must be a non-negative integer");
  if (confirm) optIn("stock change (inventory levels are always live)");
  const item = (await req(`/admin/inventory-items/${encodeURIComponent(inventory_item_id)}?fields=id,sku,*location_levels`)).inventory_item;
  const lvl = (item.location_levels || []).find((l) => l.location_id === location_id);
  if (!lvl) throw new Error(`No level for ${inventory_item_id} at ${location_id}. Create the location level in Medusa Admin first (this tool only updates existing levels).`);
  const warnings = n < (lvl.reserved_quantity || 0) ? [`new stocked_quantity ${n} is below reserved_quantity ${lvl.reserved_quantity}`] : [];
  const path = `/admin/inventory-items/${inventory_item_id}/location-levels/${location_id}`;
  if (!confirm) return dry(`POST ${path}`, { stocked_quantity: n }, { sku: item.sku, before: { stocked_quantity: lvl.stocked_quantity, reserved_quantity: lvl.reserved_quantity }, warnings, live_store_write: gate("stock change"), doc: DOC.inventory });
  await req(`/admin/inventory-items/${encodeURIComponent(inventory_item_id)}/location-levels/${encodeURIComponent(location_id)}`, { method: "POST", body: { stocked_quantity: n } });
  return { dry_run: false, sku: item.sku, location_id, stocked_quantity: n, warnings, doc: DOC.inventory };
}

// ---- opt-in live writes: MEDUSA_ALLOW_PUBLISH=true AND confirm=true ----
async function productPublish({ id, allow_zero_stock, confirm }) {
  if (!id) throw new Error("id is required");
  const p = (await req(`/admin/products/${encodeURIComponent(id)}?fields=id,title,status,thumbnail,*sales_channels,*variants,*variants.prices`)).product;
  if (p.status === "published") return { already_published: true, id, doc: DOC.products };
  const blockers = [], warnings = [];
  if (!(p.sales_channels || []).length) blockers.push("no sales channel: it would be invisible to every publishable key");
  if (!(p.variants || []).length) blockers.push("no variants");
  const noPrice = (p.variants || []).filter((v) => !(v.prices || []).length).map((v) => v.sku || v.id);
  if (noPrice.length) blockers.push(`variants without prices: ${noPrice.join(", ")}`);
  const managed = (p.variants || []).filter((v) => v.manage_inventory !== false);
  // Stock via the verified inventory-items route, matched by SKU. Unknown stock (no SKU / no item) counts as unknown, not zero.
  const stock = [];
  for (const v of managed) {
    if (!v.sku) { stock.push(null); continue; }
    const items = (await req(`/admin/inventory-items${qs({ sku: v.sku, fields: "id,sku,*location_levels" })}`)).inventory_items || [];
    stock.push(items.length ? items.reduce((a, i) => a + (i.location_levels || []).reduce((b, l) => b + (Number(l.stocked_quantity) || 0), 0), 0) : null);
  }
  if (stock.includes(null)) warnings.push("stock unknown for some variants (no SKU or no inventory item)");
  const zero = stock.length > 0 && stock.every((q) => q === 0);
  if (zero && !allow_zero_stock) blockers.push("all inventory-managed variants have zero stock (no publishing zero-stock items; pass allow_zero_stock=true only for deliberate pre-orders)");
  if (!p.thumbnail) warnings.push("no thumbnail");
  const plan = { request: `POST /admin/products/${id}`, body: { status: "published" }, current_status: p.status, sales_channels: (p.sales_channels || []).length, variants: (p.variants || []).length };
  if (!confirm) return { dry_run: true, ...plan, blockers, warnings, live_store_write: gate("publish"), next: blockers.length ? "Fix blockers first." : "Review, then confirm=true (needs MEDUSA_ALLOW_PUBLISH=true).", doc: DOC.products };
  optIn("publish");
  if (blockers.length) throw new Error(`Refusing to publish ${id}: ${blockers.join("; ")}`);
  await req(`/admin/products/${encodeURIComponent(id)}`, { method: "POST", body: { status: "published" } });
  const back = (await req(`/admin/products/${encodeURIComponent(id)}?fields=id,status`)).product;
  if (back.status !== "published") throw new Error(`FAIL LOUD: ${id} reads back status=${back.status} after publish.`);
  return { dry_run: false, id, status: back.status, verified: "read back status=published", warnings, next: "Check it with store_products (shopper view).", doc: DOC.products };
}
async function liveProductUpdate({ id, patch, confirm }) {
  if (!id || !patch || typeof patch !== "object") throw new Error("id and patch are required");
  if ("status" in patch) throw new Error("Use product_publish to change status (it runs the pre-publish checks).");
  const cur = (await req(`/admin/products/${encodeURIComponent(id)}?fields=id,title,status,handle,metadata`)).product;
  const warnings = [];
  if (patch.metadata && Object.values(patch.metadata).some((v) => v && typeof v === "object" && !Array.isArray(v))) warnings.push("nested metadata objects are REPLACED, not merged");
  if ("handle" in patch) warnings.push("changing handle changes the storefront URL");
  if (!confirm) return dry(`POST /admin/products/${id}`, patch, { current: cur, warnings, live_store_write: gate("live product edit"), doc: DOC.products });
  optIn("live product edit");
  const d = await req(`/admin/products/${encodeURIComponent(id)}`, { method: "POST", body: patch });
  return { dry_run: false, product: { id: d.product.id, status: d.product.status, title: d.product.title }, warnings, doc: DOC.products };
}

// ---- golden rule: official docs first ----
let indexCache = null;
async function fetchText(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT); const t0 = performance.now();
  let pathLabel = url; try { pathLabel = new URL(url).pathname + (new URL(url).search || ""); } catch { /* keep */ }
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: "text/markdown, text/plain" } });
    const ms = performance.now() - t0;
    if (!r.ok) {
      const msg = `HTTP ${r.status}`;
      obsRecord({ surface: "docs", path: pathLabel, status: r.status, ms, error: msg });
      throw new Error(msg);
    }
    obsRecord({ surface: "docs", path: pathLabel, status: r.status, ms });
    return await r.text();
  } catch (e) {
    if (!String(e.message || "").startsWith("HTTP")) obsRecord({ surface: "docs", path: pathLabel, status: 0, ms: performance.now() - t0, error: scrub(e.message || String(e)) });
    throw e;
  } finally { clearTimeout(t); }
}
async function medusaDocs({ query, page }) {
  const origin = new URL(DOCS_BASE).origin;
  if (page) {
    const url = new URL(page, DOCS_BASE);
    if (url.origin !== origin) throw new Error(`Refusing: page must be on the official docs origin ${origin}`);
    const text = await fetchText(url.href).catch((e) => { throw new Error(`docs fetch failed (${e.message}) for ${url.href}`); });
    const lines = text.split("\n");
    const hits = query ? lines.map((l, i) => [i, l]).filter(([, l]) => l.toLowerCase().includes(String(query).toLowerCase())).slice(0, 20).map(([i]) => lines.slice(Math.max(0, i - 2), i + 3).join("\n")) : [];
    return { url: url.href, ...(query ? { matches: hits, verdict: hits.length ? "FOUND" : `NOT IN OFFICIAL DOCS (page has no '${query}')` } : { excerpt: text.slice(0, 6000) }) };
  }
  if (!query) throw new Error("query or page is required");
  if (!indexCache) indexCache = await fetchText(DOCS_INDEX).catch((e) => { throw new Error(`docs index fetch failed (${e.message}). Do not proceed from memory; retry or open ${DOCS_BASE} manually.`); });
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scored = indexCache.split("\n").map((l) => [l, words.filter((w) => l.toLowerCase().includes(w)).length]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([l]) => l.trim());
  return { index: DOCS_INDEX, matches: scored, verdict: scored.length ? "FOUND: open the best page with medusa_docs {page}" : "NOT IN OFFICIAL DOCS (no index match). Say so and mark any step UNVERIFIED.",
    tip: "Medusa also hosts official remote MCPs (OAuth, Medusa Cloud account): Docs MCP https://docs.medusajs.com/mcp and read-only Cloud store MCP https://cloud.medusajs.com/mcp." };
}


function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildObsMarkdown(report) {
  const lines = ["# Medusa observability dashboard", "", `Generated: ${report.generated_at}`, ""];
  lines.push("## Surfaces");
  for (const name of ["health", "admin", "store", "docs"]) {
    const s = report.surfaces[name] || {};
    const up = s.up === true ? "UP" : s.up === false ? "DOWN" : "n/a";
    const lat = [];
    if (s.latency_ms != null) lat.push(`live ${s.latency_ms}ms`);
    if (s.latest_ms != null) lat.push(`latest ${s.latest_ms}ms`);
    if (s.avg_ms != null) lat.push(`avg ${s.avg_ms}ms`);
    if (s.p95_ms != null) lat.push(`p95 ${s.p95_ms}ms`);
    lines.push(`- **${name}**: ${up}${s.http_status != null ? ` (HTTP ${s.http_status})` : ""}${lat.length ? " — " + lat.join(", ") : ""}${s.error ? ` — ERROR: ${s.error}` : ""}`);
  }
  lines.push("", "## Publishable API keys");
  if (!(report.publishable_keys || []).length) lines.push("_none returned_");
  else {
    lines.push("| title | redacted | revoked | sales channels | status |");
    lines.push("|---|---|---|---|---|");
    for (const k of report.publishable_keys) {
      const ch = (k.sales_channels || []).length ? k.sales_channels.join(", ") : "—";
      const st = k.warning || (k.revoked ? "revoked" : "ok");
      lines.push(`| ${k.title || "—"} | ${k.redacted || "—"} | ${k.revoked ? "yes" : "no"} | ${ch} | ${st} |`);
    }
  }
  lines.push("", "## Recent errors");
  if (!(report.recent_errors || []).length) lines.push("_none in recorder_");
  else for (const e of report.recent_errors) lines.push(`- \`${e.timestamp}\` [${e.surface}] ${e.path} HTTP ${e.status} (${e.ms}ms): ${e.error}`);
  lines.push("", `_recorder ${report.recorder?.size || 0}/${report.recorder?.max || RING_MAX}_`);
  return lines.join("\n");
}
function buildObsHtml(report) {
  const row = (name, s) => {
    const up = s.up === true ? "up" : s.up === false ? "down" : "na";
    const label = s.up === true ? "UP" : s.up === false ? "DOWN" : "n/a";
    return `<tr><td>${escHtml(name)}</td><td class="${up}">${label}</td><td>${s.http_status ?? "—"}</td><td>${s.latency_ms ?? "—"}</td><td>${s.latest_ms ?? "—"}</td><td>${s.avg_ms ?? "—"}</td><td>${s.p95_ms ?? "—"}</td><td class="err">${escHtml(s.error || "")}</td></tr>`;
  };
  const keyRows = (report.publishable_keys || []).map((k) => {
    const warn = k.warning ? `<span class="warn">${escHtml(k.warning)}</span>` : (k.revoked ? "revoked" : "ok");
    const ch = (k.sales_channels || []).length ? escHtml(k.sales_channels.join(", ")) : "—";
    return `<tr><td>${escHtml(k.title || "—")}</td><td><code>${escHtml(k.redacted || "—")}</code></td><td>${k.revoked ? "yes" : "no"}</td><td>${ch}</td><td>${warn}</td></tr>`;
  }).join("") || `<tr><td colspan="5">none returned</td></tr>`;
  const errRows = (report.recent_errors || []).map((e) =>
    `<tr><td>${escHtml(e.timestamp)}</td><td>${escHtml(e.surface)}</td><td><code>${escHtml(e.path)}</code></td><td>${e.status}</td><td>${e.ms}</td><td class="err">${escHtml(e.error)}</td></tr>`
  ).join("") || `<tr><td colspan="6">none in recorder</td></tr>`;
  const surfRows = ["health", "admin", "store", "docs"].map((n) => row(n, report.surfaces[n] || {})).join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Medusa observability dashboard</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;background:#0b0f14;color:#e6edf3}
header{padding:20px 24px;border-bottom:1px solid #243041;background:#111822}
h1{margin:0 0 4px;font-size:20px}
.meta{color:#8b9bb4}
main{padding:24px;display:grid;gap:24px}
section{background:#121a24;border:1px solid #243041;border-radius:12px;padding:16px 18px}
h2{margin:0 0 12px;font-size:15px;color:#9ecbff}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #1e2a3a;vertical-align:top}
th{color:#8b9bb4;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.up{color:#3dd68c;font-weight:700}.down{color:#ff6b6b;font-weight:700}.na{color:#8b9bb4}
.warn{color:#ffd166;font-weight:700}.err{color:#ff8e8e;white-space:pre-wrap;word-break:break-word}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c6d0db}
footer{padding:0 24px 24px;color:#8b9bb4;font-size:12px}
</style></head><body>
<header><h1>Medusa observability dashboard</h1><div class="meta">Generated ${escHtml(report.generated_at)} · recorder ${report.recorder?.size || 0}/${report.recorder?.max || RING_MAX} · read-only</div></header>
<main>
<section><h2>Surfaces</h2><table><thead><tr><th>Surface</th><th>Status</th><th>HTTP</th><th>Live ms</th><th>Latest</th><th>Avg</th><th>p95</th><th>Error</th></tr></thead><tbody>${surfRows}</tbody></table></section>
<section><h2>Publishable API keys</h2><table><thead><tr><th>Title</th><th>Redacted</th><th>Revoked</th><th>Sales channels</th><th>Status</th></tr></thead><tbody>${keyRows}</tbody></table></section>
<section><h2>Recent errors</h2><table><thead><tr><th>When</th><th>Surface</th><th>Path</th><th>HTTP</th><th>ms</th><th>Message</th></tr></thead><tbody>${errRows}</tbody></table></section>
</main>
<footer>In-plugin read-only dashboard. Keys and auth headers are never recorded.</footer>
</body></html>`;
}
async function observabilityDashboard({ format, write_html } = {}) {
  const generated_at = new Date().toISOString();
  const surfaces = {};
  // Live checks (read-only GETs)
  if (!BASE) {
    surfaces.health = { up: false, error: "MEDUSA_BACKEND_URL is not set", ...obsStats("health") };
    surfaces.admin = { up: false, error: "MEDUSA_BACKEND_URL is not set", ...obsStats("admin") };
    surfaces.store = { up: false, error: "MEDUSA_BACKEND_URL is not set", ...obsStats("store") };
  } else {
    const h = await req("/health", { admin: false, raw: true }).catch((e) => ({ ok: false, error: e.message, status: 0 }));
    surfaces.health = { up: !!h.ok, http_status: h.status, latency_ms: h.latency_ms, ...(h.error ? { error: h.error } : {}), ...obsStats("health") };
    if (ADMIN_KEY) {
      const a = await req("/admin/products?limit=1&fields=id", { raw: true }).catch((e) => ({ ok: false, error: e.message, status: 0 }));
      surfaces.admin = { up: !!a.ok, http_status: a.status, latency_ms: a.latency_ms, ...(a.ok ? {} : { error: a.error || `HTTP ${a.status}` }), ...obsStats("admin") };
    } else surfaces.admin = { up: false, error: "MEDUSA_ADMIN_API_KEY not set", ...obsStats("admin") };
    if (PUB_KEY) {
      const s = await req("/store/products?limit=1&fields=id", { admin: false, store: true, raw: true }).catch((e) => ({ ok: false, error: e.message, status: 0 }));
      surfaces.store = { up: !!s.ok, http_status: s.status, latency_ms: s.latency_ms, ...(s.ok ? {} : { error: s.error || `HTTP ${s.status}` }), ...obsStats("store") };
    } else surfaces.store = { up: false, error: "MEDUSA_PUBLISHABLE_KEY not set", ...obsStats("store") };
  }
  surfaces.docs = { up: obsRing.some((r) => r.surface === "docs" && !r.error) || null, ...obsStats("docs") };
  if (surfaces.docs.samples === 0) { surfaces.docs.up = null; }

  const publishable_keys = [];
  if (BASE && ADMIN_KEY) {
    const kr = await req("/admin/api-keys?type=publishable&fields=id,title,redacted,revoked_at,*sales_channels", { raw: true }).catch((e) => ({ ok: false, error: e.message, data: null }));
    if (kr.ok) {
      for (const k of kr.data?.api_keys || []) {
        const names = (k.sales_channels || []).map((c) => c.name || c.id).filter(Boolean);
        const revoked = !!k.revoked_at;
        const warning = !revoked && names.length === 0 ? "NO SALES CHANNEL" : null;
        publishable_keys.push({ title: k.title, redacted: k.redacted || null, revoked, sales_channels: names, ...(warning ? { warning } : {}) });
      }
    } else {
      publishable_keys.push({ title: "(list failed)", redacted: null, revoked: false, sales_channels: [], warning: scrub(kr.error || "api-keys request failed") });
    }
  }

  const report = {
    generated_at,
    surfaces,
    publishable_keys,
    recent_errors: obsRecentErrors(20),
    recorder: { size: obsRing.length, max: RING_MAX },
    doc: DOC.api_keys,
  };
  noteHealthTransition("health", !!surfaces.health.up, { http_status: surfaces.health.http_status });
  noteHealthTransition("admin", !!surfaces.admin.up, { http_status: surfaces.admin.http_status });
  noteHealthTransition("store", !!surfaces.store.up, { http_status: surfaces.store.http_status });
  for (const k of publishable_keys) if (k.warning === "NO SALES CHANNEL") emitEvent("key_warning", { key_title: k.title, warning: k.warning });
  if (ENABLE_REMEDIATION) report.remediation = await runRemediationHooks({ reason: "observability_dashboard" });
  const markdown = buildObsMarkdown(report);
  const out = { ...report, markdown };
  const wantHtml = format === "html" || !!write_html;
  if (wantHtml) {
    const html = buildObsHtml(report);
    if (write_html) {
      const dest = path.resolve(String(write_html));
      fs.writeFileSync(dest, html, "utf8");
      out.html_path = dest;
      out.html_bytes = Buffer.byteLength(html);
    } else {
      out.html = html;
    }
  }
  return out;
}

const S = (props = {}, required = []) => ({ type: "object", properties: props, ...(required.length ? { required } : {}) });
const str = { type: "string" }, num = { type: "number" }, bool = { type: "boolean" }, conf = { type: "boolean", description: "false/omitted = dry-run (default). true = execute." };
const tools = {
  store_health: { description: "Fail-loud health check: backend /health, admin secret-key auth, and (if a publishable key is set) Store API visibility. Verdict OK/WARN/FAIL. Read-only.", inputSchema: S(), run: storeHealth },
  list_products: { description: "List products via the Admin API (q search, status draft|published|proposed|rejected, limit<=100, offset, optional fields). Read-only.", inputSchema: S({ q: str, status: str, limit: num, offset: num, fields: str }), run: listProducts },
  get_product: { description: "Get one product with variants, categories, tags and sales channels. Read-only.", inputSchema: S({ id: str, fields: str }, ["id"]), run: getProduct },
  list_variants: { description: "List a product's variants with SKUs, prices and options. Read-only.", inputSchema: S({ product_id: str, limit: num, offset: num }, ["product_id"]), run: listVariants },
  inventory_levels: { description: "Inventory items with per-location stocked/reserved/available quantities (filter by sku or q). Read-only.", inputSchema: S({ sku: str, q: str, limit: num, offset: num }), run: inventoryLevels },
  list_orders: { description: "List recent orders with PII-minimal fields (no email/address). Optional status, created_after (YYYY-MM-DD). Read-only.", inputSchema: S({ status: str, created_after: str, limit: num, offset: num }), run: listOrders },
  get_order: { description: "Get one order with items and fulfillments. Customer email/shipping address only when include_customer=true. Read-only.", inputSchema: S({ id: str, include_customer: bool }, ["id"]), run: getOrder },
  list_categories: { description: "List product categories (id, name, handle, active/internal, parent). Read-only.", inputSchema: S({ q: str, limit: num }), run: listCategories },
  list_tags: { description: "List product tags (id, value). Read-only.", inputSchema: S({ q: str, limit: num }), run: listTags },
  list_sales_channels: { description: "List sales channels. A product is only visible to a publishable key whose sales channel it is linked to. Read-only.", inputSchema: S(), run: listSalesChannels },
  store_products: { description: "List products as a shopper sees them through MEDUSA_PUBLISHABLE_KEY (Store API). Read-only.", inputSchema: S({ q: str, region_id: str, limit: num }), run: storeProducts },
  draft_product_create: { description: "Create a product with status=draft (always). images = list of already-hosted image URLs (first becomes thumbnail). Requires options + variants. Dry-run unless confirm=true; reads back and FAILS LOUD if not draft. Never publishes.", inputSchema: S({ title: str, handle: str, description: str, images: { type: "array", items: str }, options: { type: "array", items: { type: "object" } }, variants: { type: "array", items: { type: "object" } }, category_ids: { type: "array", items: str }, tag_ids: { type: "array", items: str }, sales_channel_ids: { type: "array", items: str }, metadata: { type: "object" }, confirm: conf }, ["title", "options", "variants"]), run: draftProductCreate },
  draft_product_update: { description: "Update a DRAFT product (refuses non-draft products and any status change). patch = Admin API update body. Dry-run unless confirm=true.", inputSchema: S({ id: str, patch: { type: "object" }, confirm: conf }, ["id", "patch"]), run: draftProductUpdate },
  variant_price_update: { description: "Set one currency's base price on a variant, keeping its other prices. Dry-run (shows before/after) unless confirm=true. On non-draft (live) products confirm also needs MEDUSA_ALLOW_PUBLISH=true.", inputSchema: S({ product_id: str, variant_id: str, currency_code: str, amount: num, confirm: conf }, ["product_id", "variant_id", "currency_code", "amount"]), run: variantPriceUpdate },
  inventory_level_update: { description: "Set stocked_quantity for an existing inventory level at a stock location. Dry-run (shows before) unless confirm=true; confirm also needs MEDUSA_ALLOW_PUBLISH=true (stock is always live).", inputSchema: S({ inventory_item_id: str, location_id: str, stocked_quantity: num, confirm: conf }, ["inventory_item_id", "location_id", "stocked_quantity"]), run: inventoryLevelUpdate },
  product_publish: { description: "OPT-IN: publish one product (draft -> published). Requires MEDUSA_ALLOW_PUBLISH=true AND confirm=true. Pre-checks: sales channel, prices, non-zero stock (unless allow_zero_stock). Dry-run lists blockers; confirm reads back. One product per call: no bulk publish.", inputSchema: S({ id: str, allow_zero_stock: bool, confirm: conf }, ["id"]), run: productPublish },
  live_product_update: { description: "OPT-IN: edit any product including live ones (no status changes; use product_publish). Requires MEDUSA_ALLOW_PUBLISH=true AND confirm=true. Dry-run shows current values.", inputSchema: S({ id: str, patch: { type: "object" }, confirm: conf }, ["id", "patch"]), run: liveProductUpdate },
  events_poll_since: { description: "Read-only cursor-based poll of the in-process event stream (plugin-captured errors, health transitions, key warnings, audit/remediation). Returns events with id > cursor. Optional outbound webhook is configured via MEDUSA_EVENTS_WEBHOOK_URL (+ HMAC secret). Real Medusa store events (order.placed, etc.) need a backend subscriber — see the medusa-event-forwarding skill.", inputSchema: S({ cursor: num, limit: num }), run: eventsPollSince },
  audit_log: { description: "Read-only query of the append-only JSONL audit trail (default ~/.medusa-plugin/audit.jsonl, override MEDUSA_AUDIT_LOG). Records every write/remediation attempt including dry-runs with redacted args and before/after snapshots.", inputSchema: S({ limit: num, tool: str, since: str }), run: auditLogQuery },
  remediation_status: { description: "List remediation hooks, whether enabled (MEDUSA_ENABLE_REMEDIATION), allowlist, apply flag (MEDUSA_REMEDIATION_APPLY), and last runs. Pass run=true to evaluate allowlisted hooks (still dry-run unless APPLY is set). OFF by default.", inputSchema: S({ run: bool }), run: remediationStatus },
  rate_limit_status: { description: "Read-only per-surface request counts in a 1-minute rolling window, configured budget (MEDUSA_RATE_BUDGET_PER_MIN, default 60), and last Retry-After / X-RateLimit-* headers seen. Automatic backoff on 429/503 with jitter is built into the HTTP helper.", inputSchema: S(), run: rateLimitStatus },
  observability_dashboard: { description: "Read-only observability dashboard: live /health, admin auth, store (publishable key), publishable API key table (title, redacted token, revoked, sales channels; WARN when no channel), plus in-memory latency/error recorder stats (latest/avg/p95) and recent errors with exact messages. Optional format=\"html\" or write_html=path for a self-contained dark-theme HTML file. Never records keys/headers.", inputSchema: S({ format: str, write_html: str }), run: observabilityDashboard },
  medusa_docs: { description: "Golden Rule: search the official Medusa docs index (query) or read/grep an official docs page (page, optional query). Reports 'NOT IN OFFICIAL DOCS' when nothing matches. Call before any write or unfamiliar answer.", inputSchema: S({ query: str, page: str }), run: medusaDocs },
};

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") return reply({ protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "medusa-commerce", version: VERSION } });
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  if (method === "tools/call") {
    const t = tools[params?.name];
    if (!t) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool ${params?.name}` } };
    const WRITE_TOOLS = new Set(["draft_product_create", "draft_product_update", "variant_price_update", "inventory_level_update", "product_publish", "live_product_update"]);
    try {
      const args = params.arguments || {};
      let before = null;
      if (WRITE_TOOLS.has(params.name) && args.id) {
        try {
          if (params.name.includes("product") || params.name === "product_publish") before = (await req(`/admin/products/${encodeURIComponent(args.id)}?fields=id,title,status,handle`)).product;
          else if (params.name === "inventory_level_update" && args.inventory_item_id) before = (await req(`/admin/inventory-items/${encodeURIComponent(args.inventory_item_id)}?fields=id,sku,*location_levels`)).inventory_item;
        } catch { before = null; }
      }
      const out0 = await t.run(args);
      const out = withThrottle(out0);
      if (WRITE_TOOLS.has(params.name)) {
        let after = null;
        if (out0 && out0.dry_run === false && args.id) {
          try {
            if (params.name.includes("product") || params.name === "product_publish") after = (await req(`/admin/products/${encodeURIComponent(args.id)}?fields=id,title,status,handle`)).product;
            else if (params.name === "inventory_level_update" && args.inventory_item_id) after = (await req(`/admin/inventory-items/${encodeURIComponent(args.inventory_item_id)}?fields=id,sku,*location_levels`)).inventory_item;
          } catch { after = null; }
        }
        try { appendAudit({ tool: params.name, args, before, after, result: out0, dry_run: !!(out0 && out0.dry_run) }); } catch (ae) { emitEvent("error", { surface: "admin", error: scrub(`audit append failed: ${ae.message}`) }); }
      }
      return reply({ content: [{ type: "text", text: scrub(JSON.stringify(out, null, 2)) }] });
    }
    catch (e) { return reply({ isError: true, content: [{ type: "text", text: `ERROR: ${scrub(e.message)}` }] }); }
  }
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

if ((env.MCP_TRANSPORT || "stdio") === "http") {
  const port = Number(env.MCP_PORT || 8788), bind = env.MCP_BIND || "127.0.0.1";
  http.createServer(async (rq, res) => {
    const u = new URL(rq.url || "/", `http://${bind}`);
    if (u.pathname === "/events" && rq.method === "GET") {
      // SSE event stream (localhost / bound interface only; read-only)
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ type: "hello", latest_cursor: eventSeq, timestamp: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      rq.on("close", () => sseClients.delete(res));
      return;
    }
    if (u.pathname !== "/mcp") { res.writeHead(404).end(); return; }
    if (env.MCP_AUTH_TOKEN && rq.headers.authorization !== `Bearer ${env.MCP_AUTH_TOKEN}`) { res.writeHead(401).end(); return; }
    if (rq.method !== "POST") { res.writeHead(405).end(); return; }
    let data = ""; for await (const c of rq) data += c;
    try {
      const m = JSON.parse(data);
      const out = Array.isArray(m) ? (await Promise.all(m.map(handle))).filter(Boolean) : await handle(m);
      if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202).end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    } catch { res.writeHead(400).end(); }
  }).listen(port, bind, () => console.error(`medusa-commerce MCP http on ${bind}:${port}/mcp (SSE /events)`));
} else {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => { if (!line.trim()) return; let m; try { m = JSON.parse(line); } catch { return; } const out = await handle(m); if (out) process.stdout.write(JSON.stringify(out) + "\n"); });
}
