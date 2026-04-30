import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { elicitForm } from "../elicitation/form.js";
import { safeErrorMessage } from "../lib/errors.js";
import type { Deps } from "../server/deps.js";
import { getToolAnnotations } from "../server/surface-catalog.js";
import type { ToolMeta } from "../types/common.js";

export const meta: ToolMeta = {
  name: "create_staff_deploy_plan",
  sideEffect: "draft",
  visibility: "model",
  introducedInPhase: 3,
};

const FarmRegion = z.enum(["kirishima_kokubu", "isa_okuchi", "kanoya_central"]);

export const inputSchema = z
  .object({
    farmRegion: FarmRegion.optional().describe(
      "High-level region label. If absent, the server elicits a Form from the client.",
    ),
    periodDays: z
      .number()
      .int()
      .min(7)
      .max(90)
      .optional()
      .describe("Length of the dispatch plan in days (7–90)."),
    includeWeekend: z.boolean().optional().describe("Whether weekend dispatch is allowed."),
  })
  .strict();

interface ResolvedArgs {
  farmRegion: z.infer<typeof FarmRegion>;
  periodDays: number;
  includeWeekend: boolean;
}

export function registerCreateStaffDeployPlan(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  server.registerTool(
    meta.name,
    {
      title: "Draft a staff deployment plan",
      description:
        "Produce a non-binding (draft) deployment plan for SSW staff across the chosen farm region and period. " +
        "If `farmRegion` or `periodDays` is missing, the server uses a Form-mode elicitation to ask the user. " +
        "Returns a textual plan plus structured data; nothing is persisted or sent.",
      inputSchema: inputSchema.shape,
      annotations: getToolAnnotations(meta.name),
    },
    async (raw: unknown) => {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid input: ${parsed.error.issues[0]?.message ?? "unknown"}`,
            },
          ],
        };
      }

      let resolved: ResolvedArgs | null = ifComplete(parsed.data);
      if (!resolved) {
        const result = await elicitForm<{
          farm_region: z.infer<typeof FarmRegion>;
          period_days: number;
          include_weekend: boolean;
        }>(
          server,
          "To draft a deployment plan we need the target region and the planning period.",
          {
            type: "object",
            properties: {
              farm_region: {
                type: "string",
                title: "Farm region",
                description: "Pick the region where staff will be dispatched.",
                enum: ["kirishima_kokubu", "isa_okuchi", "kanoya_central"],
                enumNames: [
                  "Kirishima / Kokubu (≈12 fields)",
                  "Isa / Okuchi (≈8 fields)",
                  "Kanoya central (≈15 fields)",
                ],
              },
              period_days: {
                type: "integer",
                title: "Planning period (days)",
                minimum: 7,
                maximum: 90,
                default: 30,
              },
              include_weekend: {
                type: "boolean",
                title: "Include weekends",
                default: false,
              },
            },
            required: ["farm_region", "period_days"],
          },
        );
        if (result.action !== "accept" || !result.content) {
          const reason =
            result.action === "cancel"
              ? "The user cancelled the deployment plan dialog."
              : "The client either declined or does not support form elicitation. Please call the tool again with all arguments populated.";
          return {
            content: [{ type: "text", text: reason }],
            structuredContent: { status: "declined", reason: result.action } as Record<
              string,
              unknown
            >,
          };
        }
        resolved = {
          farmRegion: result.content.farm_region,
          periodDays: result.content.period_days,
          includeWeekend: result.content.include_weekend ?? false,
        };
      }

      try {
        const plan = await draftPlan(deps, resolved);
        return {
          content: [
            {
              type: "text",
              text: `Drafted a deployment plan for ${resolved.farmRegion} over ${resolved.periodDays} day(s)${resolved.includeWeekend ? " including weekends" : ""}. This is a non-binding draft.`,
            },
          ],
          structuredContent: plan as unknown as Record<string, unknown>,
        };
      } catch (err) {
        deps.logger.error("create_staff_deploy_plan failed", { error: (err as Error).message });
        return { isError: true, content: [{ type: "text", text: safeErrorMessage(err) }] };
      }
    },
  );
}

function ifComplete(args: z.infer<typeof inputSchema>): ResolvedArgs | null {
  if (!args.farmRegion || args.periodDays === undefined) return null;
  return {
    farmRegion: args.farmRegion,
    periodDays: args.periodDays,
    includeWeekend: args.includeWeekend ?? false,
  };
}

interface DraftPlan {
  status: "draft";
  farmRegion: string;
  periodDays: number;
  includeWeekend: boolean;
  fieldCount: number;
  estimatedStaffDays: number;
  generatedAt: string;
  attribution: string;
}

async function draftPlan(deps: Deps, args: ResolvedArgs): Promise<DraftPlan> {
  if (!deps.emaff) {
    throw new Error("eMAFF adapter is not configured");
  }
  // Phase 3 ships a deliberately simple heuristic. Phase 6 (Tasks primitive)
  // will replace this with a long-running optimiser.
  const summary = await deps.emaff.areaSummary(prefectureForRegion(args.farmRegion));
  const fieldCount = Math.min(summary.totalFields, regionFieldHeuristic(args.farmRegion));
  const staffPerDay = args.includeWeekend ? 7 / 7 : 5 / 7;
  const estimatedStaffDays = Math.round(args.periodDays * fieldCount * staffPerDay * 0.25);
  return {
    status: "draft",
    farmRegion: args.farmRegion,
    periodDays: args.periodDays,
    includeWeekend: args.includeWeekend,
    fieldCount,
    estimatedStaffDays,
    generatedAt: new Date().toISOString(),
    attribution: summary.attribution,
  };
}

function prefectureForRegion(_region: z.infer<typeof FarmRegion>): { prefectureCode: string } {
  return { prefectureCode: "JP-46" };
}

function regionFieldHeuristic(region: z.infer<typeof FarmRegion>): number {
  switch (region) {
    case "kirishima_kokubu":
      return 12;
    case "isa_okuchi":
      return 8;
    case "kanoya_central":
      return 15;
    default: {
      const exhaustive: never = region;
      throw new Error(`unsupported region: ${String(exhaustive)}`);
    }
  }
}
