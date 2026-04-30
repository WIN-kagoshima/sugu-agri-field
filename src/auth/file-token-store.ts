import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StoredToken, TokenStore } from "./token-store.js";

/**
 * Production-ish file-backed token store for the Phase 4 demo flow.
 *
 * Layout:
 *   {dir}/{providerHash}-{userIdHash}.bin  — AES-256-GCM ciphertext
 *
 * Each file is the binary blob `nonce(12) || ciphertext || tag(16)`
 * so we don't need a separate index. Lookup is O(1) by deterministic
 * filename derived from `(provider, userId)`.
 *
 * Encryption key:
 *   - Provided via `SUGU_TOKEN_ENC_KEY` (base64-encoded 32 bytes), OR
 *   - Provided as a passphrase via `SUGU_TOKEN_ENC_PASSPHRASE`, in which
 *     case we derive a 32-byte key with scrypt + a salt persisted in
 *     `{dir}/.salt`. The salt is created on first run.
 *
 * The constructor THROWS if neither is set, so accidentally running
 * with an in-memory key in production is impossible.
 *
 * This is NOT a Secret Manager replacement — keys still live on disk
 * encryption-of-rest dependent. For Cloud Run prod, lift this into
 * Google Secret Manager (`secretmanager.googleapis.com/v1/projects/.../
 * secrets/sugu-token-key/versions/latest`) and inject as an env var.
 */

const NONCE_LEN = 12;
const TAG_LEN = 16;

interface FileTokenStoreOptions {
  /** Directory root for ciphertext files. Defaults to `./.tokens`. */
  dir?: string;
  /** Inject env vars in tests. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export class FileTokenStore implements TokenStore {
  private readonly dir: string;
  private readonly key: Buffer;

  constructor(options: FileTokenStoreOptions = {}) {
    this.dir = resolve(options.dir ?? "./.tokens");
    const env = options.env ?? process.env;
    this.key = resolveKeySync(this.dir, env);
  }

  private filenameFor(userId: string, provider: string): string {
    // Deterministic, opaque, no PII in filenames.
    const tag = scryptSync(`${provider}:${userId}`, this.key.subarray(0, 8), 16).toString("hex");
    return join(this.dir, `${tag}.bin`);
  }

  async get(userId: string, provider: string): Promise<StoredToken | null> {
    const file = this.filenameFor(userId, provider);
    if (!existsSync(file)) return null;
    try {
      const blob = await readFile(file);
      if (blob.length < NONCE_LEN + TAG_LEN) return null;
      const nonce = blob.subarray(0, NONCE_LEN);
      const tag = blob.subarray(blob.length - TAG_LEN);
      const ct = blob.subarray(NONCE_LEN, blob.length - TAG_LEN);
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return JSON.parse(pt.toString("utf-8")) as StoredToken;
    } catch {
      // Corrupted, wrong key, or tampered with — treat as absent.
      return null;
    }
  }

  async save(userId: string, provider: string, token: StoredToken): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.filenameFor(userId, provider);
    const nonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const pt = Buffer.from(JSON.stringify(token), "utf-8");
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([nonce, ct, tag]);

    // Atomic write so a crash mid-write never leaves a partial file.
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, blob, { mode: 0o600 });
    await rename(tmp, file);
  }

  async delete(userId: string, provider: string): Promise<void> {
    const file = this.filenameFor(userId, provider);
    if (!existsSync(file)) return;
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(file);
    } catch {
      // best-effort
    }
  }
}

function resolveKeySync(dir: string, env: NodeJS.ProcessEnv): Buffer {
  const direct = env.SUGU_TOKEN_ENC_KEY;
  if (direct) {
    const buf = Buffer.from(direct, "base64");
    if (buf.length !== 32) {
      throw new Error(
        "SUGU_TOKEN_ENC_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key).",
      );
    }
    return buf;
  }
  const passphrase = env.SUGU_TOKEN_ENC_PASSPHRASE;
  if (passphrase) {
    return deriveKeyWithSaltSync(dir, passphrase);
  }
  throw new Error(
    "FileTokenStore requires SUGU_TOKEN_ENC_KEY (32-byte base64 key) or SUGU_TOKEN_ENC_PASSPHRASE; refusing to run with no encryption key.",
  );
}

function deriveKeyWithSaltSync(dir: string, passphrase: string): Buffer {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  const saltPath = join(dir, ".salt");
  let salt: Buffer;
  if (fs.existsSync(saltPath)) {
    salt = fs.readFileSync(saltPath);
    if (salt.length !== 16) {
      throw new Error(`Corrupt salt at ${saltPath}: expected 16 bytes, got ${salt.length}`);
    }
  } else {
    salt = randomBytes(16);
    // Atomic write of salt so a crash never leaves partial salt.
    const tmp = `${saltPath}.${randomBytes(6).toString("hex")}.tmp`;
    fs.mkdirSync(dirname(saltPath), { recursive: true });
    fs.writeFileSync(tmp, salt, { mode: 0o600 });
    fs.renameSync(tmp, saltPath);
  }
  return scryptSync(passphrase, salt, 32);
}
