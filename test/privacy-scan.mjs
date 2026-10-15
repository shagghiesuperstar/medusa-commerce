// Privacy/secret scan of every tracked text file. Generic patterns only, so this file itself contains no real names.
// Optional: PRIVACY_DENYLIST=/path/to/terms.txt (one term per line, kept OUTSIDE the repo) for org-specific words.
import fs from "node:fs"; import path from "node:path";
const root = new URL("..", import.meta.url).pathname;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === ".git" || e.name === "node_modules" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const patterns = [
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "IPv4", (m) => !/^(127\.0\.0\.1|0\.0\.0\.0)$/.test(m)],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "email", (m) => !/@(example\.com|users\.noreply\.github\.com)$/.test(m)],
  [/\b(sk|pk|rk)_(live|prod)_[A-Za-z0-9]{8,}/g, "live key"],
  [/\b[a-z0-9-]+\.medusajs\.(site|app)\b/g, "hosted store domain"],
  [/\b[\w-]+\.ts\.net\b/g, "private-network hostname"],
  [/(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/gi, "hardcoded secret"],
  [/gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}/g, "provider token"],
];
const deny = process.env.PRIVACY_DENYLIST ? fs.readFileSync(process.env.PRIVACY_DENYLIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : [];
let hits = 0;
for (const f of walk(root)) {
  if (/\.(png|jpg|ico)$/.test(f)) continue;
  const rel = path.relative(root, f), t = fs.readFileSync(f, "utf8");
  for (const [re, name, keep = () => true] of patterns) for (const m of t.match(re) || []) if (keep(m)) { console.log(`HIT ${name}: ${rel}: ${m.slice(0, 6)}…`); hits++; }
  for (const w of deny) if (t.toLowerCase().includes(w.toLowerCase())) { console.log(`HIT denylist term in ${rel}`); hits++; }
}
console.log(hits ? `\nPRIVACY SCAN FAIL (${hits})` : `\nPRIVACY SCAN PASS${deny.length ? ` (+${deny.length} denylist terms)` : ""}`); process.exit(hits ? 1 : 0);
