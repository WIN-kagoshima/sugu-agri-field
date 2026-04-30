import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "../lib/logger.js";

/**
 * Connect the server to stdio. Used for local development and Claude
 * Desktop / Cursor / VS Code integrations that spawn the server as a
 * subprocess.
 *
 * NOTE: stdio transport uses stdout for protocol traffic. All logs go to
 * stderr (see `src/lib/logger.ts`). DO NOT `console.log` from anywhere
 * else in the codebase — it will corrupt the JSON-RPC stream.
 */
export async function startStdio(server: McpServer, logger: Logger): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("stdio transport connected");
}
