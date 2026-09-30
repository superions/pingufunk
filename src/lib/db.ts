import { PrismaClient as PostgresqlClient } from "@prisma/client";
import { PrismaClient as SqliteClient } from "../../generated/sqlite";
import { assertWritesEnabled } from "@/lib/write-gate";
import { resolveDatabaseConfig } from "../../scripts/database-config.mjs";
import { createHash } from "node:crypto";

function configuration() {
  try {
    return resolveDatabaseConfig();
  } catch {
    // URL parsing and filesystem errors may expose connection/secret inputs.
    throw new Error("Invalid database configuration");
  }
}
const config = configuration();
export const databaseProvider = config.provider;

const MUTATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);
let firstSuccessfulApplicationMutationLogged = false;
let checkpointPersisted = false;
let checkpointPending: Promise<void> | null = null;

function createClient() {
  const pg =
    config.provider === "postgresql"
      ? new PostgresqlClient({ log: [], datasourceUrl: config.url })
      : null;
  // Only the six shared domain models are exposed. Generated DMMF parity and
  // real CRUD tests protect this structural boundary; the PG checkpoint stays
  // private to its owner and cannot be called against SQLite.
  const base = pg
    ? (pg as unknown as SqliteClient)
    : new SqliteClient({ log: [], datasourceUrl: config.url });
  async function ensureFirstWriteCheckpoint(): Promise<void> {
    if (!pg || checkpointPersisted) return;
    if (!checkpointPending) {
      // This independent transaction commits before the model operation. A
      // failed or rolled-back operation may leave an early marker, never a late
      // one. Reject the write if PostgreSQL cannot durably record the boundary.
      checkpointPending = pg.migrationCheckpoint
        .createMany({ data: [{ key: "first_application_write" }], skipDuplicates: true })
        .then(() => {
          checkpointPersisted = true;
        })
        .finally(() => {
          checkpointPending = null;
        });
    }
    await checkpointPending;
  }
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          if (!MUTATIONS.has(operation)) return query(args);
          assertWritesEnabled();
          await ensureFirstWriteCheckpoint();
          const result = await query(args);
          if (pg && !firstSuccessfulApplicationMutationLogged) {
            firstSuccessfulApplicationMutationLogged = true;
            // Conservative boundary: a statement inside a later-rolled-back
            // transaction may still log, never the reverse. No row data leaks.
            console.warn(
              "[Migration] First application PostgreSQL mutation observed; SQLite rollback requires reconciliation"
            );
          }
          return result;
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
  prismaIdentity?: string;
};

const identity = createHash("sha256").update(`${config.provider}\0${config.url}`).digest("hex");
// HMR must not reuse a connection to the previous provider or database.
if (globalForPrisma.prisma && globalForPrisma.prismaIdentity !== identity)
  throw new Error("Database configuration changed; restart the application");

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaIdentity = identity;
}

/** Provider-specific size queries stay out of the shared route contract. */
export async function databaseSizeBytes(): Promise<number> {
  let bytes: number;
  if (databaseProvider === "postgresql") {
    const [row] = await prisma.$queryRaw<Array<{ bytes: string }>>`
      SELECT pg_database_size(current_database())::text AS bytes
    `;
    bytes = Number(row.bytes);
  } else {
    const [pages] = await prisma.$queryRaw<
      Array<{ page_count: number | bigint }>
    >`PRAGMA page_count`;
    const [size] = await prisma.$queryRaw<Array<{ page_size: number | bigint }>>`PRAGMA page_size`;
    bytes = Number(pages.page_count) * Number(size.page_size);
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error("Database size is not representable");
  return bytes;
}
