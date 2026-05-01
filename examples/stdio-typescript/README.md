# TypeScript stdio client example

A self-contained Node script that:

1. Spawns `dist/server.js --stdio` as a child process.
2. Connects via `StdioClientTransport`.
3. Lists tools and calls `get_weather_1km` for AgriOpskabe Field
   (lat 31.55, lng 130.55).
4. Prints the structured forecast and the upstream attribution string.

## Run

```bash
cd ../..
npm install
npm run build
cd examples/stdio-typescript
node ./run.mjs
```

The script uses the `@modelcontextprotocol/sdk` already installed in the
parent project, so no extra `npm install` is required.

## Expected output (truncated)

```
✓ Connected to AgriOps MCP vX.Y.Z
✓ Tools: get_weather_1km, …
✓ Forecast: 24 hourly points from 2026-…
✓ Attribution: Weather data by Open-Meteo.com (CC-BY 4.0).
```
