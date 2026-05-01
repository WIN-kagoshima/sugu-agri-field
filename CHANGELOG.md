# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-`1.0.0` releases are explicitly **experimental**: tool names, input/output schemas, resource URIs, and prompt names may change between minor versions.

## [Unreleased]

### Fixed — Cloud Build / Cloud Run deploy path
- `cloudbuild.yaml` now matches the runbook's `sugu-agri-runtime` service-account name and `sugu-mcp` Artifact Registry repository.
- Cloud Build deploys now pass production HTTP env vars (`SUGU_TRUST_PROXY`, rate-limit settings) and Secret Manager mappings (`SUGU_TOKEN_ENC_KEY`, `SESSION_COOKIE_SECRET`) instead of silently falling back to dev defaults.
- `deploy.yml` now passes `--project=$PROJECT_ID` explicitly to `gcloud builds submit` and forwards the required Secret Manager substitution names.
- `npm run deploy` now refuses unsafe one-command source deploys and directs operators to the runbook, avoiding accidental Cloud Run deployments without secrets or the hardened image path.
- `docs/runbook.md` now includes exact `sugu-session-cookie-secret` creation commands and uses the same `sugu-mcp` Artifact Registry repository as `cloudbuild.yaml`.

## [0.5.1] — Patch — release hardening + Cloud Run image fix

### Security
- Refreshed vulnerable development dependencies (`@modelcontextprotocol/inspector`, Vite, Vitest, `@vitejs/plugin-react`) so `npm audit --audit-level=high` reports `found 0 vulnerabilities`.

### Fixed
- Docker image now runs `npm run build:all` during the build stage, so Cloud Run images include `dist/ui/dashboard.html` instead of falling back to the MCP Apps UI placeholder.
- Docker runtime stage now copies `node_modules` from a production-only dependency stage (`npm ci --omit=dev`) instead of shipping dev/test tooling in the distroless runtime image.
- Replaced stale `pnpm build:ui` references in the dashboard UI placeholder and comments with `npm run build:ui`.

### Added — MCP Spec 2025-11-25 §6.10 ToolAnnotations
- Every registered tool now exposes the official `ToolAnnotations` block (`readOnlyHint`, `idempotentHint`, `openWorldHint`, `destructiveHint`) on `tools/list`, so MCP hosts can correctly decide whether to require user confirmation before invocation.
- `src/server/surface-catalog.ts` is the single source of truth: each tool entry carries an `annotations` field plus three reusable presets (`READ_ONLY`, `READ_ONLY_REMOTE`, `DRAFT_NON_IDEMPOTENT`).
- `getToolAnnotations(name)` helper throws if the catalog and registration drift apart.
- `tests/conformance/tool-annotations.test.ts` (3 new tests) verifies that (a) every live tool advertises a complete annotations object, (b) hints agree with the internal `sideEffect` classification, and (c) `openWorldHint=true` exactly for tools that touch the network (Open-Meteo, JMA).
- The Server Card (`/.well-known/mcp-server.json`) now embeds annotations alongside `sideEffect`, so registries see the same hints clients see.
- `.github/CODEOWNERS` for spec-touching code, security paths, data-licence files, and infra.
- `.github/FUNDING.yml` placeholder.

### Added — production sidecars
- **Graceful shutdown** (`src/server/lifecycle.ts`): SIGTERM triggers a 8 s drain window. `/healthz` flips to 503 once draining. Inflight requests get to finish before the listening socket closes, matching Cloud Run's 10 s grace period.
- **Per-IP token-bucket rate limiter** (`src/server/rate-limit.ts`): `/mcp` is bounded by `SUGU_RATE_RPS` / `SUGU_RATE_BURST`. Rejected requests return JSON-RPC error `-32429`, `Retry-After`, and `X-RateLimit-Limit` / `X-RateLimit-Remaining`.
- **Adapter-aware `/readyz` probe**: enumerates each registered adapter (weather / JMA / eMAFF / FAMIC) and returns 503 with per-adapter reason strings when any is missing. Distinct from `/healthz` (liveness) per CNCF readiness conventions.
- **Prometheus `/metrics` endpoint** (`src/server/metrics.ts`): zero-dependency exposition with counters (`mcp_requests_total`, `rate_limited_total`, `tool_calls_total`) and histograms (`tool_duration_ms`, `http_request_duration_ms`). Bearer-token gated when `SUGU_METRICS_BEARER` is set.
- **Tool result size cap** (`src/lib/tool-size.ts`): unbounded read tools (`search_farmland`, `area_summary`, `nearby_farms`, `get_pesticide_rules`) now fail closed with a structured `isError` if their JSON-serialised result exceeds 1 MiB, advising the model to lower `limit` or use `cursor` pagination.
- **`docs/runbook.md`**: end-to-end Cloud Run deploy procedure, env-var reference, SLO targets, incident triage flowchart, key rotation, snapshot rebuild, and disaster recovery RTO/RPO matrix.

### Added — earlier in this Unreleased window
- **`get_weather_warning` tool + `JmaWarningAdapter`**: surfaces active 警報・注意報 from the official JMA Disaster XML feed. Compliant with the Japan Meteorological Business Act: ≤10 minute cache, attribution baked into every response, no modification.
- **`FileTokenStore`**: AES-256-GCM encrypted file backend for `TokenStore`, with deterministic per-key filenames, atomic writes, scrypt-derived keys from `SUGU_TOKEN_ENC_PASSPHRASE`, or a raw 32-byte base64 key from `SUGU_TOKEN_ENC_KEY`. Refuses to start unless one is set.
- **X-Request-Id middleware**: Streamable HTTP now honours/echoes a stable per-request ID, plumbs it into `logger.child({ requestId })`, and surfaces it in error JSON-RPC `data.requestId`. Fulfils the contract that `safeErrorMessage` advertises ("report the request ID").
- `examples/` folder with three runnable clients: `stdio-typescript/` (`@modelcontextprotocol/sdk`), `stdio-python/` (`mcp[cli]`), and `http-curl/` (Bash + PowerShell scripts hitting `/mcp`).
- README badges: CI, CodeQL, OpenSSF Scorecard, npm version, Apache-2.0, Node ≥20, MCP Spec 2025-11-25, MCP Apps 2026-01-26.
- `.github/workflows/codeql.yml` (weekly + on PR) and `.github/workflows/scorecard.yml`.
- `npm audit signatures` step in CI (continues on error so missing provenance doesn't block PRs).
- `NOTICE` file documenting third-party data attribution (Open-Meteo, JMA, eMAFF, FAMIC).
- `.editorconfig` mirroring Biome formatter settings for non-Biome editors.
- `.npmignore` belt-and-suspenders to prevent dev artifacts leaking into npm tarballs.
- `docs/api-reference.md`: canonical reference for every model-visible / app-only tool, prompt, resource, error code, and `_meta` extension.
- `src/server/surface-catalog.ts`: single source of truth for tool / prompt / resource metadata (introduced version, side effect, visibility). The Server Card and conformance tests both read from this catalog.
- `tests/conformance/server-card.test.ts`: enforces that `.well-known/mcp-server.json` exactly matches the live `tools/list`, `prompts/list`, and `resources/list`. Phase 0 deployments without snapshots no longer falsely advertise farmland tools.
- `tests/smoke/http-security.test.ts`: spawns the real built server and confirms the Host header allowlist returns `421` for spoofed Host headers (DNS rebinding defense), and that legitimate `X-Request-Id` is reflected back.
- `tests/smoke/oauth-url-flow.test.ts`: full end-to-end `/connect` → mock authorize → `/callback` → token-store flow including session-cookie anti-phishing check.
- `tests/unit/{file-token-store,jma-warning,request-id}.test.ts`: 23 new unit tests covering encryption / tamper resistance, JMA feed parsing, and request-id middleware semantics.
- `tests/smoke/jma-tool.test.ts`: end-to-end MCP smoke for `get_weather_warning` including the disabled-adapter case.
- OSS scaffolding: `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.{yml,yaml}`, `CODE_OF_CONDUCT.md`, `.github/dependabot.yml`.
- `.github/workflows/release.yml`: tag-driven release with version-vs-tag check, full test suite, and GitHub Release publication. npm publish gated on a repo variable so it stays opt-in.

### Changed
- `startHttp()` now returns an `HttpServerHandle` (`stop()` / `isStopped()` / `port`) so the entry point can drive cooperative shutdown. `server.ts` calls `stopHttp()` before `server.close()` on SIGINT/SIGTERM.
- `createServer()` now returns `{ server, deps, surface }` so callers can build a Server Card that reflects the actually-registered surface, and instantiates a `JmaWarningAdapter` by default.
- `mountConnectHandler` requires `elicitationStore` and `tokenStore` arguments; `transport-http.ts` constructs process-singleton stores so URL elicitation flows complete across the per-request McpServer instances used by the stateless transport. Token store backend is auto-selected: `FileTokenStore` when an encryption key is configured, `InMemoryTokenStore` otherwise (with a warning).
- `package.json` `files`/`prepack`/`prepublishOnly`: only ship compiled `dist/`, the inlined `dashboard.html`, license metadata, and snapshot README. `prepack` builds both server + UI; `prepublishOnly` runs lint + typecheck + tests.
- `useAppBridge.hasHost` exposed; the dashboard renders an explicit standalone-preview banner when no MCP Apps bridge is detected.
- Server Card data sources now include the JMA Disaster XML feed entry.

### Fixed
- Anti-phishing check in `/connect/{provider}`: stores were never actually wired through, so the same-user verification was effectively a no-op. Now enforced + covered by integration test.


## [0.5.0] — Phase 5 — MCP Apps UI dashboard + comprehensive test suite

### Added
- `ui://sugu-agri/dashboard.html` resource: single-file React + MapLibre GL dashboard built with Vite + `vite-plugin-singlefile`.
- `open_dashboard` tool that returns `_meta.openWidget` for MCP Apps hosts and a structured-text fallback for others.
- App-only helper tools used by the UI (`fetch_field_geojson`, `fetch_weather_layer`, `select_field`, `list_prefectures`, `list_municipalities`, `search_operators`, `export_plan_csv`, `summarize_farmland`, `compute_ndvi_stub`).
- Standalone preview banner in the dashboard when no MCP Apps host bridge is detected (`useAppBridge.hasHost`).
- Conformance test suite (`tests/conformance/`):
  - `jsonrpc.test.ts` — serverInfo, capabilities, snake_case identifiers, JSON-Schema shape on every tool, safe error path on unknown tools.
  - `schemas.test.ts` — every tool's `inputSchema` is well-formed (`type:object` + properties + required[] consistency).
  - `secret-leakage.test.ts` — config secrets never leak through any catalog or tool result.
- Playwright UI smoke tests under `tests/ui/` exercising `dist/ui/dashboard.html` from `file://`.
- CI runs lint + typecheck + unit + smoke + conformance + secret-leakage grep + Inspector CLI smoke + Playwright UI as required jobs.

### Changed
- `useAppBridge` exposes `hasHost: boolean` so UI can render an explicit fallback banner.
- CI switched from pnpm to npm to match the actual lockfile in the repo.

## [0.4.0] — Phase 4 — Elicitation URL mode + OAuth

### Added
- `URLElicitationRequiredError` (`-32042`) for tools that require an external auth.
- `/connect/{provider}` HTTP handler with cookie-based same-user check before redirecting to OAuth.
- `notifications/elicitation/complete` notification on successful auth.
- Mock OAuth provider for local dev (`/__mock-oauth/*`).
- File-based encrypted token store under `.tokens/`.

## [0.3.0] — Phase 3 — Elicitation Form mode

### Added
- `create_staff_deploy_plan` (draft) tool that asks for `farm_selection` / `period_days` / `include_weekend` via Form elicitation when arguments are missing.
- `accept` / `decline` / `cancel` action handling and a fallback path for clients that do not support elicitation.

## [0.2.0] — Phase 2 — Prompts

### Added
- 5 user-controlled prompts: `field_summary`, `pesticide_advice`, `staff_deploy_plan`, `area_briefing`, `weather_risk_alert`.

## [0.1.0] — Phase 0 + Phase 1 — Core MCP server

### Added
- Initial release with stdio + Streamable HTTP transports.
- Tools: `get_weather_1km`, `search_farmland`, `area_summary`, `nearby_farms`, `get_pesticide_rules`.
- `.well-known/mcp-server.json` Server Card.
- eMAFF and FAMIC SQLite snapshot build pipeline under `scripts/build-snapshots/`.
- Cloud Run-ready Dockerfile and GitHub Actions deploy workflow.

[Unreleased]: https://github.com/WIN-kagoshima/sugu-agri-field/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/WIN-kagoshima/sugu-agri-field/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/WIN-kagoshima/sugu-agri-field/releases/tag/v0.5.0
[0.4.0]: https://github.com/WIN-kagoshima/sugu-agri-field/releases/tag/v0.4.0
[0.3.0]: https://github.com/WIN-kagoshima/sugu-agri-field/releases/tag/v0.3.0
[0.2.0]: https://github.com/WIN-kagoshima/sugu-agri-field/releases/tag/v0.2.0
[0.1.0]: https://github.com/WIN-kagoshima/sugu-agri-field/releases/tag/v0.1.0
