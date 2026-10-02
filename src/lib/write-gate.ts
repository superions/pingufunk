import { resolveDatabaseConfig } from "../../scripts/database-config.mjs";

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
  try {
    return resolveDatabaseConfig().provider === "sqlite";
  } catch {
    return false;
  }
}

export function assertWritesEnabled(): void {
  if (!writesEnabled()) throw new MaintenanceModeError();
}
