// Static checks: golden rule in every skill, frontmatter present, every lesson cites a doc or is marked UNVERIFIED.
import fs from "node:fs"; import path from "node:path";
const root = new URL("..", import.meta.url).pathname; let fail = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const required = ["getting-started", "golden-rule-read-docs-first", "draft-product-pipeline", "catalog-hygiene", "inventory-sync-tips", "compound-learnings", "live-publishing-opt-in", "medusa-cloud-cli", "medusa-cloud-environments", "medusa-erp-inventory-sync", "medusa-admin-orphan-links", "medusa-cart-taxes", "medusa-multi-entity-architecture", "medusa-event-forwarding"];
ok(fs.existsSync(path.join(root, "references/known-issues.md")), "references/known-issues.md present");
ok(/never executes SQL/i.test(fs.readFileSync(path.join(root, "skills/medusa-admin-orphan-links/SKILL.md"), "utf8")), "orphan-links skill forbids executing SQL");
const dirs = fs.readdirSync(path.join(root, "skills"));
for (const r of required) ok(dirs.includes(r), `skill present: ${r}`);
for (const d of dirs) {
  const s = fs.readFileSync(path.join(root, "skills", d, "SKILL.md"), "utf8");
  ok(/^---\nname: [\w-]+\ndescription:/m.test(s), `${d}: frontmatter name+description`);
  ok(s.includes("golden-rule-read-docs-first") && /Step 0/.test(s), `${d}: references the Golden Rule as step 0`);
}
const dp = fs.readFileSync(path.join(root, "skills/draft-product-pipeline/SKILL.md"), "utf8");
ok(/never auto-publish/i.test(dp), "draft pipeline says never auto-publish");
const lessons = fs.readFileSync(path.join(root, "docs/LESSONS.md"), "utf8").split(/^### /m).slice(1);
ok(lessons.length > 0, "docs/LESSONS.md has lessons");
for (const l of lessons) ok(/Checked against: (https:\/\/docs\.medusajs\.com\/\S+|UNVERIFIED)/.test(l), `lesson cites official doc or UNVERIFIED: ${l.split("\n")[0]}`);
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
ok(/## Golden Rule/.test(readme) && readme.indexOf("Golden Rule") < readme.indexOf("## What's inside"), "README opens with the Golden Rule");
ok(readme.includes("@pixelrainbownft") && readme.includes("https://pixelrainbow.ai") && /coming soon/i.test(readme), "README credits + companion template marked coming soon");
const lp = fs.readFileSync(path.join(root, "skills/live-publishing-opt-in/SKILL.md"), "utf8");
ok(/one SKU/i.test(lp) && /read back/i.test(lp) && /zero-stock/i.test(lp) && /sales-channel/i.test(lp), "publishing skill has all four cautions");
const pj = JSON.parse(fs.readFileSync(path.join(root, ".cursor-plugin/plugin.json"), "utf8"));
ok(/^1\.\d+\.\d+$/.test(pj.version) && /official Medusa docs/i.test(pj.description), "manifest v1.x and golden rule in description");
console.log(fail ? `\nSKILLS TEST FAIL (${fail})` : "\nSKILLS TEST PASS"); process.exit(fail ? 1 : 0);
