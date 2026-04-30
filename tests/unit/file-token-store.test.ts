import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTokenStore } from "../../src/auth/file-token-store.js";
import type { StoredToken } from "../../src/auth/token-store.js";

const KEY_B64 = randomBytes(32).toString("base64");

const SAMPLE: StoredToken = {
  accessToken: "mock-abcdefghij",
  refreshToken: "refresh-xyz",
  expiresAt: Date.now() + 3600_000,
  scope: "read",
};

describe("FileTokenStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokens-"));
  });

  afterEach(async () => {
    if (existsSync(dir)) {
      for (let i = 0; i < 5; i++) {
        try {
          await rm(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    }
  });

  it("refuses to construct without a key or passphrase", () => {
    expect(() => new FileTokenStore({ dir, env: {} })).toThrowError(/encryption key/i);
  });

  it("rejects malformed SUGU_TOKEN_ENC_KEY", () => {
    expect(() => new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: "not-base64-32" } })).toThrow(
      /32 bytes/i,
    );
  });

  it("round-trips a token with a base64 key", async () => {
    const store = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    await store.save("user-1", "demo", SAMPLE);
    const back = await store.get("user-1", "demo");
    expect(back).toEqual(SAMPLE);
  });

  it("returns null for unknown (user, provider) pairs", async () => {
    const store = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    expect(await store.get("user-x", "demo")).toBeNull();
  });

  it("persists across instances when the same key is supplied", async () => {
    const a = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    await a.save("user-2", "demo", SAMPLE);
    const b = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    expect(await b.get("user-2", "demo")).toEqual(SAMPLE);
  });

  it("returns null instead of throwing when the wrong key is used", async () => {
    const a = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    await a.save("user-3", "demo", SAMPLE);
    const wrong = new FileTokenStore({
      dir,
      env: { SUGU_TOKEN_ENC_KEY: randomBytes(32).toString("base64") },
    });
    expect(await wrong.get("user-3", "demo")).toBeNull();
  });

  it("never leaks plaintext tokens to disk", async () => {
    const store = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    await store.save("user-4", "demo", SAMPLE);
    const fs = await import("node:fs/promises");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".bin"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const blob = readFileSync(join(dir, f));
      expect(blob.includes(Buffer.from(SAMPLE.accessToken, "utf-8"))).toBe(false);
    }
  });

  it("treats a tampered ciphertext as absent (auth tag check)", async () => {
    const store = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    await store.save("user-5", "demo", SAMPLE);
    const fs = await import("node:fs/promises");
    const file = (await fs.readdir(dir)).find((f) => f.endsWith(".bin"));
    expect(file).toBeTruthy();
    const path = join(dir, file as string);
    const blob = readFileSync(path);
    const last = blob.length - 1;
    blob[last] = (blob[last] ?? 0) ^ 0xff;
    writeFileSync(path, blob);

    expect(await store.get("user-5", "demo")).toBeNull();
  });

  it("derives a stable key from a passphrase + salt", async () => {
    const env = { SUGU_TOKEN_ENC_PASSPHRASE: "correct horse battery staple" };
    const a = new FileTokenStore({ dir, env });
    await a.save("user-6", "demo", SAMPLE);
    const b = new FileTokenStore({ dir, env });
    expect(await b.get("user-6", "demo")).toEqual(SAMPLE);
  });

  it("delete() removes the persisted ciphertext", async () => {
    const store = new FileTokenStore({ dir, env: { SUGU_TOKEN_ENC_KEY: KEY_B64 } });
    await store.save("user-7", "demo", SAMPLE);
    expect(await store.get("user-7", "demo")).not.toBeNull();
    await store.delete("user-7", "demo");
    expect(await store.get("user-7", "demo")).toBeNull();
  });
});
