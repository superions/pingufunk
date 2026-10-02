import { NextResponse } from "next/server";
import { prisma, databaseSizeBytes } from "@/lib/db";
import { execSync } from "child_process";

// GET /api/system - Get system information
export async function GET() {
  try {
    // Database stats
    const showsCount = await prisma.tvdbSeries.count();
    const episodesCount = await prisma.tvdbEpisode.count();
    const downloadsCompleted = await prisma.download.count({
      where: { status: "completed" },
    });
    const downloadsInQueue = await prisma.download.count({
      // The worker persists "converting"; retain legacy "processing" rows too.
      where: { status: { in: ["queued", "downloading", "converting", "processing"] } },
    });
    const downloadsFailed = await prisma.download.count({
      where: { status: "failed" },
    });
    const configCount = await prisma.config.count();

    const dbSizeBytes = await databaseSizeBytes();

    // FFmpeg check
    let ffmpegVersion = null;
    try {
      const output = execSync("ffmpeg -version", {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const match = output.match(/ffmpeg version ([^\s]+)/);
      ffmpegVersion = match ? match[1] : "installed";
    } catch {
      ffmpegVersion = null;
    }

    // yt-dlp check
    let ytdlpVersion = null;
    try {
      const output = execSync("yt-dlp --version", {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      ytdlpVersion = output.trim();
    } catch {
      ytdlpVersion = null;
    }

    // Node.js version
    const nodeVersion = process.version;

    // Process uptime
    const uptimeSeconds = process.uptime();

    return NextResponse.json({
      version: {
        node: nodeVersion,
        ffmpeg: ffmpegVersion,
        ytdlp: ytdlpVersion,
      },
      database: {
        sizeBytes: dbSizeBytes,
        shows: showsCount,
        episodes: episodesCount,
        configEntries: configCount,
      },
      downloads: {
        completed: downloadsCompleted,
        inQueue: downloadsInQueue,
        failed: downloadsFailed,
      },
      uptime: uptimeSeconds,
    });
  } catch {
    console.error("Failed to get system info");
    return NextResponse.json({ error: "Failed to get system info" }, { status: 500 });
  }
}
