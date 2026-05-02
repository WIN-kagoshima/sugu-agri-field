# AgriOps MCP — Operator runbook

This document is the source of truth for deploying, operating, and
incident-responding the AgriOps MCP server on Google Cloud Run.

It is opinionated: pieces marked **REQUIRED** are non-negotiable for a
production-grade rollout; pieces marked **OPTIONAL** can be deferred to
later phases.

---

## 1. Pre-flight

| Item | Status | Notes |
| --- | --- | --- |
| GCP project & billing account | REQUIRED | Use a dedicated project — Cloud Run, Secret Manager, Cloud Build, Artifact Registry, Cloud Logging are all enabled per project. |
| Domain + TLS cert | REQUIRED | Register `MCP_BASE_URL` (e.g. `https://mcp.agriops.example.com`) and provision a managed cert via Cloud Run domain mapping or Global Load Balancer. |
| GitHub repo with branch protection | REQUIRED | `main` only via PR + CI green. The `release.yml` workflow gates artifacts on the same. |
| Node.js 20 + npm locally | REQUIRED | `node --version` ≥ 20.0 and `npm --version` ≥ 10. |

**Do NOT** run the production server with the in-memory `TokenStore`.
The encrypted `FileTokenStore` is the minimum bar; for multi-instance
serverless, swap it for a Memorystore / Cloud SQL backend.

---

## 2. First-time deploy (golden path)

Before creating resources, run the automated preflight check. It verifies the
active gcloud account, billing, required APIs, Artifact Registry, runtime service
account, Secret Manager entries, optional GCS snapshot objects, and whether the
Cloud Run service already exists. Failed checks print copy-pasteable fix
commands.

```bash
PROJECT=agriops-prod
SNAPSHOT_BUCKET=mcp-win-agriops-snapshots
npm run deploy:preflight -- --project=${PROJECT} --snapshot-bucket=${SNAPSHOT_BUCKET}
```

Least-privilege CI deployers can add `--skip-billing` because billing state is
an operator-owned project setup check, not a per-deploy permission.

### 2.1 Create the runtime service account

```bash
PROJECT=agriops-prod
SA=agriops-runtime@${PROJECT}.iam.gserviceaccount.com

gcloud iam service-accounts create agriops-runtime \
  --display-name="AgriOps MCP runtime" \
  --project=${PROJECT}

# Logging + monitoring
gcloud projects add-iam-policy-binding ${PROJECT} \
  --member=serviceAccount:${SA} --role=roles/logging.logWriter
gcloud projects add-iam-policy-binding ${PROJECT} \
  --member=serviceAccount:${SA} --role=roles/monitoring.metricWriter
```

### 2.2 Mint and store the token-encryption key

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" \
  | gcloud secrets create agriops-token-enc-key --data-file=- --project=${PROJECT}

gcloud secrets add-iam-policy-binding agriops-token-enc-key \
  --member=serviceAccount:${SA} \
  --role=roles/secretmanager.secretAccessor \
  --project=${PROJECT}
```

Repeat for `agriops-session-cookie-secret` (32 bytes hex):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" \
  | gcloud secrets create agriops-session-cookie-secret --data-file=- --project=${PROJECT}

gcloud secrets add-iam-policy-binding agriops-session-cookie-secret \
  --member=serviceAccount:${SA} \
  --role=roles/secretmanager.secretAccessor \
  --project=${PROJECT}
```

### 2.3 Build & deploy

```bash
gcloud artifacts repositories create agriops-mcp \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="AgriOps MCP images" \
  --project=${PROJECT}

gcloud builds submit \
  --config cloudbuild.yaml \
  --project=${PROJECT} \
  --gcs-source-staging-dir="gs://${PROJECT}_cloudbuild/source" \
  --substitutions=_MCP_BASE_URL=https://mcp.agriops.example.com
# NOTE: deliberately omit --region for `builds submit`. Regional Cloud Build
# uses gs://${PROJECT}_${REGION}_cloudbuild as the staging bucket, which org
# policy and least-privilege deployer SAs may not own. Global Cloud Build
# reuses gs://${PROJECT}_cloudbuild that we already configured. Cloud Run
# itself is still deployed in asia-northeast1 because cloudbuild.yaml passes
# --region=$_REGION to `gcloud run deploy`.

gcloud run deploy agriops-mcp \
  --image=asia-northeast1-docker.pkg.dev/${PROJECT}/agriops-mcp/agriops-mcp:latest \
  --region=asia-northeast1 \
  --service-account=${SA} \
  --min-instances=0 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --concurrency=80 \
  --timeout=60s \
  --set-env-vars=MCP_BASE_URL=https://mcp.agriops.example.com,LOG_LEVEL=info,AGRIOPS_TRUST_PROXY=1,AGRIOPS_RATE_RPS=15,AGRIOPS_RATE_BURST=45 \
  --set-secrets=AGRIOPS_TOKEN_ENC_KEY=agriops-token-enc-key:latest,SESSION_COOKIE_SECRET=agriops-session-cookie-secret:latest \
  --project=${PROJECT}
```

The deployed service is private by default. Grant `roles/run.invoker` only to
the deployer, monitor, or client identities that need to call it.

### 2.4 Smoke test the deploy

```bash
BASE=https://mcp.agriops.example.com
curl -sS ${BASE}/healthz | jq .
curl -sS ${BASE}/livez | jq .   # Equivalent liveness alias for Cloud Run smoke tests.
curl -sS ${BASE}/readyz  | jq .
curl -sS ${BASE}/.well-known/mcp-server.json | jq '.tools'

# Initialize an MCP session
curl -sS ${BASE}/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"runbook","version":"1"}}}' \
  | jq .
```

All four MUST succeed. If `/readyz` is `not_ready`, snapshots are
missing — see §6.2.

You can run the same checks with the bundled smoke-test script:

```bash
npm run deploy:smoke -- --base-url=${BASE} --allow-not-ready
```

Use `--allow-not-ready` only before eMAFF/FAMIC snapshots are present. Remove it
for production readiness gates.

If Cloud Run is protected by IAM, pass an identity token:

```bash
TOKEN=$(gcloud auth print-identity-token)
npm run deploy:smoke -- --base-url=${BASE} --allow-not-ready --auth-bearer=${TOKEN}
```

If your Google Cloud organization intercepts `/healthz`, use the equivalent
`/livez` liveness alias:

```bash
npm run deploy:smoke -- --base-url=${BASE} --health-path=/livez --allow-not-ready --auth-bearer=${TOKEN}
```

### 2.5 GitHub Actions deploy setup

The GCP side is configured for GitHub OIDC / Workload Identity Federation. Add
these repository or environment secrets in GitHub:

| Secret | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `mcp-win` |
| `GCP_WIF_PROVIDER` | `projects/805887969415/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `agriops-github-deployer@mcp-win.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `agriops-runtime@mcp-win.iam.gserviceaccount.com` |
| `MCP_BASE_URL` | `https://agriops-mcp-n5vdix22hq-an.a.run.app` |
| `SNAPSHOT_BUCKET` | `mcp-win-agriops-snapshots` |

The deploy workflow runs Cloud Build and then executes `npm run deploy:smoke`
with an identity token. Because organization policy currently blocks
`allUsers`, the deployer service account has `roles/run.invoker` on the Cloud
Run service. Cloud Build restores SQLite snapshots from `SNAPSHOT_BUCKET` before
building the container, so GitHub Actions deploys do not depend on ignored local
files being present in the checkout.

> When pasting these secrets into the GitHub UI, make sure there is **no
> trailing newline**. The deploy workflow trims whitespace and CR/LF defensively,
> but a literal `\n` in `GCP_PROJECT_ID` will still propagate to log lines such
> as `[***\n] is not a valid project ID.` until you re-save the secret.

#### Required IAM on `SNAPSHOT_BUCKET`

The deployer service account needs only object-level access to read the snapshots
during Cloud Build. The minimum binding is:

```bash
gcloud storage buckets add-iam-policy-binding gs://${SNAPSHOT_BUCKET} \
  --member="serviceAccount:agriops-github-deployer@${PROJECT}.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer
```

`deploy:preflight` will warn (but not fail) if `storage.buckets.get` is missing
on the bucket. To silence that warning, optionally grant `roles/storage.legacyBucketReader`
on the bucket as well — it is *not* required for deploys to succeed.

---

## 3. Day-2 operations

### 3.1 Endpoints

| Path | Purpose | Probe interval |
| --- | --- | --- |
| `/healthz` | Liveness. 200 while running, 503 while draining. | 5 s |
| `/readyz` | Readiness. 200 only when all required adapters are present. | 5 s (LB), 30 s (uptime check) |
| `/metrics` | Prometheus exposition. Bearer-token gated. | 30 s scrape |
| `/.well-known/mcp-server.json` | Public Server Card. | (registry-driven) |
| `/mcp` | Streamable HTTP MCP transport. | (client-driven) |
| `/connect/{provider}` | Phase 4 OAuth URL elicitation start. | (user-driven) |
| `/callback/{provider}` | Phase 4 OAuth callback. | (provider-driven) |

### 3.1.1 Synthetic monitoring

Because `mcp-win` currently blocks `allUsers`, uptime checks must authenticate.
The project has a Cloud Scheduler HTTP job:

- Job: `agriops-mcp-livez`
- Schedule: every 5 minutes
- Target: `https://agriops-mcp-n5vdix22hq-an.a.run.app/livez`
- Auth service account: `agriops-monitor@mcp-win.iam.gserviceaccount.com`

Deployment-time deep checks are handled by `.github/workflows/deploy.yml`, which
runs `npm run deploy:smoke` against `/livez`, `/readyz`, Server Card, and MCP
`initialize`.

### 3.2 Configuration knobs (env vars)

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | Cloud Run sets this automatically. |
| `MCP_BASE_URL` | (required) | Public URL clients reach the server at. Used in Server Card and OAuth redirects. |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`. |
| `AGRIOPS_TRUST_PROXY` | `1` | Hops to trust for `req.ip` / X-Forwarded-For. Cloud Run = `1`. |
| `AGRIOPS_RATE_RPS` | `10` | Per-IP token refill rate. |
| `AGRIOPS_RATE_BURST` | `30` | Per-IP burst capacity. |
| `AGRIOPS_METRICS_BEARER` | (unset) | Bearer token gating `/metrics`. Leave unset for private-network scraping; set when scraping over the public ingress. |
| `AGRIOPS_TOKEN_ENC_KEY` | (unset) | 32-byte AES-256 key (base64). Required for production OAuth use. |
| `AGRIOPS_TOKEN_ENC_PASSPHRASE` | (unset) | Alternate to `AGRIOPS_TOKEN_ENC_KEY`; scrypt-derived key. |
| `AGRIOPS_TOKEN_DIR` | `./.tokens` | Where the encrypted token files live. |
| `SESSION_COOKIE_SECRET` | (required for HTTP) | Signs the anti-phishing session cookie. |
| `EMAFF_SNAPSHOT_PATH` | `./snapshots/emaff-fude-kagoshima.sqlite` | Phase 1 farmland snapshot. |
| `FAMIC_SNAPSHOT_PATH` | `./snapshots/famic-pesticide-2026.sqlite` | Phase 1 pesticide snapshot. |

### 3.3 Logging

JSON Lines on stderr, one event per line. Every HTTP request is tagged
with a stable `requestId` (echoed as `X-Request-Id` and included in
JSON-RPC error `data.requestId`). Filter by request ID in Cloud Logging:

```log
jsonPayload.requestId="<UUID>"
```

### 3.4 Metrics

`/metrics` exposes (with default labels `service`, `version`):

- `mcp_requests_total{}` — counter.
- `rate_limited_total{}` — counter.
- `tool_calls_total{tool, outcome}` — counter.
- `tool_duration_ms{tool}` — histogram.
- `http_request_duration_ms{route, status}` — histogram.

Recommended Cloud Monitoring SLOs:

| SLO | Target | Window |
| --- | --- | --- |
| `/mcp` 5xx error rate | < 0.5 % | 30 d |
| `tools/call` p99 latency | < 2.5 s | 7 d |
| `/readyz` available | ≥ 99.9 % | 30 d |

---

## 4. Incident response

### 4.1 Triage flowchart

1. Is the service reachable? `curl /healthz` and `curl /readyz`.
   - 503 from `/healthz`: deploy is in shutdown — wait 30 s for the
     next instance, then check Cloud Run revision health.
   - 503 from `/readyz`: an adapter is broken — see §6.
2. Are clients reporting 429? Check `rate_limited_total` rate. Tune
   `AGRIOPS_RATE_RPS` / `AGRIOPS_RATE_BURST`, or migrate to a Memorystore
   limiter for cross-instance fairness.
3. Are clients reporting 500 with a `requestId`? Pull logs by
   `jsonPayload.requestId="<id>"` and look at the most-recent
   `error` entry in that request's chain.
4. Spec violations? Run the conformance suite locally against the
   deployed URL (see §5).

### 4.2 Common errors

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 421 Misdirected Request | DNS rebinding allowlist mismatch | Set `MCP_BASE_URL` to the exact public URL Cloud Run serves at. |
| 503 from `/readyz` with `emaff` / `famic` ok=false | Snapshot missing in container | Rebuild image with `npm run snapshots:build` first, or mount snapshots from GCS. |
| 401 from `/metrics` | Wrong / missing `AGRIOPS_METRICS_BEARER` | Update Prometheus job's bearer token. |
| Tool returns "safety cap" error | Single tool produced > 1 MiB JSON | Lower `limit`, narrow filters, or paginate via `cursor`. |
| Rate-limit warnings on legitimate user | Single IP hosting many users | Migrate to a per-user limit keyed off OAuth `sub`, not IP. |

### 4.3 Rollback

Cloud Run revisions are immutable. Rollback = retarget traffic to a
prior revision:

```bash
gcloud run services update-traffic agriops-mcp \
  --to-revisions=agriops-mcp-00012-abc=100 \
  --region=asia-northeast1 \
  --project=${PROJECT}
```

Always pair a rollback with a follow-up Postmortem ticket.

---

## 5. Conformance & supply-chain

Before every release:

```bash
npm ci
npm run lint
npm run typecheck
npm test            # unit + smoke + conformance + secret-leakage
npm run test:ui     # Playwright dashboard tests
npm run inspector   # interactive verification
npm pack --dry-run  # verify tarball contents
```

CI runs all of the above plus CodeQL and OSSF Scorecard on a weekly
schedule. The release workflow re-runs everything on the tag.

---

## 6. Routine maintenance

### 6.1 Token-encryption key rotation

1. Generate a new key:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" \
     | gcloud secrets versions add agriops-token-enc-key --data-file=- --project=${PROJECT}
   ```
2. Roll the Cloud Run revision (no env-var change; Secret Manager auto-reads `:latest`):
   ```bash
   gcloud run services update agriops-mcp --region=asia-northeast1 \
     --update-secrets=AGRIOPS_TOKEN_ENC_KEY=agriops-token-enc-key:latest \
     --project=${PROJECT}
   ```
3. **Existing tokens become unreadable** with the new key. The store
   treats them as absent; users will re-elicit. Communicate the
   maintenance window first.

For zero-downtime rotation, switch to the (planned) two-key
`FileTokenStore` mode (`AGRIOPS_TOKEN_ENC_KEY_PRIMARY` +
`AGRIOPS_TOKEN_ENC_KEY_SECONDARY`) when it ships.

### 6.2 Snapshot rebuild

eMAFF and FAMIC are rebuilt quarterly. The pipeline is reproducible:

```bash
npm run snapshots:build
```

Inputs:

- eMAFF: complete the official questionnaire on https://open.fude.maff.go.jp/,
  download the Kagoshima ZIP, and extract the municipality JSON files under
  `snapshots/raw/emaff-fude-kagoshima/`. A single GeoJSON file at
  `snapshots/raw/emaff-fude-kagoshima.geojson` is also supported.
- FAMIC: download the official CSV ZIPs from
  https://www.acis.famic.go.jp/ddata/index2.htm and extract `R*.csv` under
  `snapshots/raw/famic*/`, or place a normalized CSV at
  `snapshots/raw/famic-pesticide.csv`.

The resulting `*.sqlite` files stay untracked, but `.gcloudignore` allows them
into Cloud Build source uploads so first-party deploys can bake snapshots into
the image. GitHub Actions deploys restore the same files from GCS:

```bash
gcloud storage cp snapshots/emaff-fude-kagoshima.sqlite \
  gs://mcp-win-agriops-snapshots/emaff-fude-kagoshima.sqlite
gcloud storage cp snapshots/famic-pesticide-2026.sqlite \
  gs://mcp-win-agriops-snapshots/famic-pesticide-2026.sqlite
```

For much larger datasets, mount snapshots from GCS instead of baking them into
the image.

### 6.3 Dependency updates

Dependabot is configured for npm, Actions, and Docker (weekly,
grouped). Merge the green-CI PRs; reject anything that fails
`npm audit signatures`.

---

## 7. Disaster recovery

| Scenario | RTO | RPO | Procedure |
| --- | --- | --- | --- |
| Single-region Cloud Run outage | 15 min | 0 (stateless) | Re-deploy the same image to `asia-northeast2`; flip DNS. |
| Token-key compromise | 30 min | 0 | Rotate the key (§6.1), invalidate active tokens by deleting `.tokens/` files, force re-elicitation. |
| Snapshot corruption | 1 h | (depends on quarterly source date) | Restore prior snapshot from GCS object versioning. |
| Source-code repo breach | 4 h | 0 | Revoke npm publish token + GH PAT, audit `release.yml`, re-issue all secrets. |

---

## 8. Contact

- On-call: see internal PagerDuty rotation `agriops-mcp`.
- Security: see `SECURITY.md` for the private reporting channel (`info@win-g-c.com`).
- Spec questions: [`modelcontextprotocol/specification`](https://github.com/modelcontextprotocol/specification/issues).
