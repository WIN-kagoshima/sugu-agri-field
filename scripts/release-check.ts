import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface Options {
  tag?: string;
  skipPack: boolean;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
}

const REQUIRED_PACK_FILES = [
  "dist/server.js",
  "dist/ui/dashboard.html",
  "docs/api-reference.md",
  "docs/data-license.md",
  "examples/http-curl/run.sh",
  "examples/http-curl/run.ps1",
  "snapshots/README.md",
  "README.md",
  "README.ja.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "LICENSE",
  "NOTICE",
];

const FORBIDDEN_PACK_PREFIXES = [
  ".env",
  ".github/",
  ".tokens/",
  "snapshots/raw/",
  "src/",
  "tests/",
];

function parseArgs(argv: string[]): Options {
  const options: Options = { skipPack: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]?.trim();
    if (arg === undefined || arg === "") continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--skip-pack") {
      options.skipPack = true;
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
      case "--tag":
        options.tag = next;
        if (inlineValue === undefined) i++;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`AgriOps MCP release readiness check

Usage:
  npm run build:all
  npm run release:check -- --tag v0.5.1

Options:
  --tag <tag>     Expected release tag, e.g. v0.5.1.
  --skip-pack     Skip npm pack --dry-run package-content checks.
`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function changelogSection(changelog: string, version: string): string | undefined {
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s|$)`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## \[/.test(line)) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

function packFilePaths(): string[] {
  const output = execSync("npm pack --dry-run --json --ignore-scripts", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("npm pack did not return JSON output");
  }
  const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed) || !isRecord(parsed[0]) || !Array.isArray(parsed[0].files)) {
    throw new Error("npm pack JSON output did not contain a files array");
  }
  return parsed[0].files
    .filter(isRecord)
    .map((file) => file.path)
    .filter((path): path is string => typeof path === "string")
    .sort();
}

function result(name: string, ok: boolean, detail: string): CheckResult {
  return { name, ok, detail };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const pkg = readPackageJson();
  const packageName = typeof pkg.name === "string" ? pkg.name : "";
  const version = typeof pkg.version === "string" ? pkg.version : "";
  const expectedTag = `v${version}`;
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const results: CheckResult[] = [];

  results.push(
    result(
      "package name",
      packageName === "@win-kagoshima/agriops-mcp",
      packageName || "missing package.json name",
    ),
  );
  results.push(
    result(
      "package version",
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
      version || "missing package.json version",
    ),
  );
  if (options.tag !== undefined) {
    results.push(
      result(
        "release tag matches package version",
        options.tag === expectedTag,
        `${options.tag} vs ${expectedTag}`,
      ),
    );
  }

  const notes = changelogSection(changelog, version);
  results.push(
    result(
      "CHANGELOG release notes",
      notes !== undefined && notes.length > 0,
      notes === undefined
        ? `missing ## [${version}] section`
        : `${notes.split(/\r?\n/).length} line(s)`,
    ),
  );

  if (!options.skipPack) {
    const missingDist = ["dist/server.js", "dist/ui/dashboard.html"].filter(
      (path) => !existsSync(path),
    );
    if (missingDist.length > 0) {
      results.push(
        result(
          "build artifacts exist",
          false,
          `missing ${missingDist.join(", ")}; run npm run build:all before release:check`,
        ),
      );
    } else {
      const paths = packFilePaths();
      const missing = REQUIRED_PACK_FILES.filter((path) => !paths.includes(path));
      const forbidden = paths.filter((path) =>
        FORBIDDEN_PACK_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)),
      );
      results.push(
        result(
          "npm package required files",
          missing.length === 0,
          missing.length === 0
            ? `${paths.length} file(s) in dry-run pack`
            : `missing ${missing.join(", ")}`,
        ),
      );
      results.push(
        result(
          "npm package forbidden files",
          forbidden.length === 0,
          forbidden.length === 0 ? "no source/test/raw snapshot artifacts" : forbidden.join(", "),
        ),
      );
    }
  }

  console.log(`AgriOps MCP release check: package=${packageName}, version=${version}`);
  let failed = 0;
  for (const check of results) {
    const label = check.ok ? "PASS" : "FAIL";
    console.log(`\n[${label}] ${check.name}`);
    console.log(check.detail);
    if (!check.ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n${failed} release check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll release checks passed.");
}

main();
