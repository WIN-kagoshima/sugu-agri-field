import { z } from "zod";

export const PesticideRuleSchema = z.object({
  registrationId: z.string().describe("FAMIC registration number (a stable identifier)."),
  productName: z.string(),
  activeIngredients: z.array(z.string()),
  targetCrops: z.array(z.string()),
  targetPestsOrDiseases: z.array(z.string()),
  applicationMethod: z.string().nullable(),
  preHarvestIntervalDays: z.number().int().min(0).nullable(),
  maxApplicationsPerSeason: z.number().int().min(0).nullable(),
  registrationDate: z.string().nullable(),
  expiresAt: z.string().nullable(),
  attribution: z.string(),
});

export type PesticideRule = z.infer<typeof PesticideRuleSchema>;

export const PesticideQueryResultSchema = z.object({
  rules: z.array(PesticideRuleSchema),
  nextCursor: z.string().nullable(),
  attribution: z.string(),
});

export type PesticideQueryResult = z.infer<typeof PesticideQueryResultSchema>;
