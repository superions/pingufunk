import { expect, it } from "vitest";
import { convertRow, importOrder } from "./postgresql-row-transform.mjs";
import { sourceFieldContract } from "./postgresql-preflight.mjs";

function fixture(model: keyof typeof sourceFieldContract) {
  const contract = sourceFieldContract[model] as {
    int?: string[];
    bigint?: string[];
    date?: string[];
    text?: string[];
    required: string[];
  };
  return Object.fromEntries(
    Object.values(contract)
      .flat()
      .map((field) => {
        if (contract.int?.includes(field)) return [field, BigInt(1)];
        if (contract.bigint?.includes(field)) return [field, BigInt("9007199254740993")];
        if (contract.date?.includes(field)) return [field, BigInt("1780228800123")];
        return [field, "synthetic"];
      })
  ) as Record<string, unknown>;
}

it("covers every application model and preserves BigInt and original identity", () => {
  expect(importOrder.map(([model]) => model).sort()).toEqual(
    Object.keys(sourceFieldContract).sort()
  );
  const row = fixture("Download");
  row.id = "uuid-stays-exact";
  row.error = null;
  const result = convertRow("Download", row) as Record<string, unknown>;
  expect(result.id).toBe("uuid-stays-exact");
  expect(result.size).toBe(BigInt("9007199254740993"));
  expect(result.createdAt).toEqual(new Date(1780228800123));
  expect(result.error).toBeNull();
});

it("normalizes a timezone offset to the same millisecond instant", () => {
  const row = fixture("GeneratedRuleset");
  row.filters = '[{"attribute":"duration","value":"15"}]';
  row.episodeRegex = "(?<=[E/])(\\d{2})(?=\\))";
  row.createdAt = "2026-09-30T14:00:00.123+02:00";
  const result = convertRow("GeneratedRuleset", row) as Record<string, unknown>;
  expect((result.createdAt as Date).toISOString()).toBe("2026-09-30T12:00:00.123Z");
  expect(result.filters).toBe(row.filters);
  expect(result.episodeRegex).toBe(row.episodeRegex);
});

it("does not synthesize required null, unknown fields or ambiguous dates", () => {
  expect(() => convertRow("Config", { key: "token", value: null })).toThrow("Required null");
  expect(() => convertRow("Config", { key: "token", value: "secret", extra: BigInt(1) })).toThrow(
    "Unknown field"
  );
  const row = fixture("Download");
  row.createdAt = "2026-09-30 12:00:00";
  expect(() => convertRow("Download", row)).toThrow("Invalid timestamp");
});
