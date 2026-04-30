# AGENTS.md

This file is the entry point for **AI coding assistants** (Cursor Composer/Agent, Claude Code, OpenAI Codex CLI, etc.) working in this repository. Read it before doing anything else.

## What this project is

`@sugukuru/sugu-agri-field` is an **MCP server** (Model Context Protocol) that exposes Japanese agricultural data — farmland polygons, weather, pesticide registrations — as tools, resources, prompts, and an MCP Apps UI dashboard.

The audience is agricultural staffing companies that dispatch Specified Skilled Workers (特定技能 / SSW). The server is also a **reference implementation** of the official MCP spec, so spec compliance is a first-class goal.

## Authoritative specs (always trust these over any other source)

- MCP Spec: <https://modelcontextprotocol.io/specification/latest> (currently 2025-11-25)
- MCP Apps Extension: <https://github.com/modelcontextprotocol/ext-apps> (stable spec 2026-01-26)
- MCP TypeScript SDK v1.x: <https://modelcontextprotocol.github.io/typescript-sdk/index.html>
- 2026 roadmap: <https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/>

When the spec and a comment in this repo disagree, the spec wins. Open an issue and update the comment.

## Mandatory reading before editing code

1. `.cursor/rules/00-project-overview.mdc` — what this project does and where things live.
2. `.cursor/rules/01-design-principles.mdc` — the official 8 design principles applied to this project.
3. `.cursor/rules/03-mcp-tool-rules.mdc` — naming, schema, visibility, and error conventions for tools.
4. `.cursor/rules/06-data-license.mdc` — every data source has a license; do not break the table.
5. `docs/data-license.md` — the canonical table of redistribution / caching / attribution rules.

## What you must NOT do

- Do not change the **name** or **shape** of an already-published tool (CHANGELOG.md is the source of truth for "published"). Add a new tool instead, then deprecate.
- Do not invent a new MCP primitive or extension. Compose using `tools` / `resources` / `prompts` / `MCP Apps UI`.
- Do not paper over current model limitations with hidden "hint" tools. Capability over compensation.
- Do not mix Phase 7+ (paid data, e.g. WAGRI) code into Phase 0–5 paths. Use the adapter interface.
- Do not put secrets, OAuth tokens, or any user-identifiable data in tool output, logs, error messages, or the MCP Apps UI bundle.
- Do not return unbounded results. Default `limit` is 20, hard max 100. Use `cursor` for pagination.
- Do not break `.well-known/mcp-server.json`. It is the public contract for registries and crawlers.

## Recommended workflow

1. Read the issue and find the relevant rule files.
2. Read the relevant adapter under `src/adapters/` to understand the data shape.
3. Write tests first (`tests/unit/...` or `tests/smoke/...`) using Vitest.
4. Implement.
5. Run `npm run lint && npm run typecheck && npm test` until green.
6. Update `CHANGELOG.md` (Keep a Changelog format).
7. If a tool's contract changed, also update `.well-known/mcp-server.json`.

## Phase / version map

The current phase is encoded in `package.json` `version`:

| Version range | Phase | Capability surface |
|---|---|---|
| `0.1.x` | Phase 0–1 | stdio + Streamable HTTP, 5 tools, Server Card |
| `0.2.x` | Phase 2 | + 5 prompts |
| `0.3.x` | Phase 3 | + Elicitation Form mode |
| `0.4.x` | Phase 4 | + Elicitation URL mode + OAuth Client Credentials |
| `0.5.x` | Phase 5 | + MCP Apps UI dashboard |
| `0.6.x` | Phase 6 | + Tasks primitive (out of current scope) |
| `1.0.0` | Stable | Tool/resource/prompt names frozen under SemVer |

Until `1.0.0` the surface is explicitly **experimental**.

## Where things live

```
src/
  server/         # McpServer wiring, transports, well-known, connect handler
  tools/          # One file per tool. Group by phase in registry.
  prompts/        # One file per prompt (Phase 2).
  elicitation/    # form / url helpers (Phase 3+).
  adapters/       # Data source adapters with a stable interface.
  auth/           # Token store + OAuth client (Phase 4+).
  ui/             # MCP Apps React UI (Phase 5). Built to dist/ui/dashboard.html.
  lib/            # Cache, rate limit, geo math, logger, errors, config.
  types/          # Shared types.
scripts/build-snapshots/   # Reproducible eMAFF/FAMIC SQLite builds.
tests/{unit,smoke,conformance,ui}/
docs/             # data-license.md, architecture.md, phase-plan.md.
.well-known/      # Public Server Card.
```

## Quick commands

```bash
npm install              # one-time
npm run dev              # stdio dev server
npm run dev:http         # Streamable HTTP dev server (Phase 1+)
npm test                 # vitest run (unit + smoke + conformance)
npm run test:ui          # Playwright UI smoke against dist/ui/dashboard.html
npm run inspector        # MCP Inspector against built server
npm run snapshots:build  # build local SQLite snapshots
npm run build:all        # tsc + ui bundle
```
