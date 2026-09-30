import { PrismaClient } from "@prisma/client";
import { assertWritesEnabled } from "@/lib/write-gate";

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
  const base = new PrismaClient({ log: [] });
  async function ensureFirstWriteCheckpoint(): Promise<void> {
    if (checkpointPersisted) return;
    if (!checkpointPending) {
      // This independent transaction commits before the model operation. A
      // failed or rolled-back operation may leave an early marker, never a late
      // one. Reject the write if PostgreSQL cannot durably record the boundary.
      checkpointPending = base.migrationCheckpoint
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
          if (!firstSuccessfulApplicationMutationLogged) {
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
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
