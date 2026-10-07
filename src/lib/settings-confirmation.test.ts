import { expect, it } from "vitest";
import { confirmedSettings } from "./settings-confirmation";

const submitted = { "matching.sonarr.tolerancePercent": "015" };
it("adopts only canonical server-confirmed values", () => {
  expect(
    confirmedSettings(
      { success: true, updated: 1, settings: { "matching.sonarr.tolerancePercent": "15" } },
      submitted
    )
  ).toEqual({ "matching.sonarr.tolerancePercent": "15" });
});
it.each([
  null,
  { success: true },
  { success: false, updated: 1, settings: submitted },
  { success: true, updated: 1, settings: {} },
  { success: true, updated: 1, settings: submitted },
  { success: true, updated: 1, settings: { "matching.sonarr.tolerancePercent": "26" } },
  { success: true, updated: 1, settings: { "api.sonarr.key": "secret" } },
  { success: true, updated: 1, settings: { "matching.sonarr.tolerancePercent": null } },
])("rejects absent, incomplete, noncanonical or secret confirmations: %j", (payload) => {
  expect(() => confirmedSettings(payload, submitted)).toThrow("confirmation missing");
});
it("does not erase masked external credentials when acknowledging a no-op", () => {
  expect(
    confirmedSettings({ success: true, updated: 0, settings: {} }, { "api.sonarr.key": "••••••••" })
  ).toEqual({});
});
