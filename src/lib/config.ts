import { z } from "zod";

const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3001),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  baseUrl: z.string().url().default("http://localhost:3001"),
  openMeteoBaseUrl: z.string().url().default("https://api.open-meteo.com/v1"),
  emaffSnapshotPath: z.string().default("./snapshots/emaff-fude-kagoshima.sqlite"),
  famicSnapshotPath: z.string().default("./snapshots/famic-pesticide-2026.sqlite"),
  sessionCookieSecret: z.string().min(16).default("dev-only-secret-do-not-use-in-prod"),
  demoOAuth: z
    .object({
      clientId: z.string(),
      clientSecret: z.string(),
      authorizeUrl: z.string().url(),
      tokenUrl: z.string().url(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export function loadConfig(): Config {
  const parsed = ConfigSchema.parse({
    port:
      readEnv("PORT") !== undefined ? Number.parseInt(readEnv("PORT") as string, 10) : undefined,
    logLevel: readEnv("LOG_LEVEL"),
    baseUrl: readEnv("MCP_BASE_URL"),
    openMeteoBaseUrl: readEnv("OPEN_METEO_BASE_URL"),
    emaffSnapshotPath: readEnv("EMAFF_SNAPSHOT_PATH"),
    famicSnapshotPath: readEnv("FAMIC_SNAPSHOT_PATH"),
    sessionCookieSecret: readEnv("SESSION_COOKIE_SECRET"),
    demoOAuth:
      readEnv("DEMO_OAUTH_CLIENT_ID") !== undefined
        ? {
            clientId: readEnv("DEMO_OAUTH_CLIENT_ID") as string,
            clientSecret: readEnv("DEMO_OAUTH_CLIENT_SECRET") ?? "",
            authorizeUrl:
              readEnv("DEMO_OAUTH_AUTHORIZE_URL") ?? "http://localhost:3001/__mock-oauth/authorize",
            tokenUrl: readEnv("DEMO_OAUTH_TOKEN_URL") ?? "http://localhost:3001/__mock-oauth/token",
          }
        : undefined,
  });
  return parsed;
}
