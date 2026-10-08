import { NextRequest, NextResponse } from "next/server";
import { boundedRuntimeRead, getSchemaReadiness, runtimeState } from "@/server/runtime-readiness";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") ?? "ready";
  const headers = { "Cache-Control": "no-store" };
  if (mode === "live") return NextResponse.json({ liveness: "alive" }, { headers });
  if (mode !== "ready")
    return NextResponse.json({ error: "Invalid health mode" }, { status: 400, headers });
  try {
    // Live connection availability is checked even while structural readiness is cached.
    const [schema] = await boundedRuntimeRead(
      Promise.all([getSchemaReadiness(), prisma.config.count()])
    );
    return NextResponse.json(runtimeState(schema), { status: schema.ready ? 200 : 503, headers });
  } catch {
    return NextResponse.json(runtimeState({ ready: false, state: "unavailable" }), {
      status: 503,
      headers,
    });
  }
}
