/**
 * Elicitation state store (Phase 4).
 *
 * Tracks pending URL-mode elicitations so the /connect/{provider} handler
 * can verify that the same user (by session cookie) is the one who triggered
 * the tool call. This is the official anti-phishing requirement.
 */

export interface ElicitationRecord {
  id: string;
  userId: string;
  provider: string;
  /** Epoch milliseconds when this record stops being valid. */
  expiresAt: number;
  /** Set after the user completes the OAuth flow. */
  completedAt: number | null;
}

export interface ElicitationStore {
  create(record: ElicitationRecord): Promise<void>;
  get(id: string): Promise<ElicitationRecord | null>;
  markComplete(id: string): Promise<void>;
}

export class InMemoryElicitationStore implements ElicitationStore {
  private readonly store = new Map<string, ElicitationRecord>();

  async create(record: ElicitationRecord): Promise<void> {
    this.store.set(record.id, record);
  }

  async get(id: string): Promise<ElicitationRecord | null> {
    const r = this.store.get(id);
    if (!r) return null;
    if (r.expiresAt < Date.now()) {
      this.store.delete(id);
      return null;
    }
    return r;
  }

  async markComplete(id: string): Promise<void> {
    const r = this.store.get(id);
    if (r) {
      r.completedAt = Date.now();
      this.store.set(id, r);
    }
  }
}
