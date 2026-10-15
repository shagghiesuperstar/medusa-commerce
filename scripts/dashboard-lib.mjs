// Pure helpers for the multi-store read-only dashboard (config, history ring, stats, rendering).
// No network I/O here. Never handles secret VALUES except to test presence and scrub them from output.
import fs from "node:fs";
import path from "node:path";

export const SURFACES = ["health", "admin", "store", "docs"];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

/** Load and validate a stores config. Stores default to enabled=false. */
export function loadConfig(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return normalizeConfig(raw);
}
export function normalizeConfig(raw) {
  const blocked = (raw.blocked_hosts || []).map((h) => String(h).toLowerCase());
  const stores = (raw.stores || []).map((s) => {
    if (!ID_RE.test(String(s.id || ""))) throw new Error(`invalid store id ${JSON.stringify(s.id)}`);
    let host = null;
    try { host = s.backend_url ? new URL(s.backend_url).hostname.toLowerCase() : null; } catch { throw new Error(`store ${s.id}: invalid backend_url`); }
    const hostBlocked = !!host && blocked.some((b) => host === b || host.endsWith("." + b));
    const enabled = s.enabled === true && !hostBlocked && !!s.backend_url;
    return {
      id: s.id, label: String(s.label || s.id), backend_url: s.backend_url || null,
      enabled, disabled_reason: enabled ? null : (hostBlocked ? "disabled by store-access rule (host is in blocked_hosts)" : s.enabled === true ? "no backend_url configured" : (s.disabled_reason || "disabled by store-access rule")),
      admin_key_env: s.admin_key_env || null, publishable_key_env: s.publishable_key_env || null,
    };
  });
  const ids = new Set();
  for (const s of stores) { if (ids.has(s.id)) throw new Error(`duplicate store id ${s.id}`); ids.add(s.id); }
  return {
    refresh_sec: Math.max(10, Number(raw.refresh_sec || 60)),
    max_backoff_sec: Math.max(30, Number(raw.max_backoff_sec || 900)),
    history_max: Math.max(500, Number(raw.history_max || 1000)),
    history_dir: raw.history_dir || null,
    docs_url: raw.docs_url || "https://docs.medusajs.com/llms.txt",
    blocked_hosts: blocked,
    stores,
  };
}

/** Which credentials are configured / present, by env var NAME only. */
export function keyInventory(store, env = process.env) {
  const slot = (name) => (name ? { env: name, present: !!env[name] } : { env: null, present: false });
  const admin = slot(store.admin_key_env), pub = slot(store.publishable_key_env);
  const missing = [];
  if (!admin.present) missing.push(admin.env ? `${admin.env} (not set)` : "admin key (no env var configured)");
  if (!pub.present) missing.push(pub.env ? `${pub.env} (not set)` : "publishable key (no env var configured)");
  return { admin, publishable: pub, missing };
}

/** Remove any configured secret values from a string (defense in depth). */
export function makeScrubber(values) {
  const vs = values.filter((v) => typeof v === "string" && v.length >= 8);
  return (s) => { let t = String(s); for (const v of vs) t = t.split(v).join("[redacted]"); return t; };
}

/** Bounded JSONL history ring persisted on disk; survives restarts. */
export class History {
  constructor(file, max = 1000) { this.file = file; this.max = max; this.rows = []; this.load(); }
  load() {
    try {
      this.rows = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-this.max);
    } catch (e) { if (e.code !== "ENOENT") throw e; this.rows = []; }
  }
  append(sample) {
    this.rows.push(sample);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (this.rows.length > this.max) {
      this.rows = this.rows.slice(-this.max);
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, this.rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      fs.renameSync(tmp, this.file);
    } else fs.appendFileSync(this.file, JSON.stringify(sample) + "\n");
  }
  get size() { return this.rows.length; }
}

export function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
/** latest/avg/p95 per surface from persisted history (successful samples with a latency). */
export function surfaceStats(rows, surface) {
  const ms = rows.map((r) => r.surfaces?.[surface]).filter((x) => x && typeof x.ms === "number").map((x) => x.ms);
  const ups = rows.map((r) => r.surfaces?.[surface]).filter((x) => x && typeof x.up === "boolean");
  return {
    samples: ms.length,
    latest_ms: ms.length ? Math.round(ms[ms.length - 1]) : null,
    avg_ms: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    p95_ms: ms.length ? Math.round(pct(ms, 95)) : null,
    uptime_pct: ups.length ? Math.round((1000 * ups.filter((x) => x.up).length) / ups.length) / 10 : null,
  };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHtml(status) {
  const tabs = status.stores.map((s, i) => `<button class="tab${i ? "" : " on"}" data-t="${esc(s.id)}">${esc(s.label)} <span class="pill ${s.state}">${esc(s.state)}</span></button>`).join("");
  const panes = status.stores.map((s, i) => `<div class="pane${i ? "" : " on"}" id="p-${esc(s.id)}">${renderStore(s)}</div>`).join("");
  const audit = (status.audit?.entries || []).slice(-25).reverse().map((e) => `<tr><td>${esc(e.timestamp)}</td><td>${esc(e.tool)}</td><td>${e.dry_run ? "dry-run" : "live"}</td><td>${esc(e.outcome || e.result || e.status || "")}</td></tr>`).join("") || `<tr><td colspan="4">${esc(status.audit?.error || "no audit entries")}</td></tr>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="${status.refresh_sec}"/><title>Medusa observability dashboard</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;background:#0b0f14;color:#e6edf3}
header{padding:18px 24px;border-bottom:1px solid #243041;background:#111822}h1{margin:0 0 4px;font-size:20px}.meta{color:#8b9bb4}
nav{display:flex;gap:6px;padding:12px 24px 0;flex-wrap:wrap;border-bottom:1px solid #243041}.tab{background:#121a24;color:#8b9bb4;border:1px solid #243041;border-bottom:none;border-radius:8px 8px 0 0;padding:10px 16px;cursor:pointer;font-weight:600;opacity:.72;transition:background .15s,color .15s,box-shadow .15s,opacity .15s}.tab:hover{opacity:1;color:#e6edf3}.tab.on{background:#0d2a2a;color:#ffffff;border-color:#00ffcc;border-bottom:2px solid #00ffcc;opacity:1;box-shadow:0 0 0 1px #00ffcc,0 0 18px rgba(0,255,204,.55),0 0 36px rgba(0,255,204,.25);text-shadow:0 0 10px rgba(0,255,204,.45)}
.pane{display:none;padding:16px 24px;gap:18px}.pane.on{display:grid}main{padding:0 24px 24px}
section{background:#121a24;border:1px solid #243041;border-radius:12px;padding:14px 18px}h2{margin:0 0 10px;font-size:15px;color:#9ecbff}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #1e2a3a;vertical-align:top}th{color:#8b9bb4;font-size:12px;text-transform:uppercase}
.up{color:#3dd68c;font-weight:700}.down{color:#ff6b6b;font-weight:700}.na{color:#8b9bb4}.warn{color:#ffd166;font-weight:700}.err{color:#ff8e8e;white-space:pre-wrap;word-break:break-word}
.pill{font-size:11px;border-radius:9px;padding:1px 7px;background:#243041}.pill.ok{color:#3dd68c}.pill.degraded,.pill.no-key{color:#ffd166}.pill.down{color:#ff6b6b}.pill.disabled{color:#8b9bb4}
.banner{padding:14px 18px;border-radius:12px;border:1px dashed #5b6b80;color:#c6d0db}code{font:12px ui-monospace,monospace;color:#c6d0db}footer{padding:0 24px 24px;color:#8b9bb4;font-size:12px}
</style></head><body><header><h1>Medusa observability dashboard</h1><div class="meta">Generated ${esc(status.generated_at)} · ${status.stores.length} stores · read-only · JSON: <code>/api/status.json</code></div></header>
<nav>${tabs}</nav>${panes}<main><section><h2>Audit trail (plugin audit_log, read-only)</h2><table><thead><tr><th>When</th><th>Tool</th><th>Mode</th><th>Outcome</th></tr></thead><tbody>${audit}</tbody></table></section></main>
<footer>Read-only GETs only. Keys and auth headers are never recorded or shown. Disabled stores are never contacted.</footer>
<script>document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.pane').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.getElementById('p-'+b.dataset.t).classList.add('on');location.hash=b.dataset.t});
if(location.hash){const b=document.querySelector('.tab[data-t="'+location.hash.slice(1)+'"]');if(b)b.click()}</script></body></html>`;
}

function renderStore(s) {
  const inv = s.credentials;
  const credLine = `<section><h2>Credentials (env var names only)</h2><table><thead><tr><th>Slot</th><th>Env var</th><th>Present</th></tr></thead><tbody>
<tr><td>admin</td><td><code>${esc(inv.admin.env || "— none configured —")}</code></td><td class="${inv.admin.present ? "up" : "down"}">${inv.admin.present ? "yes" : "no"}</td></tr>
<tr><td>publishable</td><td><code>${esc(inv.publishable.env || "— none configured —")}</code></td><td class="${inv.publishable.present ? "up" : "down"}">${inv.publishable.present ? "yes" : "no"}</td></tr></tbody></table></section>`;
  if (!s.enabled) return `<div class="banner"><b>DISABLED by store-access rule.</b> ${esc(s.disabled_reason)}. This dashboard sends no requests to this store (not even /health).</div>${credLine}`;
  const noKey = !inv.admin.present && !inv.publishable.present ? `<div class="banner"><b>NO KEY CONFIGURED.</b> Only the unauthenticated <code>/health</code> check runs. Missing: ${esc(inv.missing.join(", "))}.</div>` : "";
  const rows = SURFACES.map((n) => {
    const x = s.surfaces?.[n] || {};
    const cls = x.up === true ? "up" : x.up === false ? "down" : "na";
    return `<tr><td>${n}</td><td class="${cls}">${x.up === true ? "UP" : x.up === false ? "DOWN" : (x.skipped ? "SKIPPED" : "n/a")}</td><td>${x.http_status ?? "—"}</td><td>${x.live_ms ?? "—"}</td><td>${x.latest_ms ?? "—"}</td><td>${x.avg_ms ?? "—"}</td><td>${x.p95_ms ?? "—"}</td><td>${x.samples ?? 0}</td><td class="err">${esc(x.error || x.skipped || "")}</td></tr>`;
  }).join("");
  const keys = (s.publishable_keys || []).map((k) => `<tr><td>${esc(k.title || "—")}</td><td><code>${esc(k.redacted || "—")}</code></td><td>${k.revoked ? "yes" : "no"}</td><td>${esc((k.sales_channels || []).join(", ") || "—")}</td><td>${k.warning ? `<span class="warn">${esc(k.warning)}</span>` : k.revoked ? "revoked" : "ok"}</td></tr>`).join("") || `<tr><td colspan="5">${inv.admin.present ? "none returned" : "admin key not configured — key list unavailable"}</td></tr>`;
  const errs = (s.recent_errors || []).map((e) => `<tr><td>${esc(e.timestamp)}</td><td>${esc(e.surface)}</td><td><code>${esc(e.path)}</code></td><td>${esc(e.status)}</td><td class="err">${esc(e.error)}</td></tr>`).join("") || `<tr><td colspan="5">none</td></tr>`;
  const evs = (s.events || []).slice(-20).reverse().map((e) => `<tr><td>${esc(e.timestamp)}</td><td>${esc(e.type)}</td><td><code>${esc(JSON.stringify(e.data ?? e.detail ?? {}).slice(0, 200))}</code></td></tr>`).join("") || `<tr><td colspan="3">no events yet</td></tr>`;
  return `${noKey}<section><h2>Surfaces</h2><div class="meta">Last poll ${esc(s.last_poll_at || "—")} · next in ${s.next_poll_sec ?? "—"}s${s.backoff_level ? ` (backoff ×${2 ** s.backoff_level})` : ""} · history ${s.history_samples}/${s.history_max}</div>
<table><thead><tr><th>Surface</th><th>Status</th><th>HTTP</th><th>Live ms</th><th>Latest</th><th>Avg</th><th>p95</th><th>Samples</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></section>
<section><h2>Publishable API keys</h2><table><thead><tr><th>Title</th><th>Redacted</th><th>Revoked</th><th>Sales channels</th><th>Status</th></tr></thead><tbody>${keys}</tbody></table></section>
<section><h2>Recent errors</h2><table><thead><tr><th>When</th><th>Surface</th><th>Path</th><th>HTTP</th><th>Message</th></tr></thead><tbody>${errs}</tbody></table></section>
<section><h2>Event feed (events_poll_since)</h2><table><thead><tr><th>When</th><th>Type</th><th>Detail</th></tr></thead><tbody>${evs}</tbody></table></section>${credLine}`;
}
