#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${AGRIOPS_BASE_URL:-http://localhost:3001}"
REQ_ID="${AGRIOPS_REQ_ID:-curl-example-$(date +%s)}"

echo "▶ Server card:"
curl -sS "$BASE_URL/.well-known/mcp-server.json" | head -c 1000
echo
echo

echo "▶ tools/list:"
curl -sS "$BASE_URL/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "x-request-id: $REQ_ID" \
  -D - \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | grep -E '^(HTTP|x-request-id|content-type|$|\{)' | head -n 40
echo

echo "▶ tools/call get_weather_1km:"
curl -sS "$BASE_URL/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "x-request-id: $REQ_ID" \
  --data '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_weather_1km",
      "arguments": {"lat": 31.55, "lng": 130.55, "hours": 24, "timezone": "Asia/Tokyo"}
    }
  }' | head -c 2000
echo
