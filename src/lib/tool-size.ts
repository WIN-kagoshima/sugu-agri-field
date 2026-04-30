/**
 * Tool result size cap.
 *
 * Why: a single tool call returning megabytes of structured content can
 *
 *   - blow LLM context windows,
 *   - run the host out of memory,
 *   - and cause `tools/call` responses to time out at the transport.
 *
 * We measure the JSON-serialised size and refuse anything beyond
 * `maxBytes` (default 1 MiB). Tools are expected to paginate or
 * summarise instead. The error message tells the model how to recover
 * (use pagination / narrow filters) without leaking implementation
 * details.
 *
 * Rationale for 1 MiB: most LLM-friendly responses are ≤200 KB. A
 * single FAMIC pesticide list with 500 rows fits in ~100 KB of JSON.
 * Hitting 1 MB almost always means the tool didn't apply a `limit`
 * properly.
 */

const DEFAULT_MAX_BYTES = 1 * 1024 * 1024;

export interface ToolResultLike {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface SizeCheckResult {
  ok: boolean;
  bytes: number;
  maxBytes: number;
}

export function checkToolResultSize(
  result: ToolResultLike,
  options: { maxBytes?: number } = {},
): SizeCheckResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const serialised = JSON.stringify({
    content: result.content,
    structuredContent: result.structuredContent,
  });
  const bytes = Buffer.byteLength(serialised, "utf-8");
  return { ok: bytes <= maxBytes, bytes, maxBytes };
}

/**
 * Wrap a tool callback so that any oversized result is replaced with
 * an `isError: true` body referencing pagination guidance. Use this
 * for read-only, unbounded-by-default tools (search_farmland,
 * area_summary, nearby_farms, etc.).
 */
export function withSizeCap<TArgs, TResult extends ToolResultLike>(
  inner: (args: TArgs) => Promise<TResult>,
  options: { maxBytes?: number; toolName: string } = { toolName: "unknown" },
): (args: TArgs) => Promise<TResult | OversizedResult> {
  return async (args: TArgs) => {
    const result = await inner(args);
    if (result.isError) return result;
    const check = checkToolResultSize(result, options);
    if (check.ok) return result;
    const maxKb = (check.maxBytes / 1024).toFixed(0);
    const actualKb = (check.bytes / 1024).toFixed(0);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool result exceeded the ${maxKb} KB safety cap (would have been ${actualKb} KB). Reduce the result size by lowering \`limit\`, narrowing filters, or using pagination (\`cursor\`).`,
        },
      ],
    } as OversizedResult;
  };
}

export interface OversizedResult {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  // Index signature so the type is structurally assignable to the
  // SDK's loose tool result shape (`{ [x: string]: unknown; ... }`).
  [k: string]: unknown;
}

/**
 * Drop-in size-cap for tools that build the result object inline.
 *
 * Usage:
 *   return enforceSizeCap({
 *     content: [...],
 *     structuredContent: ...,
 *   }, { toolName: "search_farmland" });
 *
 * If the size budget is exceeded, returns the isError replacement
 * instead. Already-errored results are passed through unchanged.
 *
 * Generic so the caller's literal type (e.g. `content: [{type:"text", ...}]`)
 * is preserved end-to-end and remains assignable to the SDK's tool
 * callback return type.
 */
export function enforceSizeCap<T extends ToolResultLike>(
  result: T,
  options: { maxBytes?: number; toolName: string } = { toolName: "unknown" },
): T {
  if (result.isError) return result;
  const check = checkToolResultSize(result, options);
  if (check.ok) return result;
  // Cast through unknown: the OversizedResult shape is structurally a
  // valid tool result for any T, but TS cannot prove that generically.
  const maxKb = (check.maxBytes / 1024).toFixed(0);
  const actualKb = (check.bytes / 1024).toFixed(0);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Tool "${options.toolName}" result exceeded the ${maxKb} KB safety cap (would have been ${actualKb} KB). Reduce the result size by lowering \`limit\`, narrowing filters, or using pagination (\`cursor\`).`,
      },
    ],
  } as unknown as T;
}
