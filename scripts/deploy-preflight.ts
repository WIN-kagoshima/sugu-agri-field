import { execFileSync } from "node:child_process";

interface Options {
  project?: string;
  region: string;
  repository: string;
  runtimeServiceAccount?: string;
  tokenSecret: string;
  sessionSecret: string;
  snapshotBucket?: string;
  skipBilling: boolean;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  warn?: boolean;
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
    repository: "agriops-mcp",
    tokenSecret: "agriops-token-enc-key",
    sessionSecret: "agriops-session-cookie-secret",
    skipBilling: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]?.trim();
    if (arg === undefined || arg === "") continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--skip-billing") {
      options.skipBilling = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const key = (eq >= 0 ? arg.slice(0, eq) : arg).trim();
    const inlineValue = eq >= 0 ? arg.slice(eq + 1).trim() : undefined;
    const next = inlineValue ?? argv[i + 1]?.trim();
    if (next === undefined || next === "" || next.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    switch (key) {
      case "--project":
        options.project = next;
        if (inlineValue === undefined) i++;
        break;
      case "--region":
        options.region = next;
        if (inlineValue === undefined) i++;
        break;
      case "--repo":
        options.repository = next;
        if (inlineValue === undefined) i++;
        break;
      case "--runtime-service-account":
        options.runtimeServiceAccount = next;
        if (inlineValue === undefined) i++;
        break;
      case "--token-secret":
        options.tokenSecret = next;
        if (inlineValue === undefined) i++;
        break;
      case "--session-secret":
        options.sessionSecret = next;
        if (inlineValue === undefined) i++;
        break;
      case "--snapshot-bucket":
        options.snapshotBucket = next.replace(/^gs:\/\//, "").replace(/\/+$/, "");
        if (inlineValue === undefined) i++;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`AgriOps MCP Cloud Run deploy preflight

Usage:
  npm run deploy:preflight -- --project mcp-win

Options:
  --project <id>                    GCP project ID. Defaults to gcloud config project.
  --region <region>                 Region. Default: asia-northeast1.
  --repo <name>                     Artifact Registry repo. Default: agriops-mcp.
  --runtime-service-account <email> Runtime service account email.
  --token-secret <name>             Secret Manager token key. Default: agriops-token-enc-key.
  --session-secret <name>           Secret Manager cookie key. Default: agriops-session-cookie-secret.
  --snapshot-bucket <name>          Optional GCS bucket containing baked SQLite snapshots.
  --skip-billing                    Skip billingEnabled check for least-privilege CI deployers.
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
    options.runtimeServiceAccount ?? `agriops-runtime@${project}.iam.gserviceaccount.com`;
  const results: CheckResult[] = [];

  const account = tryGcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  pushResult(results, {
    name: "gcloud active account",
    ok: account.ok && account.out.length > 0,
    detail: account.ok ? account.out || "(none)" : account.err,
    fix: "Run: gcloud auth login",
  });

  if (!options.skipBilling) {
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
  }

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
      '--description="AgriOps MCP images"',
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
      "gcloud iam service-accounts create agriops-runtime",
      '--display-name="AgriOps MCP runtime"',
      `--project=${project}`,
    ]),
  });

  const secrets = tryGcloud(["secrets", "list", `--project=${project}`, "--format=value(name)"]);
  const secretNames = new Set(
    secrets.ok ? secrets.out.split(/\r?\n/).map((name) => name.split("/").pop() ?? name) : [],
  );
  for (const secret of [options.tokenSecret, options.sessionSecret]) {
    const found = secrets.ok && secretNames.has(secret);
    pushResult(results, {
      name: `Secret Manager secret: ${secret}`,
      ok: found,
      detail: found ? secret : secrets.ok ? `missing: ${secret}` : secrets.err,
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

  if (options.snapshotBucket) {
    const objectResults: CheckResult[] = [];
    for (const object of ["emaff-fude-kagoshima.sqlite", "famic-pesticide-2026.sqlite"]) {
      const objectCheck = tryGcloud([
        "storage",
        "objects",
        "describe",
        `gs://${options.snapshotBucket}/${object}`,
        "--format=value(name,size)",
      ]);
      objectResults.push({
        name: `GCS snapshot object: ${object}`,
        ok: objectCheck.ok && objectCheck.out.length > 0,
        detail: objectCheck.ok ? objectCheck.out : objectCheck.err,
        fix: `Run: gcloud storage cp snapshots/${object} gs://${options.snapshotBucket}/${object}`,
      });
    }
    const allObjectsAccessible = objectResults.every((result) => result.ok);

    const bucket = tryGcloud([
      "storage",
      "buckets",
      "describe",
      `gs://${options.snapshotBucket}`,
      `--project=${project}`,
      "--format=value(name)",
    ]);
    if (bucket.ok) {
      pushResult(results, {
        name: `GCS snapshot bucket: ${options.snapshotBucket}`,
        ok: true,
        detail: options.snapshotBucket,
      });
    } else if (allObjectsAccessible) {
      pushResult(results, {
        name: `GCS snapshot bucket: ${options.snapshotBucket}`,
        ok: true,
        warn: true,
        detail: `bucket-level metadata not accessible (storage.buckets.get denied), but all required objects are reachable. Cloud Build only needs object reads, so this is non-fatal. To silence this warning, grant roles/storage.legacyBucketReader on gs://${options.snapshotBucket} to the deployer SA.`,
        fix: command([
          "gcloud storage buckets add-iam-policy-binding",
          `gs://${options.snapshotBucket}`,
          '--member="serviceAccount:<deployer-sa-email>"',
          "--role=roles/storage.legacyBucketReader",
        ]),
      });
    } else {
      pushResult(results, {
        name: `GCS snapshot bucket: ${options.snapshotBucket}`,
        ok: false,
        detail: bucket.err,
        fix: command([
          "gcloud storage buckets create",
          `gs://${options.snapshotBucket}`,
          `--project=${project}`,
          `--location=${options.region}`,
          "--uniform-bucket-level-access",
        ]),
      });
    }

    for (const result of objectResults) {
      pushResult(results, result);
    }
  }

  const service = tryGcloud([
    "run",
    "services",
    "describe",
    "agriops-mcp",
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

  console.log(`AgriOps MCP deploy preflight: project=${project}, region=${options.region}`);
  let failed = 0;
  let warnings = 0;
  for (const result of results) {
    const marker = result.ok ? (result.warn ? "WARN" : "PASS") : "FAIL";
    console.log(`\n[${marker}] ${result.name}`);
    console.log(result.detail);
    if (!result.ok) {
      failed++;
      if (result.fix) console.log(`Fix:\n${result.fix}`);
    } else if (result.warn) {
      warnings++;
      if (result.fix) console.log(`Suggested fix:\n${result.fix}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} preflight check(s) failed.`);
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(`\nAll deploy preflight checks passed (${warnings} warning(s) — see above).`);
  } else {
    console.log("\nAll deploy preflight checks passed.");
  }
}

main();
