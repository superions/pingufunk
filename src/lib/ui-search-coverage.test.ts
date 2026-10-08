import { expect, it } from "vitest";
import { parseUiSearchCoverage } from "./ui-search-coverage";

const coverage = {
  complete: true,
  candidateWindowLimited: false,
  resultLimitReached: false,
  eligibleCount: 1,
  returnedCount: 1,
  sources: [{ providerId: "mediathekview", state: "complete", candidateCount: 4 }],
};

it("confirms bounded response counts and discards extra response text", () => {
  expect(parseUiSearchCoverage({ ...coverage, rawError: "never-display" }, 1)).toEqual(coverage);
});
it("preserves explicit partial and bounded retrieval without implying a catalogue total", () => {
  const partial = {
    ...coverage,
    complete: false,
    candidateWindowLimited: true,
    resultLimitReached: true,
    eligibleCount: 3,
    sources: [...coverage.sources, { providerId: "srf", state: "failed", candidateCount: 0 }],
  };
  expect(parseUiSearchCoverage(partial, 1)).toEqual(partial);
});
it.each([
  null,
  { ...coverage, returnedCount: 2 },
  { ...coverage, eligibleCount: -1 },
  { ...coverage, eligibleCount: 5101 },
  { ...coverage, resultLimitReached: true },
  { ...coverage, complete: false },
  { ...coverage, sources: [...coverage.sources, ...coverage.sources] },
  {
    ...coverage,
    sources: [{ providerId: "https://private.invalid", state: "complete", candidateCount: 1 }],
  },
  { ...coverage, sources: [{ providerId: "srf", state: "failed", candidateCount: 1 }] },
])("rejects contradictory, malformed or overflow coverage (%j)", (value) => {
  expect(parseUiSearchCoverage(value, 1)).toBeNull();
});
