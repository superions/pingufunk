import { expect, it } from "vitest";
import { catalogueMetadata } from "./catalogue-metadata";
import { sourceDay } from "./content-dates";

it.each(["2024-02-29", "2000-02-29", "2026-10-25", "9999-12-31"])(
  "retains a genuine day without an invented instant: %s",
  (day) => {
    expect(sourceDay(day)).toBe(day);
    expect(catalogueMetadata({ contentDates: { providerDay: day } })).toEqual({
      contentDates: { providerDay: day },
    });
  }
);
it.each([
  null,
  20261025,
  "20261025",
  "2026-02-29",
  "1900-02-29",
  "2026-04-31",
  "2026-13-01",
  "2026-00-01",
  "2026-01-00",
  "2026-01-01T00:00:00Z",
  " 2026-01-01",
  "0000-01-01",
])("keeps an invalid day unknown: %s", (day) => {
  expect(sourceDay(day)).toBeUndefined();
  expect(catalogueMetadata({ contentDates: { providerDay: day } })).toEqual({});
});
it.each([
  undefined,
  null,
  "",
  42,
  "javascript:alert(1)",
  "file:///tmp/subtitles",
  "https://user:password@example.invalid/a",
  "https://example.invalid/a b",
  "https://exa\nmple.invalid/subtitles",
  "https://example.invalid/" + "a".repeat(8192),
])("omits unusable optional subtitle URLs without rejecting the content: %s", (url) => {
  expect(catalogueMetadata({ url_subtitle: url })).toEqual({});
});
it("preserves exact signed subtitle URLs and false/unknown edition facts", () => {
  const fields = {
    url_subtitle: "https://example.invalid/subtitles.ttml?token=a%2Fb&format=ttml",
    audioLanguage: null,
    subtitleLanguage: "de",
    productionYear: 2001,
    originalVersion: false,
    audioDescription: false,
    signLanguage: false,
    clearSpeech: false,
    contentDates: {
      catalogueUpdatedAt: 1000,
      broadcastAt: 1100,
      providerDate: 1200,
      providerDay: "2024-02-29",
    },
  };
  expect(catalogueMetadata(fields)).toEqual(fields);
});
it("drops malformed optional values and unsupported properties instead of coercing them", () => {
  expect(
    catalogueMetadata({
      productionYear: 2001.5,
      audioLanguage: 1,
      subtitleLanguage: "",
      originalVersion: "false",
      audioDescription: 1,
      signLanguage: null,
      clearSpeech: [],
      contentDates: {
        catalogueUpdatedAt: 0,
        broadcastAt: "1000",
        providerDate: Infinity,
        arbitrary: true,
      },
    })
  ).toEqual({});
});
