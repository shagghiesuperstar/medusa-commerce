---
name: golden-rule-read-docs-first
description: >-
  Use before ANY Medusa action or answer. Read the official Medusa docs (docs.medusajs.com) first via medusa_docs, cite the page, and label anything the docs do not cover as "not in official docs".
---
# golden-rule-read-docs-first

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Rule
1. Call `medusa_docs {query}` for the topic, then `medusa_docs {page, query}` on the best hit. The tool only reads the official docs origin.
2. Answer or act from what the page says. Cite the URL.
3. If nothing matches, say **"not in official docs"**, mark the step UNVERIFIED, and prefer the read-only path or ask the human.
4. Never invent endpoints, fields, or flags. Medusa v1 and v2 differ a lot (for example v1's `x-medusa-access-token` header is gone in v2). Training memory is often v1.

## Official sources
- Admin API: https://docs.medusajs.com/api/admin (auth, fields, pagination, metadata)
- Store API: https://docs.medusajs.com/api/store (needs `x-publishable-api-key`)
- Docs index for agents: https://docs.medusajs.com/llms.txt
- Official remote MCPs (OAuth with a Medusa Cloud account): Docs MCP `https://docs.medusajs.com/mcp` (tool `ask_medusa_question`), and the read-only Medusa Cloud store MCP `https://cloud.medusajs.com/mcp` (Cloud stores on v2.12.4+). If the user has these connected, they are a good second docs source.
