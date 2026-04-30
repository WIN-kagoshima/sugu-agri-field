/**
 * Token store for OAuth-acquired access tokens (Phase 4+).
 *
 * Phase 4 ships a dev-only encrypted-file backend; production should swap
 * to Secret Manager or equivalent. The interface is the only thing that
 * leaks into call sites.
 */

export interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string | null;
}

export interface TokenStore {
  get(userId: string, provider: string): Promise<StoredToken | null>;
  save(userId: string, provider: string, token: StoredToken): Promise<void>;
  delete(userId: string, provider: string): Promise<void>;
}

/**
 * In-memory implementation used by tests and the Phase 4 demo flow when no
 * persistent store is configured. NEVER use this in production: tokens vanish
 * on restart and are not encrypted.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly store = new Map<string, StoredToken>();

  private key(userId: string, provider: string): string {
    return `${provider}:${userId}`;
  }

  async get(userId: string, provider: string): Promise<StoredToken | null> {
    return this.store.get(this.key(userId, provider)) ?? null;
  }

  async save(userId: string, provider: string, token: StoredToken): Promise<void> {
    this.store.set(this.key(userId, provider), token);
  }

  async delete(userId: string, provider: string): Promise<void> {
    this.store.delete(this.key(userId, provider));
  }
}
