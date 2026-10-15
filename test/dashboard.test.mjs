// Multi-store dashboard: JSON endpoint (no secrets), disabled/no-key states, persisted history across restart.
// Uses the bundled mock on 127.0.0.1 only. Disabled stores point at an unroutable placeholder and must never be contacted.
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { History, surfaceStats, normalizeConfig, keyInventory } from "../scripts/dashboard-lib.mjs";
const root = new URL("..", import.meta.url).pathname;
const results = []; const check = (n, c) => { results.push([n, !!c]); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medusa-dash-test-"));

// Unit: history ring is bounded and reloads from disk
const hf = path.join(dir, "unit.jsonl"); const h = new History(hf, 500);
for (let i = 1; i <= 520; i++) h.append({ ts: String(i), surfaces: { health: { up: true, status: 200, ms: i } } });
const h2 = new History(hf, 500);
check("history ring bounded at 500 and reloads from disk", h.size === 500 && h2.size === 500 && h2.rows[0].ts === "21");
const st = surfaceStats(h2.rows, "health"); check("history stats: avg/p95 from persisted samples", st.avg_ms === 271 && st.p95_ms === 495 && st.latest_ms === 520);
const nc = normalizeConfig({ blocked_hosts: ["blocked.invalid"], stores: [{ id: "a", backend_url: "http://x.invalid" }, { id: "b", enabled: true, backend_url: "https://api.blocked.invalid" }] });
check("stores default to disabled; blocked_hosts overrides enabled", nc.stores[0].enabled === false && nc.stores[1].enabled === false && /store-access/.test(nc.stores[1].disabled_reason));
const ki = keyInventory({ admin_key_env: "X_ADMIN", publishable_key_env: null }, {});
check("key inventory reports env var names only", ki.missing.includes("X_ADMIN (not set)") && ki.missing.some((m) => m.includes("no env var configured")));

// E2E against mock
const mock = spawn("node", [path.join(root, "test/mock-medusa.mjs")], { stdio: ["ignore", "ignore", "pipe"] });
await new Promise((r) => { let n = 0; mock.stderr.on("data", (d) => { n += (String(d).match(/mock /g) || []).length; if (n >= 3) r(); }); });
const cfgFile = path.join(dir, "stores.json");
fs.writeFileSync(cfgFile, JSON.stringify({ refresh_sec: 10, history_max: 500, docs_url: "http://127.0.0.1:19050/llms.txt", stores: [
  { id: "alpha", label: "Alpha", enabled: true, backend_url: "http://127.0.0.1:19000", admin_key_env: "T_ALPHA_ADMIN", publishable_key_env: "T_ALPHA_PUB" },
  { id: "beta", label: "Beta", enabled: true, backend_url: "http://127.0.0.1:19000", admin_key_env: "T_BETA_ADMIN", publishable_key_env: "T_BETA_PUB" },
  { id: "gamma", label: "Gamma", enabled: false, backend_url: "http://disabled-store.invalid", admin_key_env: "T_GAMMA_ADMIN" },
] }));
const PORT = 18791;
const env = { ...process.env, T_ALPHA_ADMIN: "sk_test_mock", T_ALPHA_PUB: "pk_test_mock", MEDUSA_AUDIT_LOG: path.join(dir, "audit.jsonl"), MEDUSA_TIMEOUT_MS: "3000" };
const run = () => spawn("node", [path.join(root, "scripts/dashboard.mjs"), "--config", cfgFile, "--serve", "--host", "127.0.0.1", "--port", String(PORT), "--state-dir", dir], { env, stdio: ["ignore", "ignore", "pipe"] });
const waitUp = async () => { for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) return; } catch { /* */ } await new Promise((r) => setTimeout(r, 200)); } throw new Error("dashboard did not start"); };
const getJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
const stopP = (p) => new Promise((r) => { p.on("exit", r); p.kill("SIGTERM"); });

let d = run(); await waitUp();
const s1 = await getJson("/api/status.json");
const raw1 = JSON.stringify(s1);
const A = s1.stores.find((s) => s.id === "alpha"), B = s1.stores.find((s) => s.id === "beta"), G = s1.stores.find((s) => s.id === "gamma");
check("status.json lists all stores", s1.stores.length === 3 && s1.read_only === true);
check("enabled store with keys: health/admin/store/docs UP", A.state === "ok" && A.surfaces.health.up && A.surfaces.admin.up && A.surfaces.store.up && A.surfaces.docs.up);
check("orphan publishable key surfaced with WARN", A.publishable_keys.some((k) => k.warning === "NO SALES CHANNEL"));
check("no-key store: health probed, admin/store skipped, missing env names listed", B.state === "no-key" && B.surfaces.health.up && B.surfaces.admin.up === null && B.credentials.missing.join() === "T_BETA_ADMIN (not set),T_BETA_PUB (not set)");
check("disabled store: clear disabled state, no surfaces", G.state === "disabled" && /store-access/.test(G.disabled_reason) && !G.surfaces);
check("JSON contains no secret values", !raw1.includes("sk_test_mock") && !raw1.includes("pk_test_mock"));
const one = await getJson("/api/stores/alpha.json"); check("per-store JSON endpoint", one.id === "alpha" && one.surfaces.health.samples >= 1);
check("unknown store -> 404", (await fetch(`http://127.0.0.1:${PORT}/api/stores/nope.json`)).status === 404);
const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
check("HTML has a tab per store + disabled + no-key banners", html.includes('data-t="alpha"') && html.includes('data-t="gamma"') && html.includes("DISABLED by store-access rule") && html.includes("NO KEY CONFIGURED") && !html.includes("sk_test_mock"));
check("HTML has events and audit sections", html.includes("Event feed") && html.includes("Audit trail"));
check("POST refused (read-only)", (await fetch(`http://127.0.0.1:${PORT}/api/status.json`, { method: "POST" })).status === 405);
const n1 = A.history_samples;
await stopP(d);
check("history persisted to disk (JSONL)", fs.readFileSync(path.join(dir, "history", "alpha.jsonl"), "utf8").trim().split("\n").length === n1 && !fs.existsSync(path.join(dir, "history", "gamma.jsonl")));
d = run(); await waitUp();
const s2 = await getJson("/api/stores/alpha.json");
check("history survives restart and grows", s2.history_samples === n1 + 1 && s2.surfaces.health.samples === n1 + 1);
let refused = false; try { const p = spawn("node", [path.join(root, "scripts/dashboard.mjs"), "--config", cfgFile, "--serve", "--host", "0.0.0.0", "--port", "18792", "--state-dir", dir], { env, stdio: "ignore" }); refused = (await new Promise((r) => p.on("exit", r))) !== 0; } catch { refused = true; }
check("refuses to bind 0.0.0.0", refused);
await stopP(d); mock.kill();
console.log(results.map(([n, ok]) => `${ok ? "PASS" : "FAIL"}  ${n}`).join("\n"));
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\nDASHBOARD FAIL (${failed}/${results.length})` : `\nDASHBOARD PASS (${results.length}/${results.length})`); process.exit(failed ? 1 : 0);
