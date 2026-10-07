import { expect, it } from "vitest";
import {
  DEFAULT_PRODUCT_SETTINGS,
  SETTING_DEFINITIONS,
  normalizeSetting,
  invalidSettingKeys,
} from "./settings-schema";
it("every public product default validates canonically", () => {
  for (const [key, value] of Object.entries(DEFAULT_PRODUCT_SETTINGS))
    expect(normalizeSetting(key, value)).toBe(value);
});
it.each(["matching.movie.tolerancePercent", "matching.sonarr.tolerancePercent"])(
  "shares exact whole-percent boundaries for %s",
  (key) => {
    expect(normalizeSetting(key, "000")).toBe("0");
    expect(normalizeSetting(key, "015")).toBe("15");
    expect(normalizeSetting(key, "25")).toBe("25");
    for (const value of ["", "-1", "26", "1.5", "Infinity", null, 15, {}, []])
      expect(normalizeSetting(key, value)).toBeNull();
  }
);
it("shares bounded years and keeps URLs credential-free without requiring TLS", () => {
  expect(SETTING_DEFINITIONS["matching.movie.yearTolerance"]).toMatchObject({
    min: 1,
    max: 5,
    unit: "years",
  });
  expect(normalizeSetting("integration.radarr.url", " http://example.invalid/radarr/ ")).toBe(
    "http://example.invalid/radarr/"
  );
  for (const value of [
    "https://user:pass@example.invalid",
    "http://example.invalid/?apikey=secret",
    "https://example.invalid/#token",
    "https://example.invalid/\napi",
  ])
    expect(normalizeSetting("integration.radarr.url", value)).toBeNull();
});
it("retains valid legacy decimal normalization without permissive numeric prefixes", () => {
  expect(normalizeSetting("matching.threshold", "0,70")).toBe("0.7");
  expect(normalizeSetting("matching.threshold", "0.7tail")).toBeNull();
});
it("does not invent definitions for credentials or historical unknown keys", () => {
  expect(normalizeSetting("api.sonarr.key", "private")).toBeUndefined();
  expect(normalizeSetting("legacy.key", "stored")).toBeUndefined();
  expect(
    invalidSettingKeys({
      "matching.movie.yearTolerance": "0",
      "legacy.key": "stored",
      "api.sonarr.key": "••••••••",
    })
  ).toEqual(["matching.movie.yearTolerance"]);
});
