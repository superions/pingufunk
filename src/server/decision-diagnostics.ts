import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  DecisionFailure,
  parseDecisionEvent,
  type DecisionEvent,
  type DecisionReport,
  type DecisionStage,
  type DecisionReason,
  type EvidenceStatus,
} from "@/lib/decision-diagnostics";

const CAPACITY = 128;
const EVENT_CAPACITY = 64;
const TTL_MS = 5 * 60_000;
interface Context {
  events: Map<string, DecisionEvent>;
  overflow: boolean;
  closed: boolean;
}
const scope = new AsyncLocalStorage<Context>();
const reports = new Map<string, { report: DecisionReport; expires: number }>();
let active = 0;

/** Preserve categorical evidence through safe exceptions and this request's report. */
export function decisionFailure(
  stage: DecisionStage,
  reason: DecisionReason,
  evidence: EvidenceStatus
): DecisionFailure {
  const error = new DecisionFailure(stage, reason, evidence);
  const event = error.diagnostic;
  recordDecision(event.stage, event.reason, event.evidence);
  return error;
}

/** Aggregate bounded categorical facts in this request only, never a private search string. */
export function recordDecision(
  stage: DecisionStage,
  reason: DecisionReason,
  evidence: EvidenceStatus,
  count = 1
): void {
  const context = scope.getStore();
  if (!context || context.closed) return;
  const event = parseDecisionEvent({ stage, reason, evidence, count });
  if (!event) {
    context.overflow = true;
    return;
  }
  const key = `${event.stage}:${event.reason}:${event.evidence}`;
  const existing = context.events.get(key);
  if (existing) {
    const sum = existing.count + event.count;
    existing.count = Math.min(1_000_000, sum);
    if (sum > 1_000_000) context.overflow = true;
  } else if (context.events.size < EVENT_CAPACITY) context.events.set(key, event);
  else context.overflow = true;
}

function expireReports() {
  for (const [id, entry] of reports) if (entry.expires <= Date.now()) reports.delete(id);
}

/** New random correlation per operation; caller headers never select another report. */
export async function withDecisionDiagnostics<T>(operation: () => Promise<T>): Promise<{
  result: T;
  report: DecisionReport;
}> {
  const id = randomUUID();
  const context: Context = { events: new Map(), overflow: active >= CAPACITY, closed: false };
  const enrolled = active < CAPACITY;
  if (enrolled) active++;
  let state: DecisionReport["state"] = "recorded";
  let report!: DecisionReport;
  let result!: T;
  try {
    result = await scope.run(enrolled ? context : { ...context, closed: true }, operation);
  } catch (error) {
    state = "failed";
    throw error;
  } finally {
    context.closed = true;
    if (enrolled) active--;
    report = {
      version: 1,
      correlationId: id,
      state,
      events: [...context.events.values()],
      overflow: context.overflow,
    };
    expireReports();
    while (reports.size >= CAPACITY) reports.delete(reports.keys().next().value!);
    reports.set(id, { report, expires: Date.now() + TTL_MS });
  }
  return { result, report: structuredClone(report) };
}

/** Internal lookup only. No HTTP reader is implicitly authorized by this owner. */
export function readDecisionReport(id: string): DecisionReport | null {
  expireReports();
  if (!/^[a-f\d-]{36}$/.test(id)) return null;
  const report = reports.get(id)?.report;
  return report ? structuredClone(report) : null;
}
