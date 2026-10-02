import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/newznab/fake_nzb_download/route";
import { unknownMediaExpectations } from "@/lib/media-expectations";
import { parseNzbContent } from "./download";
import { createFakeNzbDownloadUrl, generateFakeNzb } from "./nzb-release";

const release = { title: "Synthetic.Show.S01E01", url: "https://example.org/a--b.mp4" };
const mediaExpectations = {
  ...unknownMediaExpectations(),
  duration: { seconds: 120, provenance: "episode_metadata" as const },
  audio: { language: "de", provenance: "provider_audio" as const },
};

it("round-trips versioned facts through the actual link, NZB route and queue parser", async () => {
  const expected = { ...release, mediaExpectations };
  const response = await GET(
    new NextRequest(new URL(createFakeNzbDownloadUrl(expected), "http://localhost"))
  );
  expect(response.status).toBe(200);
  expect(parseNzbContent(await response.text())).toEqual(expected);
});

it("distinguishes explicit unknown facts from saved legacy NZBs", () => {
  expect(parseNzbContent(generateFakeNzb(release))).toEqual(release);
  const explicit = { ...release, mediaExpectations: unknownMediaExpectations() };
  expect(parseNzbContent(generateFakeNzb(explicit))).toEqual(explicit);
});

it.each([
  '<meta type="pingufunk-media-expectations">broken</meta>',
  '<meta type="pingufunk-media-expectations">e30=</meta>',
  '<meta type="pingufunk-media-expectations">',
  '<meta type="pingufunk-media-expectations"',
  '<meta type="pingufunk-media-expectations"><nested/></meta>',
  '<meta type="pingufunk-media-expectations">e30=</meta><meta type="pingufunk-media-expectations">e30=</meta>',
])("rejects a malformed declaration even with a valid legacy release: %s", (marker) => {
  expect(
    parseNzbContent(generateFakeNzb(release).replace("</head>", `${marker}</head>`))
  ).toBeNull();
});

it.each(["", "broken", "e30=", "a".repeat(5501)])(
  "rejects an explicit invalid query payload rather than generating a legacy NZB",
  async (encodedExpectations) => {
    const url = new URL(createFakeNzbDownloadUrl(release), "http://localhost");
    url.searchParams.set("encodedExpectations", encodedExpectations);
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid media expectations" });
  }
);

it("rejects duplicate query declarations", async () => {
  const url = new URL(
    createFakeNzbDownloadUrl({ ...release, mediaExpectations }),
    "http://localhost"
  );
  url.searchParams.append("encodedExpectations", url.searchParams.get("encodedExpectations")!);
  expect((await GET(new NextRequest(url))).status).toBe(400);
});
