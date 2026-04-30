import { z } from "zod";

export const FarmlandSchema = z.object({
  fieldId: z.string().describe("eMAFF Fude polygon ID. Stable across snapshots."),
  polygonId: z.string().describe("Underlying polygon identifier."),
  prefectureCode: z.string().describe("ISO 3166-2:JP code, e.g. JP-46."),
  cityCode: z.string().describe("Japanese municipality code (5-digit)."),
  address: z.string().describe("Postal address (best-effort, may be empty)."),
  centroid: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  areaM2: z.number().min(0),
  registeredCrop: z.string().nullable().describe("Currently registered crop, if any."),
  attribution: z.string(),
});

export type Farmland = z.infer<typeof FarmlandSchema>;

export const FarmlandSearchResultSchema = z.object({
  fields: z.array(FarmlandSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().min(0).optional(),
  attribution: z.string(),
});

export type FarmlandSearchResult = z.infer<typeof FarmlandSearchResultSchema>;

export const AreaSummarySchema = z.object({
  prefectureCode: z.string().nullable(),
  cityCode: z.string().nullable(),
  totalFields: z.number().int().min(0),
  totalAreaHa: z.number().min(0),
  topCrops: z.array(z.object({ crop: z.string(), count: z.number().int() })).max(20),
  attribution: z.string(),
});

export type AreaSummary = z.infer<typeof AreaSummarySchema>;
