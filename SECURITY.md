# Security Policy

## Supported versions

Until `1.0.0`, only the latest minor version receives security patches. After `1.0.0` we will publish an explicit table.

| Version | Status |
|---|---|
| `0.5.x` | Supported (latest) |
| `0.4.x` and earlier | Best effort only |

## Reporting a vulnerability

**Please do not open a public GitHub issue.**

Email `security@agriops.dev` (placeholder — replace with your real reporting address before publishing) with:

- A description of the issue.
- Steps to reproduce, ideally with a minimal MCP client transcript.
- The version (`package.json` `version`) and transport (`stdio` or `streamable-http`) where you observed it.
- Any suggested mitigation.

We will acknowledge within 3 business days and aim to ship a fix or a documented mitigation within 30 days.

## Hardening notes for operators

- Run the server under a least-privilege OS user. The server only needs read access to the `snapshots/` SQLite files.
- For Streamable HTTP, restrict the public origin via `MCP_BASE_URL` and the built-in DNS rebinding protection.
- Never expose the `/connect/{provider}` endpoint to the public internet without TLS.
- Token store: when running with the URL-mode elicitation flow enabled, set `AGRIOPS_TOKEN_ENC_KEY` (32-byte base64) or `AGRIOPS_TOKEN_ENC_PASSPHRASE` to use the AES-256-GCM `FileTokenStore`. Without either the server falls back to the in-memory store and logs a warning at startup. For Cloud Run, inject the key from Secret Manager via the runtime service account; never put it in plain Cloud Run env vars in production.
- Open-Meteo and FAMIC do not require keys; if a future paid tier is enabled, keep keys in environment variables only and never log or echo them in tool output.
