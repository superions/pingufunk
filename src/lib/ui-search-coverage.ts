import type { UiSearchCoverage } from "@/types";

/** Only closed coverage fields enter UI state, never provider exception text. */
export function parseUiSearchCoverage(value: unknown, returned: number): UiSearchCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coverage = value as Record<string, unknown>;
  const count = (input: unknown, max: number) =>
    typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && input <= max;
  if (
    typeof coverage.complete !== "boolean" ||
    typeof coverage.candidateWindowLimited !== "boolean" ||
    typeof coverage.resultLimitReached !== "boolean" ||
    !count(coverage.eligibleCount, 5100) ||
    !count(coverage.returnedCount, 100) ||
    coverage.returnedCount !== returned ||
    (coverage.eligibleCount as number) < returned ||
    coverage.resultLimitReached !== (coverage.eligibleCount as number) > returned ||
    !Array.isArray(coverage.sources) ||
    coverage.sources.length < 1 ||
    coverage.sources.length > 3
  )
    return null;
  const ids = new Set<string>();
  const sources: UiSearchCoverage["sources"] = [];
  for (const source of coverage.sources) {
    if (
      !source ||
      typeof source !== "object" ||
      !["mediathekview", "orf", "srf"].includes(source.providerId) ||
      ids.has(source.providerId) ||
      !["complete", "failed", "disabled"].includes(source.state) ||
      !count(source.candidateCount, 5000) ||
      (source.state !== "complete" && source.candidateCount !== 0)
    )
      return null;
    ids.add(source.providerId);
    sources.push({
      providerId: source.providerId,
      state: source.state,
      candidateCount: source.candidateCount,
    });
  }
  if (coverage.complete !== sources.every((source) => source.state !== "failed")) return null;
  return {
    complete: coverage.complete,
    candidateWindowLimited: coverage.candidateWindowLimited,
    resultLimitReached: coverage.resultLimitReached,
    eligibleCount: coverage.eligibleCount as number,
    returnedCount: returned,
    sources,
  };
}
