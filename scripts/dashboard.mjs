#!/usr/bin/env node
// Multi-store read-only Medusa observability dashboard (v1.5.0).
// One MCP child per ENABLED store; disabled stores are never contacted. Polls one request at a time per store,
// with exponential backoff on errors. History is persisted as a bounded JSONL ring per store.
// Binds 127.0.0.1 by default (or --host <IPv4> / tailscale). Never 0.0.0.0. Never prints secret values.
//   node scripts/dashboard.mjs --config stores.json [--serve --host 127.0.0.1 --port 8790] [--state-dir DIR] [--once]
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, loadConfig, keyInventory, makeScrubber, History, surfaceStats, renderHtml, SURFACES } from "./dashboard-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const serve = args.includes("--serve");
const once = args.includes("--once") || !serve;
const port = Number(flag("--port") || 8790);
const hostFlag = flag("--host");
const stateDir = path.resolve(flag("--state-dir") || process.cwd());
const out = path.resolve(flag("--out") || path.join(stateDir, "medusa-dashboard.html"));

function resolveBindHost() {
  if (!hostFlag || hostFlag === "127.0.0.1" || hostFlag === "localhost") return "127.0.0.1";
  if (["0.0.0.0", "::", "[::]"].includes(hostFlag)) throw new Error("Refusing to bind 0.0.0.0 / :: — use 127.0.0.1, an explicit IPv4, or tailscale");
  if (hostFlag === "tailscale") {
    const ip = String(execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" })).trim().split(/\s+/)[0];
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("Tailscale is down; refusing to start");
    return ip;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostFlag)) return hostFlag;
  throw new Error(`Unsupported --host ${hostFlag}`);
}

// Config: --config file, or legacy single store from MEDUSA_BACKEND_URL / MEDUSA_ADMIN_API_KEY / MEDUSA_PUBLISHABLE_KEY.
const cfgFile = flag("--config");
const cfg = cfgFile ? loadConfig(path.resolve(cfgFile)) : normalizeConfig({
  refresh_sec: Number(flag("--refresh") || 60),
  stores: [{ id: "default", label: "default", backend_url: process.env.MEDUSA_BACKEND_URL, enabled: !!process.env.MEDUSA_BACKEND_URL, admin_key_env: "MEDUSA_ADMIN_API_KEY", publishable_key_env: "MEDUSA_PUBLISHABLE_KEY" }],
});
if (flag("--refresh") && cfgFile) cfg.refresh_sec = Math.max(10, Number(flag("--refresh")));
const histDir = path.resolve(cfg.history_dir || path.join(stateDir, "history"));
const secretValues = cfg.stores.flatMap((s) => [s.admin_key_env, s.publishable_key_env]).filter(Boolean).map((n) => process.env[n]).filter(Boolean);
const scrub = makeScrubber(secretValues);

function startChild(extraEnv) {
  // Minimal env: never inherit other stores' keys; remediation always off.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, MEDUSA_TIMEOUT_MS: process.env.MEDUSA_TIMEOUT_MS || "20000", ...extraEnv };
  if (process.env.MEDUSA_AUDIT_LOG) env.MEDUSA_AUDIT_LOG = process.env.MEDUSA_AUDIT_LOG;
  if (process.env.MEDUSA_DOCS_BASE) env.MEDUSA_DOCS_BASE = process.env.MEDUSA_DOCS_BASE;
  for (const k of Object.keys(env)) if (env[k] == null || env[k] === "") delete env[k];
  const srv = spawn(process.execPath, [path.join(root, "server/index.mjs")], { env, stdio: ["pipe", "pipe", "ignore"] });
  let buf = ""; const waiters = new Map(); let n = 0;
  srv.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiters.get(m.id)?.(m); } catch { /* */ } } });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++n; const t = setTimeout(() => { waiters.delete(id); reject(new Error(`rpc timeout: ${method}`)); }, Number(env.MEDUSA_TIMEOUT_MS) * 4 + 5000);
    waiters.set(id, (m) => { clearTimeout(t); waiters.delete(id); resolve(m); });
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = async (name, a = {}) => {
    const r = await rpc("tools/call", { name, arguments: a }); const text = r.result?.content?.[0]?.text || "";
    if (r.result?.isError || text.startsWith("ERROR:")) throw new Error(scrub(text.slice(0, 500)));
    return JSON.parse(text);
  };
  const ready = rpc("initialize", { protocolVersion: "2025-06-18" });
  return { srv, call, ready };
}

// Per-store runtime state
const runtime = cfg.stores.map((s) => ({
  cfg: s, inv: keyInventory(s), history: new History(path.join(histDir, `${s.id}.jsonl`), cfg.history_max),
  child: null, last: null, events: [], cursor: 0, backoff: 0, nextAt: 0, lastPollAt: null, busy: false,
}));
const docsState = { last: null, history: new History(path.join(histDir, "_docs.jsonl"), cfg.history_max), busy: false };
const audit = { child: null, data: null };

async function checkDocs() {
  if (docsState.busy) return; docsState.busy = true;
  const t0 = performance.now(); const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 20000);
  let res;
  try { const r = await fetch(cfg.docs_url, { signal: ac.signal, headers: { Accept: "text/plain" } }); await r.text(); res = { up: r.ok, http_status: r.status, ms: Math.round(performance.now() - t0), ...(r.ok ? {} : { error: `HTTP ${r.status}` }) }; }
  catch (e) { res = { up: false, http_status: 0, ms: null, error: scrub(e.message) }; }
  finally { clearTimeout(to); docsState.busy = false; }
  docsState.last = { ...res, at: new Date().toISOString() };
  docsState.history.append({ ts: docsState.last.at, surfaces: { docs: { up: res.up, status: res.http_status, ...(res.ms != null ? { ms: res.ms } : {}) } } });
}

async function pollStore(rt) {
  if (!rt.cfg.enabled || rt.busy) return; rt.busy = true;
  const s = rt.cfg;
  try {
    if (!rt.child) {
      rt.child = startChild({
        MEDUSA_BACKEND_URL: s.backend_url,
        MEDUSA_ADMIN_API_KEY: s.admin_key_env ? process.env[s.admin_key_env] : undefined,
        MEDUSA_PUBLISHABLE_KEY: s.publishable_key_env ? process.env[s.publishable_key_env] : undefined,
      });
      await rt.child.ready;
    }
    // One tool call at a time; the tool issues its GETs sequentially (health, admin, store, api-keys).
    const rep = await rt.child.call("observability_dashboard", {});
    const at = new Date().toISOString();
    const sample = { ts: at, surfaces: {} };
    for (const n of ["health", "admin", "store"]) {
      const x = rep.surfaces?.[n] || {};
      if (x.http_status == null && x.latency_ms == null) continue; // not probed (no key)
      sample.surfaces[n] = { up: !!x.up, status: x.http_status ?? 0, ...(typeof x.latency_ms === "number" ? { ms: x.latency_ms } : {}) };
    }
    rt.history.append(sample);
    rt.last = { at, report: JSON.parse(scrub(JSON.stringify({ surfaces: rep.surfaces, publishable_keys: rep.publishable_keys, recent_errors: rep.recent_errors }))) };
    try {
      const ev = await rt.child.call("events_poll_since", { cursor: rt.cursor, limit: 50 });
      rt.cursor = ev.cursor ?? rt.cursor; rt.events = [...rt.events, ...JSON.parse(scrub(JSON.stringify(ev.events || [])))].slice(-100);
    } catch { /* events are best-effort */ }
    const anyDown = Object.values(sample.surfaces).some((x) => !x.up);
    rt.backoff = anyDown ? Math.min(rt.backoff + 1, 6) : 0;
  } catch (e) {
    rt.last = { at: new Date().toISOString(), error: scrub(e.message), report: rt.last?.report };
    rt.backoff = Math.min(rt.backoff + 1, 6);
    try { rt.child?.srv.kill(); } catch { /* */ } rt.child = null;
  } finally {
    rt.lastPollAt = new Date().toISOString();
    rt.nextAt = Date.now() + Math.min(cfg.refresh_sec * 2 ** rt.backoff, cfg.max_backoff_sec) * 1000;
    rt.busy = false;
  }
}

async function readAudit() {
  try {
    if (!audit.child) { audit.child = startChild({}); await audit.child.ready; } // no backend: local file read only
    audit.data = JSON.parse(scrub(JSON.stringify(await audit.child.call("audit_log", { limit: 50 }))));
    delete audit.data.path;
  } catch (e) { audit.data = { entries: [], error: scrub(e.message) }; }
}

function storeStatus(rt) {
  const s = rt.cfg; const rep = rt.last?.report || {};
  const base = { id: s.id, label: s.label, enabled: s.enabled, credentials: rt.inv, history_samples: rt.history.size, history_max: cfg.history_max };
  if (!s.enabled) return { ...base, state: "disabled", disabled_reason: s.disabled_reason };
  const surfaces = {};
  for (const n of SURFACES) {
    const st = surfaceStats(n === "docs" ? docsState.history.rows : rt.history.rows, n);
    if (n === "docs") { const d = docsState.last || {}; surfaces.docs = { up: d.up ?? null, http_status: d.http_status ?? null, live_ms: d.ms ?? null, ...st, ...(d.error ? { error: d.error } : {}), shared: true }; continue; }
    const x = rep.surfaces?.[n] || {};
    const probed = x.http_status != null || x.latency_ms != null;
    surfaces[n] = probed ? { up: !!x.up, http_status: x.http_status ?? null, live_ms: x.latency_ms ?? null, ...st, ...(x.error ? { error: x.error } : {}) }
      : { up: null, http_status: null, live_ms: null, ...st, skipped: x.error || "not probed" };
  }
  const probedUp = ["health", "admin", "store"].map((n) => surfaces[n]).filter((x) => x.up !== null);
  const noKey = !rt.inv.admin.present && !rt.inv.publishable.present;
  const state = !rt.last ? "pending" : probedUp.some((x) => x.up === false) || rt.last.error ? (surfaces.health.up ? "degraded" : "down") : noKey ? "no-key" : "ok";
  return { ...base, state, last_poll_at: rt.lastPollAt, next_poll_sec: Math.max(0, Math.round((rt.nextAt - Date.now()) / 1000)), backoff_level: rt.backoff,
    ...(rt.last?.error ? { poll_error: rt.last.error } : {}), surfaces, publishable_keys: rep.publishable_keys || [], recent_errors: rep.recent_errors || [], events: rt.events.slice(-50) };
}
function status() {
  return { generated_at: new Date().toISOString(), version: "1.5.0", read_only: true, refresh_sec: cfg.refresh_sec,
    stores: runtime.map(storeStatus), audit: audit.data ? { count: audit.data.count, entries: (audit.data.entries || []).slice(-50), ...(audit.data.error ? { error: audit.data.error } : {}) } : null };
}

// Initial cycle: stores sequentially, one at a time.
await checkDocs();
for (const rt of runtime) await pollStore(rt);
await readAudit();
fs.writeFileSync(out, renderHtml(status()));
for (const rt of runtime) console.error(`  ${rt.cfg.id}: ${storeStatus(rt).state} (history ${rt.history.size}) missing=[${rt.inv.missing.join("; ")}]`);
if (once) { for (const rt of runtime) rt.child?.srv.kill(); audit.child?.srv.kill(); process.exit(0); }

const bindHost = resolveBindHost();
const tick = setInterval(async () => {
  const now = Date.now();
  for (const rt of runtime) if (rt.cfg.enabled && now >= rt.nextAt) pollStore(rt); // stores in parallel, each strictly serial
  if (!docsState.busy && (!docsState.last || now - Date.parse(docsState.last.at) >= cfg.refresh_sec * 1000)) checkDocs();
}, 5000);
const auditTick = setInterval(readAudit, 30000);
const writeTick = setInterval(() => { try { fs.writeFileSync(out, renderHtml(status())); } catch { /* */ } }, 15000);

const json = (res, code, obj) => res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(scrub(JSON.stringify(obj, null, 2)));
const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://localhost");
  if (req.method !== "GET") return res.writeHead(405).end();
  if (["/", "/dashboard.html", "/medusa-dashboard.html"].includes(u.pathname)) return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(scrub(renderHtml(status())));
  if (u.pathname === "/api/status.json") return json(res, 200, status());
  const m = u.pathname.match(/^\/api\/stores\/([a-z0-9_-]+)\.json$/);
  if (m) { const rt = runtime.find((r) => r.cfg.id === m[1]); return rt ? json(res, 200, storeStatus(rt)) : json(res, 404, { error: "unknown store" }); }
  if (u.pathname === "/healthz") return res.writeHead(200).end("ok");
  res.writeHead(404).end();
});
server.listen(port, bindHost, () => console.error(`serving http://${bindHost}:${port}/ (not 0.0.0.0); stores=${runtime.length}; poll ${cfg.refresh_sec}s base`));
const stop = () => { clearInterval(tick); clearInterval(auditTick); clearInterval(writeTick); for (const rt of runtime) try { rt.child?.srv.kill(); } catch { /* */ } try { audit.child?.srv.kill(); } catch { /* */ } server.close(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
