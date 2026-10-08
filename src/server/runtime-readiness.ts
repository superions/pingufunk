import path from "node:path";
import { readBoundedProcess } from "./bounded-process";
import { writesEnabled } from "@/lib/write-gate";
import { getWorkerRuntimeState } from "./download-manager";

interface SchemaReadiness {
  ready: boolean;
  state: "compatible" | "unavailable" | "timeout";
}
let cache: { expires: number; value: SchemaReadiness } | null = null;
let pending: Promise<SchemaReadiness> | null = null;

/** Full existing read-only schema/ledger checks run off the request's event loop. */
export async function getSchemaReadiness(): Promise<SchemaReadiness> {
  if (cache && cache.expires > Date.now()) return cache.value;
  if (pending) return pending;
  pending = readBoundedProcess(
    process.execPath,
    [path.join(process.cwd(), "scripts/check-database-schema.mjs")],
    3000
  ).then((result) => {
    const ready =
      result.state === "ok" && /^(sqlite|postgresql) schema ready\s*$/.test(result.output);
    const value: SchemaReadiness = {
      ready,
      state: ready ? "compatible" : result.state === "timeout" ? "timeout" : "unavailable",
    };
    cache = { expires: Date.now() + (ready ? 10_000 : 1000), value };
    return value;
  });
  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export function runtimeState(schema: SchemaReadiness) {
  const enabled = writesEnabled();
  return {
    liveness: "alive" as const,
    schema,
    writesEnabled: enabled,
    worker: { ...getWorkerRuntimeState(), ...(!enabled ? { state: "disabled" } : {}) },
  };
}

/** Bound awaiting a read; this is not cancellation or retry permission for a mutation. */
export async function boundedRuntimeRead<T>(operation: Promise<T>, timeoutMs = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Runtime read unavailable")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
