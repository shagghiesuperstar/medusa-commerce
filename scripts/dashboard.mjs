#!/usr/bin/env node
// Read-only Medusa observability dashboard runner.
// Uses the MCP server tool observability_dashboard (live GETs only).
// Binds 127.0.0.1 only when --serve. Never prints secret env values.
import { spawn } from "node:child_process";
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

async function writeDashboard(dest) {
  const { srv, rpc } = startServer();
  try {
    await rpc("initialize", { protocolVersion: "2025-06-18" });
    const r = await rpc("tools/call", { name: "observability_dashboard", arguments: { format: "html", write_html: dest } });
    const text = r.result?.content?.[0]?.text || "";
    if (r.result?.isError || String(text).startsWith("ERROR:")) throw new Error(text.slice(0, 500));
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
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

let writing = false;
async function refresh() {
  if (writing) return;
  writing = true;
  try { await writeDashboard(out); console.error(`[${new Date().toISOString()}] refreshed ${out}`); }
  catch (e) { console.error(`refresh failed: ${e.message}`); }
  finally { writing = false; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
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
  if (u.pathname === "/healthz") { res.writeHead(200).end("ok"); return; }
  res.writeHead(404).end();
});
server.listen(port, "127.0.0.1", () => {
  console.error(`serving http://127.0.0.1:${port}/ (localhost only), refresh every ${refreshSec}s`);
});
setInterval(refresh, Math.max(5, refreshSec) * 1000);
