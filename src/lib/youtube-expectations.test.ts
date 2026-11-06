import { expect, it } from "vitest";
import { syntheticYoutubeExpectations } from "./__fixtures__/youtube";
import {
  parseMediaExpectations,
  serializeMediaExpectations,
  assertMediaRuntimeCompatible,
  hasMediaRuntimeConflict,
  durationExpectations,
} from "./media-expectations";
import { parseNzbContent, generateFakeNzb } from "@/services/nzb-release";
it("roundtrips fully bound v5 through NZB and persisted expectations while retaining unknown physical tags as provider evidence", () => {
  const expected = syntheticYoutubeExpectations();
  const parsed = parseMediaExpectations(serializeMediaExpectations(expected));
  expect(parsed).toEqual(expected);
  const release = {
    title: "Synthetic.S01E01",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    mediaExpectations: parsed,
  };
  expect(parseNzbContent(generateFakeNzb(release))).toEqual(release);
  expect(durationExpectations(parsed, 99).map((row) => row.tolerancePercent)).toEqual([10, 10]);
});
it.each([
  "language",
  "format",
  "dimensions",
  "duration",
  "channel",
  "kind",
  "unknown-version",
  "missing-ref",
  "unknown-property",
  "downgrade-v3",
  "downgrade-v2",
])("rejects a corrupt or downgraded typed contract: %s", (kind) => {
  const expected: Record<string, unknown> = structuredClone(syntheticYoutubeExpectations());
  const ref = expected.sourceRef as ReturnType<typeof syntheticYoutubeExpectations>["sourceRef"];
  if (kind === "language") ref.selection.language = "und";
  if (kind === "format") ref.selection.audioFormat = "different";
  if (kind === "dimensions") ref.selection.height = 1080;
  if (kind === "duration") ref.selection.duration = 200;
  if (kind === "channel") ref.channelId = "UCbbbbbbbbbbbbbbbbbbbbbb";
  if (kind === "kind") expected.mediaKind = "movie";
  if (kind === "unknown-version") expected.version = 99;
  if (kind === "missing-ref") delete expected.sourceRef;
  if (kind === "unknown-property") expected.hidden = "value";
  if (kind === "downgrade-v3") {
    expected.version = 3;
    delete expected.sourceRef;
  }
  if (kind === "downgrade-v2") {
    expected.version = 2;
    delete expected.sourceRef;
  }
  expect(() => parseMediaExpectations(expected)).toThrow();
});
it("retains runtime conflict until the internal once-only decision and never accepts its v4 payload through automatic admission", () => {
  const expected = syntheticYoutubeExpectations();
  expected.durations.metadata.seconds = 200;
  const parsed = parseMediaExpectations(expected);
  expect(hasMediaRuntimeConflict(parsed)).toBe(true);
  expect(() => assertMediaRuntimeCompatible(parsed)).toThrow();
  const approved = parseMediaExpectations({
    ...expected,
    version: 4,
    approval: {
      kind: "episode_runtime_once",
      jobId: "00000000-0000-4000-8000-000000000001",
      fingerprint: "b".repeat(64),
      confirmedAt: "2026-10-26T00:00:00.000Z",
      tvdbId: 42,
      season: 1,
      episode: 1,
      sourceId: "c".repeat(64),
      rendition: "sd",
    },
  });
  expect(() => assertMediaRuntimeCompatible(approved)).toThrow();
  expect(durationExpectations(approved, 0)).toHaveLength(1);
  expect(() =>
    parseMediaExpectations({
      ...approved,
      sourceRef: {
        ...expected.sourceRef,
        programme: { kind: "series", targetId: 43, season: 1, episode: 1 },
      },
    })
  ).toThrow();
});
it("accepts a typed movie without inventing episode metadata and rejects a borrowed episode-duration reference", () => {
  const facts = syntheticYoutubeExpectations();
  const { playlistId: _, ...identity } = facts.sourceRef;
  const movie = {
    ...facts,
    mediaKind: "movie",
    sourceRef: { ...identity, programme: { kind: "movie", targetId: 42 } },
    durations: { ...facts.durations, metadata: null },
  };
  expect(parseMediaExpectations(movie)).toMatchObject({ mediaKind: "movie", version: 5 });
  expect(() => parseMediaExpectations({ ...movie, durations: facts.durations })).toThrow();
});
