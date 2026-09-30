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

function createClient() {
  return new PrismaClient({ log: [] }).$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          if (!MUTATIONS.has(operation)) return query(args);
          assertWritesEnabled();
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
