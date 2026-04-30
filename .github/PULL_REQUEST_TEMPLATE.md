<!-- Thanks for contributing! Please answer every question.
     Anything left blank delays review. -->

## Summary

<!-- One paragraph: what does this change do, and why? -->

## Phase / scope

- [ ] Phase 0–1 (transport, weather, farmland, pesticide tools)
- [ ] Phase 2 (prompts)
- [ ] Phase 3–4 (elicitation Form / URL + OAuth)
- [ ] Phase 5 (MCP Apps UI dashboard)
- [ ] Tests / CI / docs only

## Public-surface impact (CRITICAL)

- [ ] No tool / prompt / resource name changed.
- [ ] No tool input or output schema changed.
- [ ] No `.well-known/mcp-server.json` field changed.

If any of the above is checked off as **false**, this PR also:

- [ ] Bumps `package.json` version (and CHANGELOG.md) following SemVer (pre-1.0 = minor).
- [ ] Updates `.well-known/mcp-server.json` (`src/server/well-known.ts` + `src/server/surface-catalog.ts`).
- [ ] Updates `docs/api-reference.md`.
- [ ] Has been agreed on by at least one other maintainer (please tag them below).

## Data sources

- [ ] No new external data source.
- [ ] If a new data source: it's added to `docs/data-license.md` AND `.well-known/mcp-server.json` `data_sources` AND a unit test asserts attribution is non-empty.

## Tests

- [ ] Unit tests added or updated under `tests/unit/`.
- [ ] Smoke / integration tests added or updated under `tests/smoke/` if behaviour changed.
- [ ] Conformance tests still pass (`npm test`).
- [ ] If UI changed: Playwright tests pass (`npm run test:ui`).

## Security checklist

- [ ] No secrets, OAuth tokens, or PII appear in tool output, logs, errors, or the UI bundle.
- [ ] Error paths use `safeErrorMessage` — no stack traces or raw upstream payloads.
- [ ] Bounded results: any new list tool has `limit` (default 20, max 100) + `cursor`.
- [ ] If a tool is mutating or destructive, it is explicitly tagged in `surface-catalog.ts` and called out in the description.

## Reviewer notes

<!-- Anything tricky, design decisions, links to discussions or specs. -->
