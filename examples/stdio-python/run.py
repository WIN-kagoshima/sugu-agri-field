"""Minimal Python stdio client for SuguAgriField MCP.

Run with:

    python run.py

Targets ../../dist/server.js. Override with the SUGU_SERVER env var
or pass it as argv[1].
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

DEFAULT_SERVER = (Path(__file__).parent.parent.parent / "dist" / "server.js").resolve()


async def main() -> int:
    server_path = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else Path(os.environ.get("SUGU_SERVER", str(DEFAULT_SERVER))).resolve()
    )
    if not server_path.exists():
        print(f"server entrypoint not found: {server_path}", file=sys.stderr)
        print("did you run `npm run build` at the repo root?", file=sys.stderr)
        return 2

    params = StdioServerParameters(
        command="node",
        args=[str(server_path), "--stdio"],
        env=None,
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print(
                f"✓ Connected: {init.serverInfo.name} v{init.serverInfo.version}"
            )

            tools = await session.list_tools()
            print(f"✓ Tools: {', '.join(t.name for t in tools.tools)}")

            result = await session.call_tool(
                "get_weather_1km",
                arguments={
                    "lat": 31.55,
                    "lng": 130.55,
                    "hours": 24,
                    "timezone": "Asia/Tokyo",
                },
            )
            if result.isError:
                text = result.content[0].text if result.content else "(no body)"
                print(f"✗ Tool failed: {text}", file=sys.stderr)
                return 1

            sc = result.structuredContent or {}
            hourly = sc.get("hourly") or []
            attribution = sc.get("attribution") or "(missing)"
            print(f"✓ {len(hourly)} hourly points")
            print(f"✓ Attribution: {attribution}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
