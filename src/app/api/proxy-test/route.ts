import { NextResponse } from "next/server";
import { testProxy, testYtdlp } from "@/server/ytdlp";
import { writesEnabled } from "@/lib/write-gate";

// POST /api/proxy-test - Test proxy connection
export async function POST() {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
  }
  try {
    // First test if yt-dlp is available
    const ytdlpResult = await testYtdlp();
    if (!ytdlpResult.success) {
      return NextResponse.json({
        success: false,
        error: `yt-dlp not available: ${ytdlpResult.error}`,
      });
    }

    // Test proxy connection
    const proxyResult = await testProxy();
    return NextResponse.json(proxyResult);
  } catch {
    console.error("Proxy test failed");
    return NextResponse.json({ success: false, error: "Proxy test failed" }, { status: 500 });
  }
}

// GET /api/proxy-test - Get yt-dlp status
export async function GET() {
  try {
    const result = await testYtdlp();
    return NextResponse.json(result);
  } catch {
    console.error("yt-dlp test failed");
    return NextResponse.json({ success: false, error: "yt-dlp test failed" }, { status: 500 });
  }
}
