import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { synchronizeOwnedSequences } from "./postgresql-verify.mjs";

const sequence = {
  sequence_schema: "public",
  sequence_name: "TvdbEpisode_id_seq",
  table_schema: "public",
  table_name: "TvdbEpisode",
  column_name: "id",
  start_value: BigInt(1),
  increment_by: BigInt(1),
  max_value: BigInt(2147483647),
  cycles: false,
};
function client(sequences = [sequence], maximum: bigint | null = null) {
  return {
    migrationCheckpoint: { count: async () => 0 },
    $queryRaw: async () => sequences,
    $queryRawUnsafe: vi.fn(async (sql: string) =>
      sql.startsWith("SELECT MAX") ? [{ maximum }] : []
    ),
  };
}

it("preserves deleted SQLite AUTOINCREMENT IDs through actual PG ownership", async () => {
  const sqlite = new DatabaseSync(":memory:", { readBigInts: true });
  try {
    sqlite.exec(
      'CREATE TABLE "TvdbEpisode" (id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO "TvdbEpisode" VALUES (1000); DELETE FROM "TvdbEpisode"'
    );
    const pg = client();
    await synchronizeOwnedSequences(pg, sqlite);
    expect(pg.$queryRawUnsafe).toHaveBeenLastCalledWith(
      "SELECT setval($1::regclass, $2::bigint, $3::boolean)",
      '"public"."TvdbEpisode_id_seq"',
      BigInt(1000),
      true
    );
  } finally {
    sqlite.close();
  }
});

it("validates every sequence before any setval and refuses overflow and cyclic drift", async () => {
  for (const drift of [
    { ...sequence, cycles: true },
    { ...sequence, increment_by: BigInt(-1) },
    { ...sequence, table_name: "foreign" },
  ]) {
    const pg = client([sequence, drift]);
    await expect(synchronizeOwnedSequences(pg)).rejects.toThrow("ownership");
    expect(pg.$queryRawUnsafe.mock.calls.some(([sql]) => sql.startsWith("SELECT setval"))).toBe(
      false
    );
  }
  const pg = client([{ ...sequence, increment_by: BigInt(2) }], BigInt(2147483646));
  await expect(synchronizeOwnedSequences(pg)).rejects.toThrow("exhausted");
  expect(pg.$queryRawUnsafe.mock.calls.some(([sql]) => sql.startsWith("SELECT setval"))).toBe(
    false
  );
});
