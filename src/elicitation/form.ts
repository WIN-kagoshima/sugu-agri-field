/**
 * Form-mode elicitation helpers (Phase 3).
 *
 * Wraps the SDK's `server.elicitInput()` to enforce the official constraint
 * that the requested schema is a **flat object of primitives**. Nested
 * objects, arrays of objects, and `additionalProperties: true` are rejected
 * at the helper boundary so a tool author cannot accidentally violate it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const PrimitiveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
    title: z.string(),
    description: z.string().optional(),
    default: z.string().optional(),
    enum: z.array(z.string()).optional(),
    enumNames: z.array(z.string()).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
  }),
  z.object({
    type: z.literal("integer"),
    title: z.string(),
    description: z.string().optional(),
    default: z.number().int().optional(),
    minimum: z.number().int().optional(),
    maximum: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("number"),
    title: z.string(),
    description: z.string().optional(),
    default: z.number().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.object({
    type: z.literal("boolean"),
    title: z.string(),
    description: z.string().optional(),
    default: z.boolean().optional(),
  }),
]);

export type FormPrimitive = z.infer<typeof PrimitiveSchema>;

export const FlatFormSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(PrimitiveSchema),
    required: z.array(z.string()).optional(),
  })
  .strict();

export type FlatForm = z.infer<typeof FlatFormSchema>;

export interface ElicitFormResult<T extends Record<string, unknown>> {
  action: "accept" | "decline" | "cancel";
  content: T | null;
}

export interface ServerLike {
  /**
   * Optional capability check. v1 SDK exposes it on the underlying server;
   * we keep the shape loose so tests can pass a stub.
   */
  server?: McpServer["server"];
}

/**
 * Run a Form elicitation against the connected client.
 *
 * Falls back gracefully on clients that do not advertise the `elicitation`
 * capability: the helper returns `{ action: "decline", content: null }` and
 * the caller should explain in `content[0].text` that the missing input
 * cannot be solicited.
 */
export async function elicitForm<T extends Record<string, unknown>>(
  server: McpServer,
  message: string,
  schema: FlatForm,
): Promise<ElicitFormResult<T>> {
  // The v1 SDK exposes elicitation through `server.server.elicitInput`.
  const sdkServer = server.server;
  if (
    !sdkServer ||
    typeof (sdkServer as unknown as { elicitInput?: unknown }).elicitInput !== "function"
  ) {
    return { action: "decline", content: null };
  }
  const elicitInput = (
    sdkServer as unknown as {
      elicitInput: (params: {
        message: string;
        requestedSchema: FlatForm;
      }) => Promise<{
        action: "accept" | "decline" | "cancel";
        content?: Record<string, unknown>;
      }>;
    }
  ).elicitInput;

  // Validate locally to catch shape violations before sending.
  FlatFormSchema.parse(schema);

  try {
    const res = await elicitInput({ message, requestedSchema: schema });
    if (res.action === "accept") {
      return { action: "accept", content: (res.content ?? {}) as T };
    }
    return { action: res.action, content: null };
  } catch {
    return { action: "decline", content: null };
  }
}
