import { NextRequest, NextResponse } from "next/server";
import { decodeBase64Utf8, decodeMediaExpectations, generateFakeNzb } from "@/services/nzb-release";
import { assertMediaRuntimeCompatible } from "@/lib/media-expectations";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const encodedUrl = searchParams.get("encodedUrl");
  const encodedTitle = searchParams.get("encodedTitle");

  if (!encodedUrl || !encodedTitle) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const url = decodeBase64Utf8(encodedUrl);
  const title = decodeBase64Utf8(encodedTitle);
  if (!url || !/^https?:\/\/\S+$/.test(url) || !title?.trim()) {
    return NextResponse.json({ error: "Invalid base64 string" }, { status: 400 });
  }

  let mediaExpectations;
  try {
    const values = searchParams.getAll("encodedExpectations");
    if (values.length > 1) throw new Error("Duplicate expectations");
    mediaExpectations = values.length === 0 ? undefined : decodeMediaExpectations(values[0]);
  } catch {
    return NextResponse.json({ error: "Invalid media expectations" }, { status: 400 });
  }
  try {
    assertMediaRuntimeCompatible(mediaExpectations);
  } catch {
    return NextResponse.json(
      { error: "Episode runtime conflict; review the source in Pingufunk" },
      { status: 409 }
    );
  }
  const nzbContent = generateFakeNzb({ title, url, mediaExpectations });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `rundfunk-${timestamp}.nzb`;

  return new NextResponse(nzbContent, {
    status: 200,
    headers: {
      "Content-Type": "application/x-nzb",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
