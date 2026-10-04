import { expect, it } from "vitest";
import { unknownMediaExpectations } from "@/lib/media-expectations";
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

it("accepts fresh rendition-bound provider proof with unknown tracks, never fabricating track tags", () => {
  const proof = {
    provider: "arte_hbbtv" as const,
    videoId: "123456-001-A",
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
});
