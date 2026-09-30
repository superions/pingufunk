import { PrismaClient, Prisma } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Check the executed chain, including checksums and failed extra attempts. */
export async function validatePostgresqlLedger(prisma) {
  const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/migrations");
  const expected = readdirSync(migrationRoot)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();
  if (expected.length === 0) throw new Error("No migration history");
  const rows = await prisma.$queryRaw`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM "_prisma_migrations"
  `;
  const applied = rows
    .filter((row) => row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name)
    .sort();
  if (
    rows.some((row) => !row.finished_at && !row.rolled_back_at) ||
    JSON.stringify(applied) !== JSON.stringify(expected)
  ) {
    throw new Error("Schema migration not applied");
  }
  for (const row of rows) {
    if (!expected.includes(row.migration_name)) throw new Error("Unknown schema migration");
    const checksum = createHash("sha256")
      .update(readFileSync(resolve(migrationRoot, row.migration_name, "migration.sql")))
      .digest("hex");
    if (row.checksum !== checksum) throw new Error("Schema migration checksum changed");
  }
  return expected;
}

/** Read-only catalog validation; a correct ledger alone does not exclude drift. */
export async function validatePostgresqlStructure(pg) {
  const models = Prisma.dmmf.datamodel.models;
  const tables = await pg.$queryRaw`
    SELECT c.relname AS name, c.relkind::text AS kind, c.relrowsecurity AS rls,
      EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
      EXISTS(SELECT 1 FROM pg_rewrite r WHERE r.ev_class=c.oid) AS rules
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','f')
      AND c.relname <> '_prisma_migrations'
  `;
  const names = (values) => values.map((value) => value.name).sort();
  if (
    JSON.stringify(names(tables)) !== JSON.stringify(names(models)) ||
    tables.some((table) => table.kind !== "r" || table.rls || table.triggers || table.rules)
  )
    throw new Error("PostgreSQL relation drift");
  const columns = await pg.$queryRaw`
    SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default_value,
      EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_attrdef'::regclass
        AND dep.objid=d.oid AND dep.refobjid=pg_get_serial_sequence(
          quote_ident(n.nspname)||'.'||quote_ident(c.relname),a.attname)::regclass) AS owned_default
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname <> '_prisma_migrations'
  `;
  const types = {
    Int: "integer",
    BigInt: "bigint",
    String: "text",
    DateTime: "timestamp(3) with time zone",
  };
  for (const model of models) {
    const fields = model.fields.filter((field) => field.kind === "scalar");
    const actual = columns.filter((column) => column.table_name === model.name);
    if (JSON.stringify(names(actual)) !== JSON.stringify(names(fields)))
      throw new Error("PostgreSQL column drift");
    for (const field of fields) {
      const column = actual.find((item) => item.name === field.name);
      if (
        !types[field.type] ||
        column.type !== types[field.type] ||
        column.required !== field.isRequired
      )
        throw new Error("PostgreSQL field type or nullability drift");
      const value = field.default;
      let expected = null;
      if (typeof value === "string") expected = value;
      else if (typeof value === "number") expected = String(value);
      else if (value?.name === "now") expected = "CURRENT_TIMESTAMP";
      else if (value?.name === "autoincrement") {
        if (!column.owned_default || !column.default_value?.startsWith("nextval("))
          throw new Error("PostgreSQL sequence default drift");
        continue;
      } else if (value && !["cuid", "uuid"].includes(value.name)) {
        throw new Error("Unreviewed PostgreSQL default contract");
      }
      let actualDefault =
        (typeof value === "number" || field.type === "BigInt") && column.default_value
          ? column.default_value.replace(/::bigint$/, "").replace(/^'(\d+)'$/, "$1")
          : column.default_value;
      if (typeof value === "string" && field.type === "String") {
        const literal = /^(E)?'((?:[^']|'')*)'::text$/.exec(actualDefault ?? "");
        if (!literal) throw new Error(`PostgreSQL default drift in ${model.name}.${field.name}`);
        actualDefault = literal[2].replaceAll("''", "'");
        if (literal[1]) {
          const escapes = {
            "\\": "\\",
            "'": "'",
            b: "\b",
            n: "\n",
            r: "\r",
            t: "\t",
            f: "\f",
            v: "\v",
          };
          actualDefault = actualDefault.replace(/\\([\\'bnrtfv])/g, (_, char) => escapes[char]);
        }
      }
      if (actualDefault !== expected)
        throw new Error(`PostgreSQL default drift in ${model.name}.${field.name}`);
    }
  }
  const indexes = await pg.$queryRaw`
    SELECT c.relname AS table_name, i.indisunique AS unique, i.indisprimary AS primary,
      (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL OR NOT i.indisvalid OR NOT i.indisready) AS unsupported,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY k.ord) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname <> '_prisma_migrations'
  `;
  const expectedIndexes = [];
  for (const model of models) {
    const pk = model.fields.filter((field) => field.isId).map((field) => field.name);
    if (pk.length)
      expectedIndexes.push({ table_name: model.name, unique: true, primary: true, columns: pk });
    for (const fields of model.uniqueFields)
      expectedIndexes.push({
        table_name: model.name,
        unique: true,
        primary: false,
        columns: fields,
      });
    for (const field of model.fields.filter((field) => field.isUnique))
      expectedIndexes.push({
        table_name: model.name,
        unique: true,
        primary: false,
        columns: [field.name],
      });
  }
  let owner;
  const schema = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/schema.prisma"),
    "utf8"
  );
  for (const line of schema.split("\n")) {
    const model = /^model (\w+) \{/.exec(line);
    if (model) owner = model[1];
    const index = /^\s*@@index\(\[([\w, ]+)\]/.exec(line);
    if (index)
      expectedIndexes.push({
        table_name: owner,
        unique: false,
        primary: false,
        columns: index[1].split(",").map((field) => field.trim()),
      });
  }
  const canonical = (items) =>
    items
      .map((item) =>
        JSON.stringify({
          table_name: item.table_name,
          unique: item.unique,
          primary: item.primary,
          columns: item.columns,
        })
      )
      .sort();
  if (
    indexes.some((index) => index.unsupported) ||
    JSON.stringify(canonical(indexes)) !== JSON.stringify(canonical(expectedIndexes))
  )
    throw new Error("PostgreSQL index drift");
  const constraints = await pg.$queryRaw`
    SELECT c.relname AS table_name, con.contype::text AS kind,
      con.confdeltype::text AS on_delete, con.confupdtype::text AS on_update,
      ref.relname AS reference, rn.nspname=current_schema() AS local_reference,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY k.ord) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=ref.oid AND a.attnum=k.num ORDER BY k.ord) AS reference_columns
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_class ref ON ref.oid=con.confrelid LEFT JOIN pg_namespace rn ON rn.oid=ref.relnamespace
    WHERE n.nspname=current_schema() AND c.relname <> '_prisma_migrations' AND con.contype <> 'p'
  `;
  const expectedRelations = models.flatMap((model) =>
    model.fields
      .filter((field) => field.relationFromFields?.length)
      .map((field) => ({
        table_name: model.name,
        kind: "f",
        on_delete: "c",
        on_update: "c",
        reference: field.type,
        local_reference: true,
        columns: field.relationFromFields,
        reference_columns: field.relationToFields,
      }))
  );
  const relationKey = (items) => items.map((item) => JSON.stringify(item)).sort();
  if (JSON.stringify(relationKey(constraints)) !== JSON.stringify(relationKey(expectedRelations)))
    throw new Error("PostgreSQL relation constraint drift");
}

export async function checkPostgresqlSchema() {
  const prisma = new PrismaClient({ log: [] });
  try {
    await validatePostgresqlLedger(prisma);
    await validatePostgresqlStructure(prisma);
    await prisma.config.count();
    await prisma.migrationCheckpoint.count();
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkPostgresqlSchema();
    console.log("PostgreSQL schema ready");
  } catch {
    console.error("PostgreSQL schema unavailable or incompatible");
    process.exitCode = 1;
  }
}
