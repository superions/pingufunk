import { convertRow, importOrder } from "./postgresql-row-transform.mjs";

function equalValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

/** Compare every source field after typed conversion; reports no row payloads. */
export async function verifyRows(sqlite, pg, sourceCounts) {
  for (const [table, delegate] of importOrder) {
    const count = await pg[delegate].count();
    if (BigInt(count).toString() !== sourceCounts[table])
      throw new Error(`Row count mismatch in ${table}`);
    const primaryKey = table === "Config" ? "key" : "id";
    for (const row of sqlite.prepare(`SELECT * FROM "${table}"`).iterate()) {
      const expected = convertRow(table, row);
      const actual = await pg[delegate].findUnique({
        where: { [primaryKey]: expected[primaryKey] },
      });
      if (!actual) throw new Error(`Missing PostgreSQL row in ${table}`);
      for (const [field, value] of Object.entries(expected)) {
        if (!equalValue(value, actual[field]))
          throw new Error(`Value mismatch in ${table}.${field}`);
      }
    }
  }
  return { verifiedModels: importOrder.length };
}

function quote(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * setval is not rolled back by PostgreSQL transactions. Call only after a
 * committed, semantically verified import with application writers stopped.
 * Re-running is safe while that no-writer condition remains true.
 */
export async function synchronizeOwnedSequences(
  pg,
  sqlite = /** @type {import('node:sqlite').DatabaseSync | null} */ (null)
) {
  if ((await pg.migrationCheckpoint.count()) !== 0)
    throw new Error("Application PostgreSQL write checkpoint already exists");
  const sequences = await pg.$queryRaw`
    SELECT sns.nspname AS sequence_schema, seq.relname AS sequence_name,
           tns.nspname AS table_schema, tbl.relname AS table_name,
           att.attname AS column_name, ps.seqstart AS start_value,
           ps.seqincrement AS increment_by, ps.seqmax AS max_value,
           ps.seqcycle AS cycles
    FROM pg_class seq
    JOIN pg_namespace sns ON sns.oid = seq.relnamespace
    JOIN pg_sequence ps ON ps.seqrelid = seq.oid
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
    JOIN pg_class tbl ON tbl.oid = dep.refobjid
    JOIN pg_namespace tns ON tns.oid = tbl.relnamespace
    JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S' AND tns.nspname = current_schema()
  `;
  const ownedTables = new Set(importOrder.map(([table]) => table));
  const highWater = new Map();
  if (sqlite?.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
    for (const { name, seq } of sqlite.prepare("SELECT name,seq FROM sqlite_sequence").all()) {
      if (!ownedTables.has(name) || typeof seq !== "bigint" || seq < 0n)
        throw new Error("Unexpected SQLite sequence high-water mark");
      highWater.set(name, seq);
    }
  }
  const plans = [];
  for (const sequence of sequences) {
    if (!ownedTables.has(sequence.table_name) || sequence.increment_by <= 0n || sequence.cycles)
      throw new Error("Unexpected PostgreSQL sequence ownership");
    const table = `${quote(sequence.table_schema)}.${quote(sequence.table_name)}`;
    const column = quote(sequence.column_name);
    const [{ maximum }] = await pg.$queryRawUnsafe(
      `SELECT MAX(${column}) AS maximum FROM ${table}`
    );
    const start = BigInt(sequence.start_value);
    let max = maximum === null ? null : BigInt(maximum);
    const sourceHigh = highWater.get(sequence.table_name);
    if (sourceHigh !== undefined) {
      // SQLite AUTOINCREMENT belongs to the integer primary key, not any
      // arbitrary column. Preserve deleted IDs only for matching ownership.
      const columns = sqlite.prepare(`PRAGMA table_info(${quote(sequence.table_name)})`).all();
      const pk = columns.filter((column) => Number(column.pk) > 0);
      if (pk.length !== 1 || pk[0].name !== sequence.column_name)
        throw new Error("SQLite and PostgreSQL sequence ownership differs");
      if (max === null || sourceHigh > max) max = sourceHigh;
    }
    const useMaximum = max !== null && max >= start;
    const nextBase = useMaximum ? max : start;
    if (
      (useMaximum ? nextBase + BigInt(sequence.increment_by) : nextBase) >
      BigInt(sequence.max_value)
    )
      throw new Error("PostgreSQL sequence exhausted");
    const qualifiedSequence = `${quote(sequence.sequence_schema)}.${quote(sequence.sequence_name)}`;
    plans.push({ qualifiedSequence, nextBase, useMaximum });
  }
  // Validate every plan before the first nontransactional setval side effect.
  for (const { qualifiedSequence, nextBase, useMaximum } of plans) {
    await pg.$queryRawUnsafe(
      "SELECT setval($1::regclass, $2::bigint, $3::boolean)",
      qualifiedSequence,
      nextBase,
      useMaximum
    );
  }
  return { adjustedSequences: sequences.length };
}
