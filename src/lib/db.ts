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

function createClient() {
  return new PrismaClient({ log: [] }).$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          if (MUTATIONS.has(operation)) assertWritesEnabled();
          return query(args);
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
