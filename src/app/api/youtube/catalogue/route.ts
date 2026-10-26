import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { writesEnabled } from "@/lib/write-gate";
import {
  YOUTUBE_REGISTRY_BYTES,
  youtubeSaveSchema,
  YoutubeCatalogueDataError,
} from "@/lib/youtube-catalogue";
import { YoutubeMetadataError } from "@/server/ytdlp";
import {
  youtubeCatalogueSnapshot,
  youtubeCataloguePage,
  saveYoutubeCatalogue,
  refreshYoutubeCatalogue,
  inspectYoutubeSource,
  cancelYoutubeCatalogue,
  YoutubeCatalogueError,
} from "@/services/youtube-catalogue";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const actionSchema = z.discriminatedUnion("action", [
  youtubeSaveSchema,
  z.object({ action: z.literal("inspect"), url: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal("refresh"), revision }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);
function failure(error: unknown) {
  const status =
    error instanceof YoutubeCatalogueError
      ? error.status
      : error instanceof YoutubeMetadataError || error instanceof YoutubeCatalogueDataError
        ? 502
        : 503;
  const message =
    error instanceof YoutubeCatalogueError ||
    error instanceof YoutubeMetadataError ||
    error instanceof YoutubeCatalogueDataError
      ? error.message
      : "YouTube-Katalog unbestätigt. Gespeicherten Stand neu laden.";
  return NextResponse.json(
    { error: message, ...(status === 500 ? { committed: "unknown" } : {}) },
    { status, headers }
  );
}
export async function GET(request: NextRequest) {
  const page = request.nextUrl.searchParams.get("page");
  const mapping = request.nextUrl.searchParams.get("mapping");
  if (
    [...request.nextUrl.searchParams.keys()].some((key) => !["page", "mapping"].includes(key)) ||
    (mapping !== null && (!mapping || mapping.length > 160)) ||
    (page !== null && (!/^\d{1,3}$/.test(page) || Number(page) >= (mapping === null ? 800 : 1000)))
  )
    return NextResponse.json({ error: "Ungültige Inventarseite." }, { status: 400, headers });
  try {
    if (mapping !== null) {
      const { youtubeMappingReport } = await import("@/services/youtube-report");
      return NextResponse.json(await youtubeMappingReport(mapping, Number(page ?? 0)), { headers });
    }
    return NextResponse.json(
      page === null ? await youtubeCatalogueSnapshot() : await youtubeCataloguePage(Number(page)),
      { headers }
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  if (!writesEnabled())
    return NextResponse.json(
      { error: "Schreibzugriff ist deaktiviert." },
      { status: 503, headers }
    );
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const protocol =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1);
  const origin = request.headers.get("origin");
  if (
    request.headers.get("X-Pingufunk-Catalogue") !== "1" ||
    (origin && origin !== `${protocol}://${host}`) ||
    ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")
  )
    return NextResponse.json(
      { error: "Katalogänderungen nur aus Pingufunk." },
      { status: 403, headers }
    );
  let body: z.infer<typeof actionSchema>;
  try {
    body = actionSchema.parse(
      await readBoundedProviderJson(
        new Response(request.body, { headers: request.headers }),
        Date.now() + 5000,
        YOUTUBE_REGISTRY_BYTES,
        request.signal
      )
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Ungültige Eingabe: Kanal-/Quellen-ID, Ziel-ID und Registergrenzen prüfen (64 Kanäle, 256 Zuordnungen, max. 1 MiB).",
      },
      { status: 400, headers }
    );
  }
  try {
    switch (body.action) {
      case "save":
        return NextResponse.json(
          { success: true, snapshot: await saveYoutubeCatalogue(body) },
          { headers }
        );
      case "inspect":
        return NextResponse.json(await inspectYoutubeSource(body.url), { headers });
      case "refresh":
        await refreshYoutubeCatalogue(body.revision);
        return NextResponse.json({ success: true }, { status: 202, headers });
      case "cancel":
        await cancelYoutubeCatalogue();
        return NextResponse.json({ success: true }, { headers });
    }
  } catch (error) {
    return failure(error);
  }
}
