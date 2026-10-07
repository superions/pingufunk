import { expect, it } from "vitest";
import { unknownMediaExpectations, unknownJobMediaExpectations } from "@/lib/media-expectations";
import { validateMediaProbe } from "./media-probe";
import { mediaSourceIdentity } from "@/services/source-audio";

interface TestStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic: number };
  sample_rate?: string;
  channels?: number;
  tags?: { language: string };
}
const media = (): { format: { format_name: string; duration: string }; streams: TestStream[] } => ({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "120" },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1280,
      height: 720,
      disposition: { attached_pic: 0 },
    },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
  ],
});

it("checks both frozen v3 references independently and ignores later GUI/legacy tolerance", () => {
  const expected = {
    ...unknownJobMediaExpectations(),
    mediaKind: "series" as const,
    durations: {
      source: {
        seconds: 120,
        provenance: "source_catalogue" as const,
        tolerancePercent: 10 as const,
      },
      metadata: { seconds: 120, provenance: "episode_metadata" as const, tolerancePercent: 15 },
    },
  };
  const probe = (duration: string) => ({ ...media(), format: { ...media().format, duration } });
  expect(validateMediaProbe(probe("130"), expected, 0).durationChecks).toEqual([
    { ...expected.durations.source, result: "passed" },
    { ...expected.durations.metadata, result: "passed" },
  ]);
  expect(() => validateMediaProbe(probe("134"), expected, 25)).toThrow(); // Episode passes, asset fails.
  expect(() =>
    validateMediaProbe(
      probe("122"),
      {
        ...expected,
        durations: {
          ...expected.durations,
          metadata: { ...expected.durations.metadata, tolerancePercent: 0 },
        },
      },
      25
    )
  ).toThrow(); // Asset passes, exact episode fails.
});

it("never applies the current series slider to a frozen v3 film or unknown source", () => {
  for (const mediaKind of ["movie", "unknown"] as const) {
    const expected = {
      ...unknownJobMediaExpectations(),
      mediaKind,
      durations: {
        source: {
          seconds: 120,
          provenance: "source_catalogue" as const,
          tolerancePercent: 10 as const,
        },
        metadata: null,
      },
    };
    expect(() =>
      validateMediaProbe(
        { ...media(), format: { ...media().format, duration: "134" } },
        expected,
        25
      )
    ).toThrow();
    expect(validateMediaProbe(media(), expected, 0).expectedChecks.duration).toBe("passed");
  }
});

it("allows a valid legacy or explicitly unknown-v1 file without claiming expected checks", () => {
  const facts = validateMediaProbe(media(), null, 10);
  expect(facts.durationSeconds).toBe(120);
  expect(facts.audioLanguages).toEqual([]);
  expect(facts.expectedChecks).toEqual({
    duration: "unknown",
    audio: "unknown",
    resolution: "unknown",
  });
  expect(validateMediaProbe(media(), unknownMediaExpectations(), 10)).toEqual(facts);
});

it("uses inclusive seconds-based P06 tolerance and rejects a known sample", () => {
  const expected = {
    ...unknownMediaExpectations(),
    duration: { seconds: 120, provenance: "episode_metadata" as const },
  };
  expect(
    validateMediaProbe({ ...media(), format: { ...media().format, duration: "108" } }, expected, 10)
      .expectedChecks.duration
  ).toBe("passed");
  expect(() =>
    validateMediaProbe(
      { ...media(), format: { ...media().format, duration: "107.999" } },
      expected,
      10
    )
  ).toThrow();
  expect(() =>
    validateMediaProbe(
      media(),
      { ...expected, duration: { ...expected.duration, seconds: 5400 } },
      10
    )
  ).toThrow();
});

it.each(["und", "und-Latn", "mul", "zxx", "unrecognized-language"])(
  "retains unknown audio tags %s as unknown, not a language claim",
  (language) => {
    const probe = media();
    probe.streams[1] = { ...probe.streams[1], tags: { language } };
    expect(validateMediaProbe(probe, null, 10).audioLanguages).toEqual([]);
  }
);

it("checks only explicit audio tags and dimensions, never language/quality title labels", () => {
  const expected = {
    ...unknownMediaExpectations(),
    audio: { language: "de", provenance: "provider_audio" as const },
    resolution: { width: 1280, height: 720, provenance: "provider_dimensions" as const },
  };
  const tagged = media();
  tagged.streams[1] = {
    ...tagged.streams[1],
    tags: { language: "deu" },
  };
  expect(validateMediaProbe(tagged, expected, 10).expectedChecks).toEqual({
    duration: "unknown",
    audio: "passed",
    resolution: "passed",
  });
  expect(() => validateMediaProbe(media(), expected, 10)).toThrow();
  expect(() =>
    validateMediaProbe(
      tagged,
      { ...expected, resolution: { ...expected.resolution, height: 1080 } },
      10
    )
  ).toThrow();
});

it.each(["0", "-1", "NaN", "Infinity", "N/A", ""])(
  "rejects invalid actual duration %s",
  (duration) => {
    expect(() =>
      validateMediaProbe({ ...media(), format: { ...media().format, duration } }, null, 10)
    ).toThrow();
  }
);

it("rejects HTML, absent audio, cover-only video and invalid codecs", () => {
  expect(() => validateMediaProbe("<html>not media</html>", null, 10)).toThrow();
  expect(() =>
    validateMediaProbe(
      { ...media(), format: { ...media().format, format_name: "image2" } },
      null,
      10
    )
  ).toThrow();
  expect(() =>
    validateMediaProbe({ ...media(), streams: [media().streams[0]] }, null, 10)
  ).toThrow();
  const cover = media();
  cover.streams[0] = { ...cover.streams[0], disposition: { attached_pic: 1 } };
  expect(() => validateMediaProbe(cover, null, 10)).toThrow();
  const invalid = media();
  invalid.streams[1] = { ...invalid.streams[1], codec_name: "unknown" };
  expect(() => validateMediaProbe(invalid, null, 10)).toThrow();
});

it.each(["arte_hbbtv", "ard_media"] as const)(
  "accepts fresh %s proof with unknown tracks, never fabricating track tags",
  (provider) => {
    const proof = {
      provider,
      videoId:
        provider === "ard_media"
          ? Buffer.from("crid://example.invalid/synthetic/one").toString("base64url")
          : "123456-001-A",
      language: "de",
      mediaIdentity: mediaSourceIdentity("https://fixture.akamaized.net/movie.mp4"),
    };
    const expected = {
      ...unknownMediaExpectations(),
      version: 2 as const,
      audio: null,
      sourceAudio: proof,
      resolution: { width: 1280, height: 720, provenance: "provider_dimensions" as const },
    };
    const facts = validateMediaProbe(media(), expected, 10, proof);
    expect(facts.audioLanguages).toEqual([]);
    expect(facts.sourceAudioEvidence).toEqual(proof);
    expect(facts.expectedChecks.audio).toBe("passed_provider");
    expect(facts.expectedChecks.resolution).toBe("passed");
    for (const dimensions of [
      { width: 1920, height: 1080 },
      { width: 1920, height: 720 },
    ]) {
      const wrong = media();
      wrong.streams[0] = { ...wrong.streams[0], ...dimensions };
      expect(() => validateMediaProbe(wrong, expected, 10, proof)).toThrow();
    }
    expect(() => validateMediaProbe(media(), expected, 10)).toThrow();
    expect(() => validateMediaProbe(media(), expected, 10, { ...proof, language: "fr" })).toThrow();
    const foreign = media();
    foreign.streams[1].tags = { language: "fra" };
    expect(() => validateMediaProbe(foreign, expected, 10, proof)).toThrow();
    const noAudio = { ...media(), streams: [media().streams[0]] };
    expect(() => validateMediaProbe(noAudio, expected, 10, proof)).toThrow();
  }
);
