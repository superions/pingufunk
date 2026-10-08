/** Closed facts only: no free text, content IDs, URLs, paths or confidence scores. */
export const DECISION_STAGES = [
  "catalogue",
  "identity",
  "runtime",
  "language",
  "rendition",
  "availability",
  "transfer",
  "media",
  "request",
] as const;
export const DECISION_REASONS = [
  "catalogue_empty",
  "catalogue_candidates",
  "source_failed",
  "followup_failed",
  "window_limited",
  "sources_disabled",
  "budget_exhausted",
  "deadline_exceeded",
  "alias_conflict",
  "coordinate_conflict",
  "year_conflict",
  "identity_missing",
  "identity_ambiguous",
  "identity_verified",
  "runtime_invalid",
  "runtime_missing",
  "runtime_outside_tolerance",
  "runtime_verified",
  "minimum_duration",
  "language_unknown",
  "language_verified",
  "language_excluded",
  "language_conflict",
  "rendition_unavailable",
  "rendition_unverified",
  "rendition_verified",
  "probe_unsupported",
  "probe_invalid",
  "media_invalid",
  "file_unsafe",
  "file_changed",
  "expectations_invalid",
  "source_evidence_mismatch",
  "tool_unavailable",
  "tool_timeout",
  "transfer_failed",
  "media_verified",
  "request_invalid",
  "request_failed",
  "cached_response",
  "rights_unknown",
  "rights_current",
  "rights_expired",
  "rights_not_yet",
  "rights_conflict",
] as const;
export type DecisionStage = (typeof DECISION_STAGES)[number];
export type DecisionReason = (typeof DECISION_REASONS)[number];
export type EvidenceStatus = "proven" | "missing" | "conflicting" | "unavailable" | "not_required";
export interface DecisionEvent {
  stage: DecisionStage;
  reason: DecisionReason;
  evidence: EvidenceStatus;
  count: number;
}
export interface DecisionReport {
  version: 1;
  correlationId: string;
  /** Report assembly finished, not complete source coverage or a successful match. */
  state: "recorded" | "failed";
  events: DecisionEvent[];
  overflow: boolean;
}

/** Carry only closed causal facts across an exception boundary. */
export class DecisionFailure extends Error {
  readonly diagnostic: DecisionEvent;
  constructor(stage: DecisionStage, reason: DecisionReason, evidence: EvidenceStatus) {
    const event =
      parseDecisionEvent({ stage, reason, evidence, count: 1 }) ??
      ({
        stage: "request",
        reason: "request_failed",
        evidence: "unavailable",
        count: 1,
      } as const);
    // Preserve the shipped source owner's safe exception messages, never caller text.
    super(
      event.reason === "source_evidence_mismatch"
        ? "Source evidence mismatch"
        : event.reason === "source_failed"
          ? "Source evidence unavailable"
          : event.reason === "identity_missing"
            ? "Invalid source identity"
            : "Operation evidence unavailable"
    );
    this.diagnostic = event;
  }
}

/** Validate transport/data boundaries, including unexpected extra fields. */
export function parseDecisionEvent(input: unknown): DecisionEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const data = input as DecisionEvent;
    if (
      !DECISION_STAGES.includes(data.stage) ||
      !DECISION_REASONS.includes(data.reason) ||
      !["proven", "missing", "conflicting", "unavailable", "not_required"].includes(
        data.evidence
      ) ||
      !Number.isSafeInteger(data.count) ||
      data.count < 1 ||
      data.count > 1_000_000
    )
      return null;
    return { stage: data.stage, reason: data.reason, evidence: data.evidence, count: data.count };
  } catch {
    return null;
  }
}

export function parseDecisionReport(input: unknown): DecisionReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const value = input as DecisionReport;
    if (
      value.version !== 1 ||
      typeof value.correlationId !== "string" ||
      !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/.test(
        value.correlationId
      ) ||
      !["recorded", "failed"].includes(value.state) ||
      typeof value.overflow !== "boolean" ||
      !Array.isArray(value.events) ||
      value.events.length > 64
    )
      return null;
    const events = value.events.map(parseDecisionEvent);
    if (events.some((event) => event === null)) return null;
    return {
      version: 1,
      correlationId: value.correlationId,
      state: value.state,
      overflow: value.overflow,
      events: events as DecisionEvent[],
    };
  } catch {
    return null;
  }
}
