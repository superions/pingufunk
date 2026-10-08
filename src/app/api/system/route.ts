import { NextResponse } from "next/server";
import { prisma, databaseSizeBytes } from "@/lib/db";
import { getToolCapabilities, unavailableToolCapabilities } from "@/server/tool-capabilities";
import { boundedRuntimeRead, getSchemaReadiness, runtimeState } from "@/server/runtime-readiness";

// GET /api/system - Get system information
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const toolsPromise = boundedRuntimeRead(getToolCapabilities()).catch(unavailableToolCapabilities);
  const schemaPromise = getSchemaReadiness();
  try {
    const [shows, episodes, completed, inQueue, failed, configEntries, sizeBytes, tools, schema] =
      await boundedRuntimeRead(
        Promise.all([
          prisma.tvdbSeries.count(),
          prisma.tvdbEpisode.count(),
          prisma.download.count({ where: { status: "completed" } }),
          // Include the current mux state and the retained legacy processing state.
          prisma.download.count({
            where: { status: { in: ["queued", "downloading", "converting", "processing"] } },
          }),
          prisma.download.count({ where: { status: "failed" } }),
          prisma.config.count(),
          databaseSizeBytes(),
          toolsPromise,
          schemaPromise,
        ])
      );
    if (!schema.ready) throw new Error("Runtime schema unavailable");

    return NextResponse.json(
      {
        version: {
          node: process.version,
          ffmpeg: tools.ffmpeg.version,
          ffprobe: tools.ffprobe.version,
          ytdlp: tools.ytdlp.version,
        },
        capabilities: tools,
        runtime: runtimeState(schema),
        database: {
          sizeBytes,
          shows,
          episodes,
          configEntries,
          historicalMetadata: true,
        },
        downloads: { completed, inQueue, failed },
        uptime: process.uptime(),
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { error: "System information temporarily unavailable" },
      { status: 500, headers }
    );
  }
}
