import { afterEach, expect, it, vi } from "vitest";
import {
  DECISION_REASONS,
  DECISION_STAGES,
  parseDecisionEvent,
  parseDecisionReport,
} from "@/lib/decision-diagnostics";
import {
  recordDecision,
  withDecisionDiagnostics,
  readDecisionReport,
} from "./decision-diagnostics";

afterEach(() => vi.restoreAllMocks());

it("isolates simultaneous requests and aggregates only bounded closed facts", async () => {
  const results = await Promise.all(
    ["year_conflict", "alias_conflict"].map((reason) =>
      withDecisionDiagnostics(async () => {
        await Promise.resolve();
        recordDecision("identity", reason as "year_conflict", "conflicting", 2);
        recordDecision("identity", reason as "year_conflict", "conflicting", 3);
      })
    )
  );
  expect(results[0].report.correlationId).not.toBe(results[1].report.correlationId);
  results.forEach(({ report }, index) =>
    expect(report.events).toEqual([
      {
        stage: "identity",
        reason: index ? "alias_conflict" : "year_conflict",
        evidence: "conflicting",
        count: 5,
      },
    ])
  );
  const id = results[0].report.correlationId;
  results[0].report.events[0].count = 123;
  expect(readDecisionReport(id)?.events[0].count).toBe(5);
});

it("discards injected free strings, throwing accessors and out-of-range counts", async () => {
  const { report } = await withDecisionDiagnostics(async () => {
    recordDecision("identity", "https://user:secret@example.invalid/path" as never, "missing");
    recordDecision("identity", "identity_missing", "secret" as never);
    recordDecision("identity", "identity_missing", "missing", Infinity);
    recordDecision("identity", "identity_missing", "missing", 1_000_000);
    recordDecision("identity", "identity_missing", "missing", 1);
  });
  expect(report.overflow).toBe(true);
  expect(report.events).toEqual([
    { stage: "identity", reason: "identity_missing", evidence: "missing", count: 1_000_000 },
  ]);
  expect(JSON.stringify(report)).not.toMatch(/secret|example\.invalid|path/);
  expect(
    parseDecisionEvent({
      get stage() {
        throw new Error("private");
      },
    })
  ).toBeNull();
  expect(
    parseDecisionEvent({
      stage: "identity",
      reason: "identity_verified",
      evidence: "proven",
      count: 1,
      url: "secret",
    })
  ).toEqual({ stage: "identity", reason: "identity_verified", evidence: "proven", count: 1 });
});

it("bounds event combinations, stored reports and their TTL without storing searches", async () => {
  const { report } = await withDecisionDiagnostics(async () => {
    for (const stage of DECISION_STAGES)
      for (const reason of DECISION_REASONS) recordDecision(stage, reason, "missing");
  });
  expect(report.events).toHaveLength(64);
  expect(report.overflow).toBe(true);
  for (let i = 0; i < 128; i++) await withDecisionDiagnostics(async () => {});
  expect(readDecisionReport(report.correlationId)).toBeNull();
  const last = await withDecisionDiagnostics(async () => {});
  expect(readDecisionReport(last.report.correlationId)).not.toBeNull();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
  expect(readDecisionReport(last.report.correlationId)).toBeNull();
});

it("does not let late asynchronous work change a finalized request", async () => {
  let release!: () => void;
  let late!: Promise<void>;
  const { report } = await withDecisionDiagnostics(async () => {
    late = new Promise<void>((resolve) => {
      release = resolve;
    }).then(() => recordDecision("identity", "identity_verified", "proven"));
  });
  release();
  await late;
  expect(readDecisionReport(report.correlationId)?.events).toEqual([]);
});

it("confirms only a bounded report and discards extra transport data", async () => {
  const { report } = await withDecisionDiagnostics(async () =>
    recordDecision("catalogue", "catalogue_empty", "proven")
  );
  expect(parseDecisionReport({ ...report, private: "token" })).toEqual(report);
  expect(parseDecisionReport({ ...report, state: "complete" })).toBeNull();
  expect(parseDecisionReport({ ...report, correlationId: "private/path" })).toBeNull();
  expect(
    parseDecisionReport({ ...report, events: Array.from({ length: 65 }, () => report.events[0]) })
  ).toBeNull();
  expect(
    parseDecisionReport({ ...report, events: [{ ...report.events[0], reason: "private" }] })
  ).toBeNull();
});

it("caps simultaneous report collection rather than growing with request concurrency", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = Array.from({ length: 128 }, () =>
    withDecisionDiagnostics(async () => {
      await gate;
      recordDecision("identity", "identity_verified", "proven");
    })
  );
  try {
    const overflow = await withDecisionDiagnostics(async () =>
      recordDecision("identity", "identity_verified", "proven")
    );
    expect(overflow.report.overflow).toBe(true);
    expect(overflow.report.events).toEqual([]);
  } finally {
    release();
    await Promise.all(active);
  }
});
