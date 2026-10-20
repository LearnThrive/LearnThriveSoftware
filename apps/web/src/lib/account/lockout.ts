/**
 * Sign-in lockout: counts FAILED attempts only (a string of correct sign-ins never depletes anything), per account
 * and per visitor address, so one address cannot guess at many accounts and many addresses cannot grind at one.
 * In-process, like lib/rate-limit.ts: right for one Render instance, a second layer behind Supabase's own limits.
 */
export interface LockoutRule {
  max: number;
  windowMs: number;
}

export const lockoutRules = {
  /** Failed sign-ins for one email address, from anywhere. */
  perAccount: { max: 8, windowMs: 15 * 60 * 1000 },
  /** Failed sign-ins from one address, across all accounts. */
  perAddress: { max: 20, windowMs: 15 * 60 * 1000 },
} as const;

class FailureCounter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly rule: LockoutRule) {}

  private recent(key: string, now: number): number[] {
    const fresh = (this.hits.get(key) ?? []).filter((at) => now - at < this.rule.windowMs);
    if (fresh.length === 0) this.hits.delete(key);
    else this.hits.set(key, fresh);
    return fresh;
  }

  locked(key: string, now: number): boolean {
    return this.recent(key, now).length >= this.rule.max;
  }

  record(key: string, now: number): void {
    const fresh = this.recent(key, now);
    fresh.push(now);
    this.hits.set(key, fresh);
    if (this.hits.size > 5000) for (const k of [...this.hits.keys()]) this.recent(k, now);
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}

export class SignInLockout {
  private readonly accounts: FailureCounter;
  private readonly addresses: FailureCounter;

  constructor(rules: { perAccount: LockoutRule; perAddress: LockoutRule } = lockoutRules) {
    this.accounts = new FailureCounter(rules.perAccount);
    this.addresses = new FailureCounter(rules.perAddress);
  }

  /** True if either the account or the address has used up its failures. Checked before the password is. */
  locked(email: string, address: string, now: number = Date.now()): boolean {
    return this.accounts.locked(email, now) || this.addresses.locked(address, now);
  }

  recordFailure(email: string, address: string, now: number = Date.now()): void {
    this.accounts.record(email, now);
    this.addresses.record(address, now);
  }

  /** A correct sign-in clears the account's count (not the address's: that guards against guessing elsewhere). */
  recordSuccess(email: string): void {
    this.accounts.clear(email);
  }
}
