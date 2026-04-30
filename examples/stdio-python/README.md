# Python stdio client example

Uses the official `mcp` Python SDK (`mcp[cli]`) to drive the
SuguAgriField MCP server over stdio.

## Setup

```bash
python -m venv .venv
. .venv/bin/activate    # or .\.venv\Scripts\Activate.ps1 on Windows
pip install "mcp[cli]>=1.0"
```

Make sure the server is built once at the repo root:

```bash
cd ../..
npm install
npm run build
cd examples/stdio-python
```

## Run

```bash
python run.py
```

## Expected output (truncated)

```
✓ Connected: SuguAgriField vX.Y.Z
✓ Tools: get_weather_1km, …
✓ 24 hourly points
✓ Attribution: Weather data by Open-Meteo.com (CC-BY 4.0).
```
