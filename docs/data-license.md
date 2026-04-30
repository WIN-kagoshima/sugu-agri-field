# Data licensing

Every data source consumed by SuguAgriField MCP has a documented license.
This document is the canonical reference; `.well-known/mcp-server.json` and
`.cursor/rules/06-data-license.mdc` derive from it.

## In-scope sources (Phase 0–5)

| Source | License | Redistribution | Caching | Attribution required | How we use it |
|---|---|---|---|---|---|
| **Open-Meteo** | CC-BY 4.0 | Allowed | 1 hour cache | Yes — "Weather data by Open-Meteo.com (CC-BY 4.0)" | Live API, weather adapter at `src/adapters/weather/open-meteo.ts`. The attribution string is included in every tool result via `structuredContent.attribution`. |
| **eMAFF Fude Polygon** | Public open data (政府統計の総合窓口 e-Stat / open.fude.maff.go.jp) | Allowed | OK | Yes — "Source: 農林水産省 eMAFF 筆ポリゴン" | Built locally into `snapshots/emaff-fude-kagoshima.sqlite` by `scripts/build-snapshots/build-emaff.ts`. The SQLite file is **not** redistributed via the npm package; users build it themselves from the official portal. |
| **FAMIC pesticide registrations** | Public open data (FAMIC 農薬登録情報) | Allowed | OK | Yes — "Source: FAMIC 農薬登録情報" | Built locally into `snapshots/famic-pesticide-2026.sqlite` by `scripts/build-snapshots/build-famic.ts`. Same redistribution stance as eMAFF. |
| **JMA disaster XML feed** | Japan Meteorological Business Act | Conditional | Short cache only (≤10 min) | Yes — "気象庁 + 発表時刻 + 改変有無" | **Phase 1+ optional.** Live API; never bundled in the package. If you build a JMA adapter, ensure the cache TTL is bounded as required by the Act. |

## Out-of-scope sources (NOT in this OSS release)

| Source | License | Status |
|---|---|---|
| **WAGRI** | Member agreement | Phase 7+ only. Redistribution prohibited; only allowed via an authenticated user-token flow. Do not commit any WAGRI sample data, response schema, or recorded HTTP fixtures to this repository. |
| **Sentinel-2 / SAGRI** | Various | Phase 7+ only. The current `compute_ndvi_stub` tool is a deterministic placeholder. |

## Operational requirements

1. **Adapters must populate `attribution`.** Every adapter's result type carries
   an `attribution: string` field. The tool layer copies it into
   `structuredContent.attribution` and into a `content[]` text entry, so the
   LLM can quote it when summarising the data to end users.
2. **The MCP Apps UI must display attribution near the data.** The dashboard
   shows attribution in the map footer and in the weather overlay tooltip.
3. **Adding a new data source requires four updates:** this document,
   `.well-known/mcp-server.json` `data_sources`, the adapter implementation
   with `attribution`, and a unit test asserting `attribution` is non-empty.
   PRs missing any of the four are closed.

## Revisions

When the upstream license of a source changes, log the change here with the
date. Do not silently update the cell.

| Date | Source | Change |
|---|---|---|
| 2026-04-15 | Open-Meteo | Initial entry: CC-BY 4.0. |
| 2026-04-15 | eMAFF | Initial entry: open data. |
| 2026-04-15 | FAMIC | Initial entry: open data. |
