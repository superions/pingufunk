import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSmokeSource } from "./postgresql-smoke-fixture.mjs";
import {
  knownShapes,
  schemaShape,
  validateSourceLedger,
  modelNames,
  sourceRows,
} from "./sqlite-schema.mjs";

it.each(["bootstrap", "current"])("builds an exclusive %s rollback source", (variant) => {
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-smoke-fixture-"));
  const source = join(dir, "source.sqlite");
  try {
    createSmokeSource(source, variant);
    const before = readFileSync(source);
    expect(() => createSmokeSource(source, variant)).toThrow();
    expect(readFileSync(source)).toEqual(before);
    const db = new DatabaseSync(source, { readOnly: true, readBigInts: true });
    try {
      expect(schemaShape(db)).toEqual(knownShapes()[variant as "bootstrap" | "current"]);
      expect(validateSourceLedger(db, variant)).toHaveLength(variant === "current" ? 6 : 0);
      expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      for (const model of modelNames)
        expect(Array.from(sourceRows(db, model))).toHaveLength(
          model === "EnqueueIntent" && variant === "bootstrap" ? 0 : 1
        );
      const row = db.prepare("SELECT * FROM Download").get();
      expect(row?.id).toBe("smoke-download");
      expect(row?.size).toBe(BigInt("9007199254740993"));
      if (variant === "current") {
        expect(row?.mediaExpectations).toBe(
          '{ "version":1, "duration":null, "audio":null, "resolution":null }'
        );
        expect(JSON.parse(String(row?.mediaValidation)).video).toEqual([
          { width: 320, height: 180 },
        ]);
      } else {
        expect(row).not.toHaveProperty("mediaExpectations");
        expect(row).not.toHaveProperty("mediaValidation");
      }
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects unknown source variants before creating a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-smoke-variant-"));
  const source = join(dir, "source.sqlite");
  try {
    expect(() => createSmokeSource(source, "foreign")).toThrow("Unknown synthetic variant");
    expect(() => readFileSync(source)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
