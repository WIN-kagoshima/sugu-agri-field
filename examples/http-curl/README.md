# curl + Streamable HTTP example

Demonstrates that the AgriOps MCP server is reachable from any
language by speaking plain JSON-RPC 2.0 over its `/mcp` endpoint.

## Start the server

```bash
cd ../..
npm install
npm run build
PORT=3001 MCP_BASE_URL=http://localhost:3001 node dist/server.js --http
```

Leave it running, then in another shell:

```bash
cd examples/http-curl
./run.sh           # bash / zsh
# or
pwsh ./run.ps1     # Windows PowerShell
```

The script runs three calls and dumps each response:

1. `GET /.well-known/mcp-server.json` — Server Card.
2. `POST /mcp` `tools/list` — list of registered tools.
3. `POST /mcp` `tools/call get_weather_1km` for an AgriOps sample field.

Notice how every response carries an `X-Request-Id` header. If the
caller supplies one, the server reuses it — handy for tracing across
proxies.

## Notes on `/mcp`

The server runs the `simpleStatelessStreamableHttp` pattern: every
request is independent. There is no `Mcp-Session-Id`. The transport
requires `Accept: application/json, text/event-stream` even when the
response is a plain JSON-RPC reply.

## Targeting the Cloud Run reference deployment

The hosted endpoint is IAM-protected. Set `AGRIOPS_AUTH_BEARER` before running
the script:

```bash
export AGRIOPS_BASE_URL=https://agriops-mcp-n5vdix22hq-an.a.run.app
export AGRIOPS_AUTH_BEARER="$(gcloud auth print-identity-token)"
./run.sh
```

PowerShell:

```powershell
$env:AGRIOPS_BASE_URL = "https://agriops-mcp-n5vdix22hq-an.a.run.app"
$env:AGRIOPS_AUTH_BEARER = gcloud auth print-identity-token
./run.ps1
```
