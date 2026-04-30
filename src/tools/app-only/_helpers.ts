import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodObject, ZodRawShape, ZodTypeAny, z } from "zod";
import { safeErrorMessage } from "../../lib/errors.js";
import type { Deps } from "../../server/deps.js";
import { getToolAnnotations } from "../../server/surface-catalog.js";

export interface AppOnlyHandlerResult {
  content?: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
}

/**
 * Register a tool that is invoked by the MCP Apps UI rather than by the LLM.
 *
 * Sets `_meta.ui/visibility = ["app"]` and `_meta.openai/widgetAccessible = true`
 * so hosts that respect either hint hide the tool from the model. Hosts that
 * do not respect the hint will still surface the tool, which is acceptable
 * because the UI is the only sensible caller anyway.
 */
export function registerAppOnlyTool<S extends ZodRawShape>(
  server: McpServer,
  name: string,
  options: {
    title: string;
    description: string;
    inputSchema: ZodObject<S, "strict" | "strip" | "passthrough", ZodTypeAny>;
    deps: Deps;
  },
  handler: (args: z.infer<typeof options.inputSchema>, deps: Deps) => Promise<AppOnlyHandlerResult>,
): void {
  const inputSchema = options.inputSchema;
  // The cast to `unknown` then back at the registerTool boundary is required
  // because the SDK's BaseToolCallback generic does not reduce cleanly through
  // our generic wrapper. The runtime contract is still enforced by the SDK
  // (input schema validation) and by our explicit Zod safeParse.
  server.registerTool(
    name,
    {
      title: options.title,
      description: options.description,
      inputSchema: inputSchema.shape,
      annotations: getToolAnnotations(name),
      _meta: {
        "ui/visibility": ["app"],
        "openai/widgetAccessible": true,
      },
    },
    (async (raw: unknown) => {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Invalid input: ${parsed.error.issues[0]?.message ?? "unknown"}`,
            },
          ],
        };
      }
      try {
        const result = await handler(parsed.data, options.deps);
        return {
          content: result.content ?? [{ type: "text" as const, text: "ok" }],
          ...(result.structuredContent !== undefined
            ? { structuredContent: result.structuredContent as Record<string, unknown> }
            : {}),
        };
      } catch (err) {
        options.deps.logger.error(`${name} failed`, { error: (err as Error).message });
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: safeErrorMessage(err) }],
        };
      }
    }) as unknown as Parameters<typeof server.registerTool>[2],
  );
}
