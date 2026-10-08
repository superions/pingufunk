import { describe, expect, it } from "vitest";
import { clearSubmittedFields } from "./use-settings-form";

describe("confirmed card drafts", () => {
  it("clears only confirmed submitted fields and preserves another card", () => {
    const draft = {
      "matching.movie.tolerancePercent": "12",
      "matching.sonarr.tolerancePercent": "15",
      "integration.radarr.inventoryMaxMiB": "11",
    };
    expect(
      clearSubmittedFields(draft, {
        "matching.movie.tolerancePercent": "12",
        "matching.sonarr.tolerancePercent": "15",
      })
    ).toEqual({ "integration.radarr.inventoryMaxMiB": "11" });
    expect(draft["matching.movie.tolerancePercent"]).toBe("12");
  });
  it("keeps a newer edit of the same field while a previous save is in flight", () => {
    expect(
      clearSubmittedFields(
        { "matching.movie.yearTolerance": "3" },
        {
          "matching.movie.yearTolerance": "2",
        }
      )
    ).toEqual({ "matching.movie.yearTolerance": "3" });
  });
  it("does not invent a draft for an absent submitted field", () => {
    expect(clearSubmittedFields({}, { "matching.movie.yearTolerance": "2" })).toEqual({});
  });
});
