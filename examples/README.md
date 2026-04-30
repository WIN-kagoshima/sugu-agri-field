# SuguAgriField MCP — Client examples

Three minimal clients that connect to the SuguAgriField MCP server,
list the available tools, and call `get_weather_1km` for Sugukurukabe
Field (鹿児島県, ~31.5N 130.5E).

| Folder | Transport | What it shows |
| --- | --- | --- |
| [`stdio-typescript/`](stdio-typescript) | stdio | Official `@modelcontextprotocol/sdk` client driving the server as a child process. |
| [`stdio-python/`](stdio-python) | stdio | Official `mcp[cli]` Python client (`mcp.client.stdio`). |
| [`http-curl/`](http-curl) | Streamable HTTP | Plain `curl` calls against the `/mcp` endpoint. Useful when integrating from any language. |

All three target the same surface so you can compare them side by side.
None of them require any keys, snapshots, or external accounts: they
exercise Phase 0 (`get_weather_1km`, Open-Meteo) only.

## Prerequisites

```bash
git clone https://github.com/WIN-kagoshima/sugu-agri-field
cd sugu-agri-field
npm install
npm run build
```

Then `cd examples/<folder>` and follow that folder's README.
