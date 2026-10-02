import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import { parseNzbContent } from "@/services/download";
import { generateGenericRssItems } from "@/services/newznab";
import { GET } from "./route";

const encodedUrl = Buffer.from("https://example.org/a--b.m3u8").toString("base64");
const encodedTitle = Buffer.from(">>>").toString("base64");

it.each(["--", "SGVsbG8", "Zh==", "not base64", "__=="])(
  "rejects noncanonical Base64 %s in either parameter",
  async (invalid) => {
    for (const key of ["encodedUrl", "encodedTitle"]) {
      const params = new URLSearchParams({ encodedUrl, encodedTitle, [key]: invalid });
      expect(
        (await GET(new NextRequest(`http://localhost/api/newznab/fake_nzb_download?${params}`)))
          .status
      ).toBe(400);
    }
  }
);

it("produces valid XML from URL-encoded Base64 with plus characters", async () => {
  expect(encodedTitle).toContain("+");
  const params = new URLSearchParams({ encodedUrl, encodedTitle });
  const response = await GET(
    new NextRequest(`http://localhost/api/newznab/fake_nzb_download?${params}`)
  );
  expect(response.status).toBe(200);
  const xml = await response.text();
  expect(xml).toContain(`<!-- ${encodedTitle} -->`);
  await expect(parseStringPromise(xml)).resolves.toHaveProperty("nzb");
  expect(parseNzbContent(xml)).toEqual({
    title: Buffer.from(encodedTitle, "base64").toString("utf-8"),
    url: Buffer.from(encodedUrl, "base64").toString("utf-8"),
  });
});

it("keeps a release GUID stable across access-token rotation but downloads the current URL", async () => {
  const source = {
    channel: "ARD",
    topic: "Example Show",
    title: "Example episode",
    description: "Synthetic rotating CDN credentials",
    filmlisteTimestamp: 1_700_000_000,
    duration: 2700,
    size: 1_000_000_000,
    url_website:
      "https://example.org/show/episode-1?program=episode-1&access_token=stale-page-token",
    url_video:
      "https://cdn.example.org/videos/episode-1.mp4?asset=main&token=old&expires=100&hdnts=old",
    url_video_low: "",
    url_video_hd: "",
  };
  const renewedUrl =
    "https://cdn.example.org/videos/episode-1.mp4?hdnts=new&asset=main&expires=200&token=new";
  const [firstRelease] = generateGenericRssItems(source, "720p");
  const [renewedRelease] = generateGenericRssItems(
    { ...source, url_video: renewedUrl, id: "content-hash-changed-with-raw-row" },
    "720p"
  );
  const [differentSourceRendition] = generateGenericRssItems(
    { ...source, url_video: `${renewedUrl}&assetVariant=alternate` },
    "720p"
  );

  expect(renewedRelease.guid).toEqual(firstRelease.guid);
  expect(renewedRelease.link).toBe(renewedUrl);
  expect(differentSourceRendition.guid).not.toEqual(renewedRelease.guid);

  const response = await GET(
    new NextRequest(new URL(renewedRelease.enclosure.url, "http://localhost"))
  );
  expect(response.status).toBe(200);
  expect(parseNzbContent(await response.text())).toEqual({
    title: renewedRelease.title,
    url: renewedUrl,
    mediaExpectations: {
      version: 1,
      duration: { seconds: 2700, provenance: "source_catalogue" },
      audio: null,
      resolution: null,
    },
  });
});

it("rejects invalid UTF-8 and non-HTTP source URLs", async () => {
  const invalidUtf8 = new URLSearchParams({ encodedUrl, encodedTitle: "//8=" });
  const invalidUrl = new URLSearchParams({
    encodedUrl: Buffer.from("file:///etc/passwd").toString("base64"),
    encodedTitle,
  });

  expect(
    (await GET(new NextRequest(`http://localhost/api/newznab/fake_nzb_download?${invalidUtf8}`)))
      .status
  ).toBe(400);
  expect(
    (await GET(new NextRequest(`http://localhost/api/newznab/fake_nzb_download?${invalidUrl}`)))
      .status
  ).toBe(400);
});
