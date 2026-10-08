import { indexerDownloadUrl } from "@/lib/indexer-url";
import {
  MediaExpectationsError,
  parseMediaExpectations,
  serializeMediaExpectations,
  type MediaExpectations,
} from "@/lib/media-expectations";

/** Release identity shared by Newznab producers, NZB parsing, and the queue. */
export interface NzbRelease {
  title: string;
  url: string;
  /** Absence is reserved for saved legacy NZBs; current producers declare v3. */
  mediaExpectations?: MediaExpectations;
}

const EXPECTATIONS_META_TYPE = "pingufunk-media-expectations";

// Extract filename and URL from NZB content
const FILE_NAME_REGEX = /filename="([^"]+)\.nzb"/;
// New NZBs use Base64 comments so URLs containing "--" remain valid XML.
// Accept raw URL comments too, for NZBs saved before the format changed.
const COMMENT_REGEX = /<!--([\s\S]*?)-->/g;

export function parseNzbContent(nzbContent: string): NzbRelease | null {
  let mediaExpectations: NzbRelease["mediaExpectations"];
  try {
    // Validate the versioned declaration before any legacy URL/title recovery.
    mediaExpectations = readNzbMediaExpectations(nzbContent);
  } catch {
    return null;
  }
  const filenameMatch = nzbContent.match(FILE_NAME_REGEX);
  const metadataTitleMatch = nzbContent.match(
    /<meta\s+type=["']title["'][^>]*>([\s\S]*?)<\/meta\s*>/i
  );
  let title: string | null = null;
  let url: string | null = null;

  for (const match of nzbContent.matchAll(COMMENT_REGEX)) {
    const comment = match[1].trim();
    if (/^https?:\/\/\S+$/.test(comment)) {
      url ??= comment;
      continue;
    }

    const decoded = decodeBase64Utf8(comment);
    if (decoded === null) {
      continue;
    }
    if (/^https?:\/\/\S+$/.test(decoded)) {
      url ??= decoded;
    } else if (decoded.trim() && title === null) {
      title = decoded;
    }
  }

  // Older generators stored the release name in metadata or a filename subject.
  title ??= metadataTitleMatch?.[1] ?? filenameMatch?.[1] ?? null;
  if (!url || !title?.trim()) {
    return null;
  }

  return {
    title,
    url,
    ...(mediaExpectations === undefined ? {} : { mediaExpectations }),
  };
}

export function decodeMediaExpectations(value: string): MediaExpectations {
  if (value.length > 5500) throw new MediaExpectationsError();
  const decoded = decodeBase64Utf8(value);
  if (decoded === null) throw new MediaExpectationsError();
  return parseMediaExpectations(decoded);
}

/** A declared but malformed/duplicate marker must never downgrade to legacy. */
export function readNzbMediaExpectations(content: string): MediaExpectations | undefined {
  const declarations = content.match(/<meta\b[^<>]*pingufunk-media-expectations/gi) ?? [];
  if (declarations.length === 0) return undefined;
  if (declarations.length !== 1) throw new MediaExpectationsError();
  const marker = content.match(
    /<meta\s+type=(["'])pingufunk-media-expectations\1\s*>([^<]*)<\/meta\s*>/i
  );
  if (!marker) {
    throw new MediaExpectationsError();
  }
  return decodeMediaExpectations(marker[2].trim());
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
  const expectationsQuery =
    release.mediaExpectations === undefined
      ? ""
      : `&encodedExpectations=${encodeURIComponent(Buffer.from(serializeMediaExpectations(release.mediaExpectations), "utf8").toString("base64"))}`;

  return indexerDownloadUrl(
    `/api/newznab/fake_nzb_download?encodedUrl=${encodeURIComponent(encodedUrl)}&encodedTitle=${encodeURIComponent(encodedTitle)}${expectationsQuery}`
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
  const expectationsMeta =
    release.mediaExpectations === undefined
      ? ""
      : `\n    <meta type="${EXPECTATIONS_META_TYPE}">${Buffer.from(serializeMediaExpectations(release.mediaExpectations), "utf8").toString("base64")}</meta>`;

  // Base64 comments preserve the release identity without putting arbitrary URLs in XML comments;
  // in particular, a source URL may contain "--", which XML comments cannot represent.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<!-- ${encodedTitle} -->
<!-- ${encodedUrl} -->
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <head>
    <meta type="title">${escapedTitle}</meta>${expectationsMeta}
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
