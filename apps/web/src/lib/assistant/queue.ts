/**
 * A first-in, first-out gate on how many answers are generated at once (plan19 section 5.3): one local GPU serves one answer at
 * a time, and a hosted provider has a rate limit of its own. Callers wait their turn; when too many are already waiting the
 * newcomer is turned away at once with `QueueFull` (a friendly "busy, try again in a moment") rather than left hanging. A caller
 * that gives up (its signal aborts) leaves the line without costing a slot. In-process: right for one instance (docs/ASSISTANT.md).
 */
export class QueueFull extends Error {
  constructor() {
    super("queue_full");
  }
}

export class QueueAborted extends Error {
  constructor() {
    super("aborted");
  }
}

export class GenerationQueue {
  private active = 0;
  private readonly waiting: Array<{ go: () => void; cancelled: boolean }> = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxWaiting: number,
  ) {}

  /** How many are running and how many are waiting, for the status line and tests. Counts only: never who. */
  get depth(): { running: number; waiting: number } {
    return { running: this.active, waiting: this.waiting.filter((w) => !w.cancelled).length };
  }

  /** Waits for a slot, runs `work`, and always gives the slot back. `onWait` is told the place in line (1 = next). */
  async run<T>(work: () => Promise<T>, options: { signal?: AbortSignal; onWait?: (position: number) => void } = {}): Promise<T> {
    if (options.signal?.aborted) throw new QueueAborted();
    if (this.active < this.concurrency) {
      this.active += 1;
    } else {
      if (this.depth.waiting >= this.maxWaiting) throw new QueueFull();
      // When a slot frees up it is handed straight to the first waiter (active stays as it is), so nobody can slip in between.
      await new Promise<void>((resolve, reject) => {
        const entry = { cancelled: false, go: () => resolve() };
        this.waiting.push(entry);
        options.onWait?.(this.depth.waiting);
        options.signal?.addEventListener(
          "abort",
          () => {
            entry.cancelled = true;
            reject(new QueueAborted());
          },
          { once: true },
        );
      });
    }
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private release(): void {
    for (;;) {
      const next = this.waiting.shift();
      if (!next) {
        this.active -= 1;
        return;
      }
      if (next.cancelled) continue;
      next.go();
      return;
    }
  }
}
