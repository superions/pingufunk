/** Migration transport follows an explicit URL choice, never connection failure. */
export function postgresqlRequiresTls(value = process.env.DATABASE_URL) {
  if (value === undefined) return true;
  try {
    const url = new URL(value);
    const modes = url.searchParams.getAll("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      modes.length > 1 ||
      (modes.length === 1 && !["require", "disable"].includes(modes[0]))
    )
      throw new Error();
    // `prefer` would permit a silent TLS downgrade and is not a cutover policy.
    return modes[0] !== "disable";
  } catch {
    throw new Error("Invalid PostgreSQL migration transport configuration");
  }
}
