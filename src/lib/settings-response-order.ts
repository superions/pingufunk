/** Client response ordering, not a second settings/validation owner. */
export class SettingsResponseOrder {
  private generation = 0;
  private pendingWrites = 0;
  private writes: Promise<void> = Promise.resolve();

  beginRead(): number {
    return ++this.generation;
  }

  isCurrent(read: number): boolean {
    return read === this.generation && this.pendingWrites === 0;
  }

  enqueueWrite(operation: () => Promise<void>): Promise<void> {
    // Even a queued write supersedes an earlier read. A read during a write
    // must not publish a precommit value, irrespective of response timing.
    ++this.generation;
    ++this.pendingWrites;
    const pending = this.writes
      .catch(() => {})
      .then(async () => {
        try {
          await operation();
        } finally {
          --this.pendingWrites;
          ++this.generation;
        }
      });
    this.writes = pending;
    return pending;
  }
}
