import { indexerDownloadUrl } from "@/lib/indexer-url";

/** Release identity shared by Newznab producers, NZB parsing, and the queue. */
export interface NzbRelease {
  title: string;
  url: string;
}

export function decodeBase64Utf8(value: string): string | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    return null;
  }

  const decoded = bytes.toString("utf-8");
  return Buffer.from(decoded, "utf-8").equals(bytes) ? decoded : null;
}

export function createFakeNzbDownloadUrl(release: NzbRelease): string {
  const encodedUrl = Buffer.from(release.url, "utf-8").toString("base64");
  const encodedTitle = Buffer.from(release.title, "utf-8").toString("base64");

  return indexerDownloadUrl(
    `/api/newznab/fake_nzb_download?encodedUrl=${encodeURIComponent(encodedUrl)}&encodedTitle=${encodeURIComponent(encodedTitle)}`
  );
}

function escapeXml(value: string): string {
  const xmlSafeValue = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    const isAllowedXmlCharacter =
      codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);

    return isAllowedXmlCharacter ? character : "\uFFFD";
  }).join("");

  return xmlSafeValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateFakeNzb(release: NzbRelease): string {
  const encodedUrl = Buffer.from(release.url, "utf-8").toString("base64");
  const encodedTitle = Buffer.from(release.title, "utf-8").toString("base64");
  const escapedTitle = escapeXml(release.title);

  // Base64 comments preserve the release identity without putting arbitrary URLs in XML comments;
  // in particular, a source URL may contain "--", which XML comments cannot represent.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<!-- ${encodedTitle} -->
<!-- ${encodedUrl} -->
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <head>
    <meta type="title">${escapedTitle}</meta>
  </head>
  <file poster="RundfunkArr" date="${Math.floor(Date.now() / 1000)}" subject="${escapedTitle}">
    <groups>
      <group>a.b.zdf</group>
    </groups>
    <segments>
      <segment bytes="1024" number="1">ExampleSegmentID@news.example.com</segment>
    </segments>
  </file>
</nzb>`;
}
