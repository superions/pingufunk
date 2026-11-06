import { describe, expect, it } from "vitest";
import { isRenditionAllowed, isStreamingUrl, srfUrnFromUrl } from "./stream-url";

describe("isRenditionAllowed", () => {
  it.each([
    "",
    "relative.mp4",
    "file:///tmp/video.mp4",
    "javascript:alert(1)",
    "https://user:password@example.invalid/video.mp4",
    "https://example.invalid/has space.mp4",
  ])("does not publish an unusable or credential-bearing rendition (%s)", (value) => {
    expect(isRenditionAllowed(value, false)).toBe(false);
    expect(isRenditionAllowed(value, true)).toBe(false);
  });
  it("allows direct URLs regardless of the HLS setting", () => {
    const directUrl = "https://example.org/video.mp4";

    expect(isRenditionAllowed(directUrl, false)).toBe(true);
    expect(isRenditionAllowed(directUrl, true)).toBe(true);
  });

  it("keeps HLS manifests eligible even with a stored legacy false setting", () => {
    const hlsUrl = "https://example.org/video.m3u8?token=synthetic";

    expect(isStreamingUrl(hlsUrl)).toBe(true);
    expect(isRenditionAllowed(hlsUrl, false)).toBe(true);
    expect(isRenditionAllowed(hlsUrl, true)).toBe(true);
  });

  it("accepts stable SRF references without rewriting their provider identity", () => {
    const srfUrl =
      "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111";

    expect(srfUrnFromUrl(srfUrl)).toBe("urn:srf:video:11111111-1111-4111-8111-111111111111");
    expect(isRenditionAllowed(srfUrl, false)).toBe(true);
    expect(isRenditionAllowed(srfUrl, true)).toBe(true);
  });
});
