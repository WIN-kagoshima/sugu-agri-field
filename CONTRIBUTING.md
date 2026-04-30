# Contributing to SuguAgriField MCP

Thanks for considering a contribution. This project is a public reference implementation of MCP, so we hold the bar high on **spec correctness** and **operational safety**.

## Before you open an issue or PR

- Read [AGENTS.md](./AGENTS.md). It applies to humans too.
- Check if your change concerns Phase 0–5 (in scope) or Phase 6+ (not in this repo yet).
- Make sure your change is compatible with the official MCP spec at <https://modelcontextprotocol.io/specification/latest>.

## Workflow

1. Fork and create a topic branch off `main`.
2. Add tests under `tests/unit`, `tests/smoke`, or `tests/conformance` first.
3. Run locally:
   ```bash
   npm install
   npm run lint
   npm run typecheck
   npm test
   ```
4. Update `CHANGELOG.md` (Keep a Changelog format).
5. Open a PR with a description that answers:
   - Which phase does this affect?
   - Does the public surface (tool names, input/output schemas, resource URIs, prompt names) change? If yes, is it backwards compatible?
   - Did you update `.well-known/mcp-server.json`?
6. Wait for two maintainer approvals on changes that touch the public surface.

## Coding standards

- TypeScript ESM, Node 20+, NodeNext module resolution.
- Lint and format with Biome (`npm run lint`).
- No `any` without a justifying comment.
- All tool inputs validated with Zod at the boundary.
- All tool outputs return `content: [{ type: "text", ... }]` plus optional `structuredContent`.
- Error paths must not leak stack traces, secrets, or internal SQL/HTTP details.

## Tool design (mandatory)

See `.cursor/rules/03-mcp-tool-rules.mdc`. Briefly:

- Names are stable and snake_case verb_noun.
- Inputs default to a small set; use `limit` (default 20, max 100) and `cursor` for pagination.
- Mark side effects: `read-only` / `draft` / `mutating` / `destructive`.
- Provide `_meta.openWidget` for tools whose primary surface is the UI dashboard.

## Data licensing rule

Adding a new data source requires:

1. An entry in [docs/data-license.md](docs/data-license.md) that states redistribution rights, caching policy, and attribution.
2. An adapter under `src/adapters/` that respects those rules at runtime.
3. An update to `.well-known/mcp-server.json` `data_sources`.

PRs that add data sources without these three updates will be closed.

## Maintainer ladder

- **Triager** — labels and routes issues, no merge rights.
- **Reviewer** — can approve PRs but not merge.
- **Maintainer** — merge rights, with the constraint that any change to the public surface needs a second maintainer approval.
- **Lead Maintainer** — release manager, final say on spec interpretation.

To advance you need three sustained months at the previous level and a recommendation from a Lead Maintainer.

## Code of conduct

Be respectful and concise. Disagreements are settled by reading the spec, not by tone.

## License

By contributing you agree to license your contribution under Apache-2.0.
