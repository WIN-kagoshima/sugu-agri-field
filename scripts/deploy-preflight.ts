import { execFileSync } from "node:child_process";

interface Options {
  project?: string;
  region: string;
  repository: string;
  runtimeServiceAccount?: string;
  tokenSecret: string;
  sessionSecret: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

const REQUIRED_APIS = [
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com",
];

const GCLOUD = "gcloud";

function parseArgs(argv: string[]): Options {
  const options: Options = {
    region: "asia-northeast1",
    repository: "sugu-mcp",
    tokenSecret: "sugu-token-enc-key",
    sessionSecret: "sugu-session-cookie-secret",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    switch (arg) {
      case "--project":
        options.project = next;
        i++;
        break;
      case "--region":
        options.region = next;
        i++;
        break;
      case "--repo":
        options.repository = next;
        i++;
        break;
      case "--runtime-service-account":
        options.runtimeServiceAccount = next;
        i++;
        break;
      case "--token-secret":
        options.tokenSecret = next;
        i++;
        break;
      case "--session-secret":
        options.sessionSecret = next;
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`SuguAgriField Cloud Run deploy preflight

Usage:
  npm run deploy:preflight -- --project mcp-win

Options:
  --project <id>                    GCP project ID. Defaults to gcloud config project.
  --region <region>                 Region. Default: asia-northeast1.
  --repo <name>                     Artifact Registry repo. Default: sugu-mcp.
  --runtime-service-account <email> Runtime service account email.
  --token-secret <name>             Secret Manager token key. Default: sugu-token-enc-key.
  --session-secret <name>           Secret Manager cookie key. Default: sugu-session-cookie-secret.
`);
}

function gcloud(args: string[]): string {
  return execFileSync(GCLOUD, ["--quiet", ...args], {
    encoding: "utf-8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGcloud(args: string[]): { ok: true; out: string } | { ok: false; err: string } {
  try {
    return { ok: true, out: gcloud(args) };
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message?: string };
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString("utf-8") : err.stderr;
    return { ok: false, err: stderr || err.message || String(error) };
  }
}

function pushResult(results: CheckResult[], result: CheckResult): void {
  results.push(result);
}

function command(lines: string[]): string {
  return lines.join(" \\\n  ");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const configuredProject = tryGcloud(["config", "get-value", "project"]);
  const project = options.project ?? (configuredProject.ok ? configuredProject.out : undefined);
  if (!project) {
    throw new Error("No project supplied and no gcloud config project is set.");
  }
  const runtimeSa =
    options.runtimeServiceAccount ?? `sugu-agri-runtime@${project}.iam.gserviceaccount.com`;
  const results: CheckResult[] = [];

  const account = tryGcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  pushResult(results, {
    name: "gcloud active account",
    ok: account.ok && account.out.length > 0,
    detail: account.ok ? account.out || "(none)" : account.err,
    fix: "Run: gcloud auth login",
  });

  const billing = tryGcloud([
    "billing",
    "projects",
    "describe",
    project,
    "--format=value(billingEnabled)",
  ]);
  pushResult(results, {
    name: "billing enabled",
    ok: billing.ok && billing.out === "True",
    detail: billing.ok ? `${project}: ${billing.out || "(empty)"}` : billing.err,
    fix: `Open: https://console.cloud.google.com/billing/projects?project=${project}`,
  });

  const services = tryGcloud([
    "services",
    "list",
    "--enabled",
    `--project=${project}`,
    "--format=value(config.name)",
  ]);
  const enabled = new Set(services.ok ? services.out.split(/\r?\n/).filter(Boolean) : []);
  const missingApis = REQUIRED_APIS.filter((api) => !enabled.has(api));
  pushResult(results, {
    name: "required APIs enabled",
    ok: services.ok && missingApis.length === 0,
    detail: services.ok
      ? missingApis.length
        ? `missing: ${missingApis.join(", ")}`
        : REQUIRED_APIS.join(", ")
      : services.err,
    fix: command(["gcloud services enable", ...REQUIRED_APIS, `--project=${project}`]),
  });

  const repo = tryGcloud([
    "artifacts",
    "repositories",
    "describe",
    options.repository,
    `--location=${options.region}`,
    `--project=${project}`,
    "--format=value(name)",
  ]);
  pushResult(results, {
    name: "Artifact Registry repository",
    ok: repo.ok,
    detail: repo.ok ? `${options.region}/${options.repository}` : repo.err,
    fix: command([
      "gcloud artifacts repositories create",
      options.repository,
      "--repository-format=docker",
      `--location=${options.region}`,
      '--description="SuguAgriField MCP images"',
      `--project=${project}`,
    ]),
  });

  const sa = tryGcloud([
    "iam",
    "service-accounts",
    "describe",
    runtimeSa,
    `--project=${project}`,
    "--format=value(email)",
  ]);
  pushResult(results, {
    name: "runtime service account",
    ok: sa.ok,
    detail: sa.ok ? runtimeSa : sa.err,
    fix: command([
      "gcloud iam service-accounts create sugu-agri-runtime",
      '--display-name="SuguAgriField MCP runtime"',
      `--project=${project}`,
    ]),
  });

  for (const secret of [options.tokenSecret, options.sessionSecret]) {
    const found = tryGcloud([
      "secrets",
      "describe",
      secret,
      `--project=${project}`,
      "--format=value(name)",
    ]);
    pushResult(results, {
      name: `Secret Manager secret: ${secret}`,
      ok: found.ok,
      detail: found.ok ? secret : found.err,
      fix:
        secret === options.tokenSecret
          ? command([
              "node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"",
              `| gcloud secrets create ${secret} --data-file=- --project=${project}`,
            ])
          : command([
              "node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"",
              `| gcloud secrets create ${secret} --data-file=- --project=${project}`,
            ]),
    });
  }

  const service = tryGcloud([
    "run",
    "services",
    "describe",
    "sugu-agri-field",
    `--region=${options.region}`,
    `--project=${project}`,
    "--format=value(status.url)",
  ]);
  pushResult(results, {
    name: "Cloud Run service exists",
    ok: service.ok,
    detail: service.ok ? service.out : "not deployed yet",
    fix: command([
      "gcloud builds submit",
      "--config cloudbuild.yaml",
      `--project=${project}`,
      `--region=${options.region}`,
      "--substitutions=_MCP_BASE_URL=<public-url>",
    ]),
  });

  console.log(`SuguAgriField deploy preflight: project=${project}, region=${options.region}`);
  let failed = 0;
  for (const result of results) {
    const marker = result.ok ? "PASS" : "FAIL";
    console.log(`\n[${marker}] ${result.name}`);
    console.log(result.detail);
    if (!result.ok) {
      failed++;
      if (result.fix) console.log(`Fix:\n${result.fix}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} preflight check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll deploy preflight checks passed.");
}

main();
