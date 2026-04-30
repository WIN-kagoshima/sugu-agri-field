# API reference — SuguAgriField MCP

This document is the canonical, machine-checkable contract for everything
this server exposes. The matching machine-readable version lives at
`/.well-known/mcp-server.json`. If the two disagree, file an issue — the
[`tests/conformance/server-card.test.ts`](../tests/conformance/server-card.test.ts)
suite is supposed to keep them in sync.

> Pre-`1.0.0`: tool/prompt/resource names and argument shapes can change
> between minor versions. Always pin a minor in production.

---

## Table of contents

1. [Visibility & side-effect taxonomy](#1-visibility--side-effect-taxonomy)
2. [Model-visible tools](#2-model-visible-tools)
3. [App-only tools (UI-driven)](#3-app-only-tools-ui-driven)
4. [Prompts](#4-prompts)
5. [Resources](#5-resources)
6. [Error codes](#6-error-codes)
7. [`_meta` extensions](#7-_meta-extensions)
8. [Capability negotiation & fallbacks](#8-capability-negotiation--fallbacks)

---

## 1. Visibility & side-effect taxonomy

| Field | Values | Meaning |
|---|---|---|
| **Visibility** | `model` / `app` | `model` tools are listed in `tools/list` for LLMs. `app` tools carry `visibility: ["app"]` in `_meta` and are intended for the MCP Apps UI bundle to call directly via `bridge.callTool` — they should not show up in normal model context. |
| **Side effect** | `read-only` / `draft` / `mutating` / `destructive` | `read-only` is the default. `draft` returns a structured plan that the LLM should present back for confirmation before any external action is taken. `mutating` and `destructive` are not used in Phase 0–5; the server card explicitly lists `mutating: false`. |
| **Bounded results** | required | Default `limit` is 20, hard max 100. List tools accept a `cursor` for forward-only pagination. |
| **Attribution** | required | Every tool result that includes external data MUST populate `structuredContent.attribution` so the LLM can cite the source. |

---

## 2. Model-visible tools

The seven tools below are exposed via `tools/list` and are the LLM's primary
surface. Their input schemas are JSON Schema (Draft 2020-12); see
[`src/tools/`](../src/tools/) for the canonical Zod definitions that
generate them.

### `get_weather_1km` — Phase 0, read-only

Hourly weather forecast at the given (lat, lng). Open-Meteo upstream,
1-hour cache, CC-BY 4.0 attribution.

| Field | Type | Notes |
|---|---|---|
| `lat` | `number` | Required. WGS84, `-90..90`. |
| `lng` | `number` | Required. WGS84, `-180..180`. |
| `hours` | `integer` | Optional, default 24, max 168 (7 days). |
| `timezone` | `string` | Optional IANA TZ. Defaults to `Asia/Tokyo`. |

`structuredContent`:

```jsonc
{
  "lat": 31.59,
  "lng": 130.55,
  "timezone": "Asia/Tokyo",
  "hourly": [{ "time": "...", "temperature": 20.1, "precipitationMm": 0, "windMs": 2, "humidityPct": 55 }],
  "attribution": "Weather data by Open-Meteo.com (CC-BY 4.0)"
}
```

### `search_farmland` — Phase 1, read-only

Search eMAFF Fude polygons by prefecture, municipality, or registered
crop. Snapshot-backed; works offline once the SQLite is built.

| Field | Type | Notes |
|---|---|---|
| `prefectureCode` | `string` | Optional, ISO 3166-2:JP (e.g. `JP-46`). |
| `municipalityCode` | `string` | Optional. |
| `cropKeyword` | `string` | Optional, ILIKE match against registered crop. |
| `limit` | `integer` | Default 20, max 100. |
| `cursor` | `string` | Optional, opaque pagination cursor. |

### `area_summary` — Phase 1, read-only

Aggregate farmland statistics over a polygon or admin code: count, total
area in m², top crops, mean field size.

| Field | Type | Notes |
|---|---|---|
| `prefectureCode` | `string` | Optional. Use either this or `polygon`, not both. |
| `polygon` | `[number, number][]` | Optional. WGS84 lat/lng pairs, ≥3 vertices, must close. |

### `nearby_farms` — Phase 1, read-only

Farmland centroids within `radiusMeters` of a centroid. R*Tree-indexed.

| Field | Type | Notes |
|---|---|---|
| `lat` | `number` | Required, WGS84. |
| `lng` | `number` | Required, WGS84. |
| `radiusMeters` | `integer` | Required, `1..10000`. |
| `limit` | `integer` | Default 20, max 100. |

### `get_pesticide_rules` — Phase 1, read-only

FAMIC pesticide registrations applicable to a (`crop`, `pestOrDisease`)
pair. Returns active ingredients, dose limits, pre-harvest interval, and
maximum applications per season.

| Field | Type | Notes |
|---|---|---|
| `crop` | `string` | Required. Japanese or English crop name. |
| `pestOrDisease` | `string` | Optional. |
| `limit` | `integer` | Default 20, max 100. |

### `create_staff_deploy_plan` — Phase 3, **draft**

Generates a non-binding draft staff deployment plan. If
`farmRegion` / `periodDays` / `includeWeekend` are missing, the tool
**elicits** them via Form mode (Spec 2025-11-25 elicitation primitive).
Returns `{ status: "draft", actions: [...] }` regardless of host
elicitation support — clients without elicitation see a fallback message
plus default values they can override on the next call.

### `open_dashboard` — Phase 5, read-only

Returns a tool result whose `_meta.openWidget` and
`_meta["openai/outputTemplate"]` point to `ui://sugu-agri/dashboard.html`.
Hosts that support MCP Apps render the React dashboard inline; others
receive a structured-content text summary so the LLM still has something
useful to say.

---

## 3. App-only tools (UI-driven)

These nine tools carry `_meta.visibility: ["app"]` and are filtered out
of the LLM-facing `tools/list` view by hosts that respect the hint. They
are called by the dashboard bundle via `window.mcpApps.callTool`.

| Name | Side effect | Purpose |
|---|---|---|
| `fetch_field_geojson` | read-only | Returns farmland point features within a bbox. |
| `fetch_weather_layer` | read-only | Returns a single weather metric (`temperature` / `precipitation` / `wind`) at lat/lng. |
| `select_field` | read-only | Returns a single field's centroid + area + registered crop. |
| `list_prefectures` | read-only | Static lookup for the prefecture picker. |
| `list_municipalities` | read-only | Municipalities under a prefecture. |
| `search_operators` | read-only | Stub: not bundled with sample data; returns `[]` until you wire your own roster source. |
| `summarize_farmland` | read-only | Bbox-bounded summary used for the dashboard side panel. |
| `compute_ndvi_stub` | read-only | Deterministic NDVI placeholder until Phase 7+ satellite integration. |
| `export_plan_csv` | read-only | Renders a CSV from a draft plan; returns `text/csv` content. |

---

## 4. Prompts

All prompts are **user-controlled** (`MUST NOT auto-fire`). Surface them
through your host's slash-command UI and let the user accept arguments.

| Slash command | Required arguments | Optional |
|---|---|---|
| `/field_summary` | `field_id` | — |
| `/pesticide_advice` | `crop`, `pest_or_disease` | `region` |
| `/staff_deploy_plan` | `farm_ids[]`, `period` | `weekday_only` |
| `/area_briefing` | `prefecture` | `season` |
| `/weather_risk_alert` | `farm_ids[]` | `lookahead_hours` |

Each prompt returns a single `messages: [{ role: "user", content: ... }]`
template that the host renders into the user's draft. None of the
prompts call tools directly — that's the LLM's job once the prompt is
materialised.

---

## 5. Resources

| URI | MIME | Phase | Notes |
|---|---|---|---|
| `ui://sugu-agri/dashboard.html` | `text/html` | 5 | Single-file React + MapLibre GL bundle. ~960 KB raw, ~270 KB gzip. Loaded by `open_dashboard` and any MCP Apps host. |

The server intentionally does NOT register `data://emaff/{fieldId}` or
similar `data://` resources. eMAFF / FAMIC are only exposed via tools so
that bounded results, attribution, and pagination are uniformly enforced.

---

## 6. Error codes

Tool errors surface as either:

1. A JSON-RPC error with code `-32602` (`Invalid params`) when the SDK
   detects a Zod schema mismatch *before* the handler runs. The client
   sees `Invalid arguments: <field> ...`.
2. A successful response with `isError: true` and a single `text` content
   block, when the handler caught a known error. **Never** a stack trace.

The `safeErrorMessage` helper in [`src/lib/errors.ts`](../src/lib/errors.ts)
maps internal errors to safe surface text:

| Internal code | Surface text | Class |
|---|---|---|
| `validation_error` | `Invalid input: <reason>` | `ValidationError` |
| `not_found` | `<resource> not found: <id>` | `NotFoundError` |
| `unauthorized` | `Authorization is required for this operation.` | `AuthError` |
| `rate_limited` | `Rate limit reached. Try again in ~Ns.` | `RateLimitError` |
| `upstream_error` | `Upstream data source temporarily unavailable (<source>). Please retry later.` | `UpstreamError` |
| (anything else) | `Internal error. Please retry, and report the request ID if it persists.` | — |

`URLElicitationRequiredError` (`-32042`) is a distinct JSON-RPC error
from the elicitation extension; tools that need an OAuth-gated resource
throw it with the elicitation ID and the `/connect/{provider}` URL.

---

## 7. `_meta` extensions

| Key | Where | Purpose |
|---|---|---|
| `visibility` | tool | `["app"]` hides the tool from LLM context (Phase 5). |
| `openWidget` | tool result | MCP Apps Extension 2026-01-26: opens a registered `ui://...` resource in the host. |
| `openai/outputTemplate` | tool result | OpenAI/ChatGPT Apps mirror of `openWidget` for hosts that prefer the OpenAI key. |
| `attribution` (in `structuredContent`) | tool result | License attribution string. Required when the result contains upstream data. |

The server never sets `_meta` keys outside this list. Any other keys
returned by an upstream are stripped before forwarding to the client.

---

## 8. Capability negotiation & fallbacks

The server advertises:

```jsonc
{
  "tools":     { "listChanged": true },
  "prompts":   { "listChanged": true },
  "resources": { "listChanged": true, "subscribe": false },
  "logging":   {}
}
```

The server itself does NOT require any client capabilities. Specifically:

- **No elicitation?** `create_staff_deploy_plan` falls back to returning
  a draft plan with default values plus a hint that the user should
  resend with explicit arguments.
- **No MCP Apps?** `open_dashboard` falls back to a structured-content
  text summary; the dashboard URL is *not* shipped to the LLM as a raw
  link to avoid prompt-injection vectors.
- **No `roots`?** Not used in this server.
- **No `sampling`?** Not used in this server.

This means SuguAgriField MCP works out-of-the-box against any
spec-compliant client, including stripped-down stdio shells.
