import { NextRequest, NextResponse } from "next/server";
import { getJobDiagnosis } from "@/services/job-diagnostics";

/** Same read boundary as existing history, not authentication by UUID or route name. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const headers = { "Cache-Control": "no-store" };
  if (
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id) ||
    [...request.nextUrl.searchParams].length
  )
    return NextResponse.json({ error: "Invalid diagnosis request" }, { status: 400, headers });
  try {
    const report = await getJobDiagnosis(id);
    return report
      ? NextResponse.json(report, { headers })
      : NextResponse.json({ error: "Job unavailable" }, { status: 404, headers });
  } catch {
    return NextResponse.json({ error: "Diagnosis unavailable" }, { status: 503, headers });
  }
}
