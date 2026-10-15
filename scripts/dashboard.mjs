#!/usr/bin/env node
// Read-only Medusa observability dashboard runner.
// Uses the MCP server tool observability_dashboard (live GETs only).
// --serve binds 127.0.0.1 by default (or --host / --host tailscale). Never 0.0.0.0.
// Never prints secret env values.
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const serve = args.includes("--serve");
const out = path.resolve(flag("--out") || "./medusa-dashboard.html");
const port = Number(flag("--port") || 8790);
const refreshSec = Number(flag("--refresh") || 30);
const hostFlag = flag("--host");

function resolveBindHost() {
  if (!hostFlag || hostFlag === "127.0.0.1" || hostFlag === "localhost") return "127.0.0.1";
  if (hostFlag === "0.0.0.0" || hostFlag === "::" || hostFlag === "[::]") {
    throw new Error("Refusing to bind 0.0.0.0 / :: — use 127.0.0.1 or --host tailscale");
  }
  if (hostFlag === "tailscale") {
    try {
      const ip = String(execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" })).trim().split(/\s+/)[0];
      if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`unexpected tailscale ip output`);
      return ip;
    } catch (e) {
      throw new Error(`Tailscale is down or 'tailscale ip -4' failed (${e.message}). Refusing to start.`);
    }
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostFlag)) return hostFlag;
  throw new Error(`Unsupported --host ${hostFlag}. Use 127.0.0.1, an explicit IPv4, or tailscale.`);
}

function startServer() {
  const srv = spawn("node", [path.join(root, "server/index.mjs")], {
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  const waiters = new Map();
  let n = 0;
  srv.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      waiters.get(m.id)?.(m);
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      const t = setTimeout(() => { waiters.delete(id); reject(new Error(`rpc timeout: ${method}`)); }, Number(process.env.MEDUSA_TIMEOUT_MS || 15000) + 5000);
      waiters.set(id, (m) => { clearTimeout(t); waiters.delete(id); resolve(m); });
      srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return { srv, rpc };
}

async function callTool(rpc, name, arguments_ = {}) {
  const r = await rpc("tools/call", { name, arguments: arguments_ });
  const text = r.result?.content?.[0]?.text || "";
  if (r.result?.isError || String(text).startsWith("ERROR:")) throw new Error(text.slice(0, 500));
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function writeDashboard(dest) {
  const { srv, rpc } = startServer();
  try {
    await rpc("initialize", { protocolVersion: "2025-06-18" });
    const parsed = await callTool(rpc, "observability_dashboard", { format: "html", write_html: dest });
    if (!fs.existsSync(dest)) throw new Error(`dashboard file not written: ${dest}`);
    return parsed;
  } finally {
    srv.kill();
  }
}

const report = await writeDashboard(out);
console.error(`wrote ${out} (${fs.statSync(out).size} bytes)`);
if (report.surfaces) {
  for (const name of ["health", "admin", "store"]) {
    const s = report.surfaces[name] || {};
    console.error(`  ${name}: ${s.up ? "UP" : "DOWN"}${s.latency_ms != null ? ` ${s.latency_ms}ms` : ""}${s.error ? ` — ${s.error}` : ""}`);
  }
  const keys = report.publishable_keys || [];
  console.error(`  publishable keys: ${keys.length}`);
  for (const k of keys) console.error(`    - ${k.title || "?"} [${k.warning || (k.revoked ? "revoked" : "ok")}] channels=${(k.sales_channels || []).join("|") || "—"}`);
}

if (!serve) process.exit(0);

const bindHost = resolveBindHost();
let writing = false;
async function refresh() {
  if (writing) return;
  writing = true;
  try { await writeDashboard(out); console.error(`[${new Date().toISOString()}] refreshed ${out}`); }
  catch (e) { console.error(`refresh failed: ${e.message}`); }
  finally { writing = false; }
}

// Long-lived MCP child for /events SSE polling (plugin in-process events).
const live = startServer();
await live.rpc("initialize", { protocolVersion: "2025-06-18" });
let eventCursor = 0;
const sseClients = new Set();
async function pumpEvents() {
  try {
    const batch = await callTool(live.rpc, "events_poll_since", { cursor: eventCursor, limit: 50 });
    for (const ev of batch.events || []) {
      eventCursor = Math.max(eventCursor, ev.id || 0);
      const line = `data: ${JSON.stringify(ev)}\n\n`;
      for (const res of sseClients) { try { res.write(line); } catch { sseClients.delete(res); } }
    }
    if (typeof batch.latest_cursor === "number") eventCursor = Math.max(eventCursor, batch.cursor || eventCursor);
  } catch (e) {
    console.error(`events poll failed: ${e.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://${bindHost}`);
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  if (u.pathname === "/" || u.pathname === "/dashboard.html" || u.pathname === "/medusa-dashboard.html") {
    try {
      const html = fs.readFileSync(out, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end(String(e.message));
    }
    return;
  }
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello", cursor: eventCursor, timestamp: new Date().toISOString() })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (u.pathname === "/healthz") { res.writeHead(200).end("ok"); return; }
  res.writeHead(404).end();
});
server.listen(port, bindHost, () => {
  console.error(`serving http://${bindHost}:${port}/ (not 0.0.0.0), refresh every ${refreshSec}s; SSE /events`);
});
setInterval(refresh, Math.max(5, refreshSec) * 1000);
setInterval(pumpEvents, 2000);
process.on("exit", () => { try { live.srv.kill(); } catch { /* */ } });
process.on("SIGINT", () => { live.srv.kill(); process.exit(0); });
process.on("SIGTERM", () => { live.srv.kill(); process.exit(0); });
