---
name: compound-learnings
description: >-
  Use after any Medusa incident, surprise, or fix. Turn the lesson into a skill rule plus a regression test, cite the official doc (or mark UNVERIFIED), and log it in docs/LESSONS.md and CHANGELOG.
---
# compound-learnings

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Loop
1. **Name it:** symptom → root cause → fix, in one sentence.
2. **Check the docs** (Golden Rule). Record the docs.medusajs.com URL, or mark `UNVERIFIED (not in official docs)`.
3. **Encode it small:** a rule line in the closest skill (preferred); a new skill only if none fits; a new tool only if the model can't do it with existing tools plus a skill (bitter lesson).
4. **Test it:** add `LESSON <name>` to `test/smoke.mjs` (extend `test/mock-medusa.mjs` if needed), or a manual check in the skill.
5. **Log it:** `docs/LESSONS.md` entry and a CHANGELOG line.
6. **Scrub it:** no store names, domains, keys, customer data, hostnames or IPs. Use placeholders like `<backend>`.
7. Run `node test/smoke.mjs`, `node test/skills.test.mjs` and `node test/privacy-scan.mjs` before committing.

## Template
```
### YYYY-MM-DD: <title>
- Symptom:
- Root cause:
- Fix / rule:
- Checked against: <docs.medusajs.com URL> | UNVERIFIED (not in official docs)
- Encoded in: skills/<skill>/SKILL.md
- Regression: test/smoke.mjs "LESSON ..." | manual
```
