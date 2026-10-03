import { expect, it } from "vitest";
import {
  parseMediaExpectations,
  readPersistedMediaExpectations,
  serializeMediaExpectations,
  unknownMediaExpectations,
} from "./media-expectations";

it("retains nullable unknown facts through a versioned serialization round trip", () => {
  const unknown = unknownMediaExpectations();
  expect(readPersistedMediaExpectations(serializeMediaExpectations(unknown))).toEqual(unknown);
  expect(readPersistedMediaExpectations(null)).toBeNull();
  expect(readPersistedMediaExpectations(undefined)).toBeNull();
});

it("preserves positive seconds, explicit audio evidence and dimensions without title inference", () => {
  const expected = {
    version: 1 as const,
    duration: { seconds: 120.125, provenance: "episode_metadata" as const },
    audio: { language: "de", provenance: "provider_audio" as const },
    resolution: { width: 1920, height: 1080, provenance: "provider_dimensions" as const },
  };
  expect(parseMediaExpectations(serializeMediaExpectations(expected))).toEqual(expected);
});

it("retains the separate v2 source proof and rejects mixed/forged declarations", () => {
  const value = {
    ...unknownMediaExpectations(),
    version: 2 as const,
    audio: null,
    sourceAudio: {
      provider: "arte_hbbtv" as const,
      videoId: "123456-001-A",
      mediaIdentity: "a".repeat(64),
      language: "de",
    },
  };
  expect(readPersistedMediaExpectations(serializeMediaExpectations(value))).toEqual(value);
  expect(() =>
    parseMediaExpectations({ ...value, audio: { language: "de", provenance: "provider_audio" } })
  ).toThrow();
  expect(() =>
    parseMediaExpectations({
      ...value,
      sourceAudio: { ...value.sourceAudio, provider: "untrusted" },
    })
  ).toThrow();
  expect(() =>
    parseMediaExpectations({
      ...value,
      sourceAudio: { ...value.sourceAudio, mediaIdentity: "raw-secret-url" },
    })
  ).toThrow();
});

it.each([
  {},
  { version: 1 },
  { ...unknownMediaExpectations(), version: 2 },
  { ...unknownMediaExpectations(), duration: { seconds: 0, provenance: "source_catalogue" } },
  { ...unknownMediaExpectations(), duration: { seconds: -1, provenance: "source_catalogue" } },
  {
    ...unknownMediaExpectations(),
    duration: { seconds: Infinity, provenance: "source_catalogue" },
  },
  { ...unknownMediaExpectations(), duration: { seconds: NaN, provenance: "source_catalogue" } },
  { ...unknownMediaExpectations(), duration: { seconds: "120", provenance: "source_catalogue" } },
  { ...unknownMediaExpectations(), audio: { language: "de", provenance: "title" } },
  { ...unknownMediaExpectations(), audio: { language: "und", provenance: "provider_audio" } },
  {
    ...unknownMediaExpectations(),
    resolution: { width: 1920, height: 0, provenance: "provider_dimensions" },
  },
  { ...unknownMediaExpectations(), extra: "synthetic-private-payload" },
  "not-json",
  "",
  " ",
  "x".repeat(4097),
])("rejects malformed declared expectations instead of downgrading them to legacy", (value) => {
  expect(() => readPersistedMediaExpectations(value)).toThrow("Invalid media expectations");
});
