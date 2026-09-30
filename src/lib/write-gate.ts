export class MaintenanceModeError extends Error {
  constructor() {
    super("Application writes are disabled during PostgreSQL maintenance");
  }
}

export function writesEnabled(): boolean {
  return process.env.PINGUFUNK_WRITES_ENABLED === "1";
}

export function assertWritesEnabled(): void {
  if (!writesEnabled()) throw new MaintenanceModeError();
}
