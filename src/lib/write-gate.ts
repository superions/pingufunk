export class MaintenanceModeError extends Error {
  constructor() {
    super("Application writes are disabled during database maintenance");
  }
}

export function writesEnabled(): boolean {
  const enabled = process.env.PINGUFUNK_WRITES_ENABLED;
  if (enabled !== undefined) return enabled === "1";
  // Existing SQLite installations remain usable; PG starts conservatively
  // until its separately approved migration has reached write release.
  return (process.env.DATABASE_PROVIDER ?? "sqlite") === "sqlite";
}

export function assertWritesEnabled(): void {
  if (!writesEnabled()) throw new MaintenanceModeError();
}
