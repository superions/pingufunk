import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import { parseNzbContent } from "@/services/download";
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
