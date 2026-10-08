import { describe, expect, it } from "vitest";
import {
  sourceEpoch,
  sourceInstant,
  sourceAvailabilityState,
  type SourceAvailability,
} from "./content-dates";

it.each([undefined, null, 0, -1, NaN, Infinity, "1700000000"])(
  "keeps absent/invalid epoch %s unknown",
  (value) => {
    expect(sourceEpoch(value)).toBeUndefined();
  }
);
it.each([
  "2026-02-30T00:00:00Z",
  "2026-01-01",
  "2026-01-01T00:00:00",
  "2026-13-01T00:00:00Z",
  "2026-01-01T24:00:00Z",
  "2026-01-01T00:00:60Z",
  "2026-01-01T00:00:00+25:00",
])("rejects non-instant or impossible rights date %s", (value) => {
  expect(sourceInstant(value)).toBeNull();
});
it("normalizes explicit offset instants without treating an aired day as rights", () => {
  expect(sourceInstant("2026-01-01T01:30:00+01:30")).toBe(sourceInstant("2026-01-01T00:00:00Z"));
  expect(sourceInstant("2024-02-29T00:00:00.001Z")).toBe(
    Date.parse("2024-02-29T00:00:00.001Z") / 1000
  );
});
describe("exact-rendition rights", () => {
  const url = "https://example.invalid/current.mp4?token=current";
  const rights: SourceAvailability = {
    state: "declared_rights",
    provenance: "arte_player",
    checkedAt: 1000,
    beginsAt: 900,
    endsAt: 1100,
    urls: [url],
  };
  it("checks inclusive bounds independently of provider date/metadata airdate", () => {
    expect(sourceAvailabilityState(rights, url, 1000)).toBe("rights_current");
    expect(sourceAvailabilityState({ ...rights, checkedAt: 899 }, url, 899)).toBe("not_yet");
    expect(sourceAvailabilityState(rights, url, 1100)).toBe("rights_current");
    expect(sourceAvailabilityState(rights, url, 1101)).toBe("expired");
  });
  it("never transfers programme rights to an unrelated or signature-rotated URL", () => {
    expect(
      sourceAvailabilityState(rights, url.replace("token=current", "token=rotated"), 1000)
    ).toBe("unknown");
    expect(sourceAvailabilityState(undefined, url, 1000)).toBe("unknown");
    expect(sourceAvailabilityState({ state: "unknown" }, url, 1000)).toBe("unknown");
    expect(sourceAvailabilityState({ ...rights, beginsAt: 1200 }, url, 1000)).toBe("conflicting");
    expect(sourceAvailabilityState({ ...rights, checkedAt: 1001 }, url, 1000)).toBe("conflicting");
  });
});
