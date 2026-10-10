import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writesEnabled } from "@/lib/write-gate";
import {
  confirmTvSource,
  previewTvSource,
  tvReviewSelectorSchema,
} from "@/services/tv-source-review";

const confirmationSchema = z
  .object({
    selector: tvReviewSelectorSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    intentId: z.uuid(),
    confirmRuntimeException: z.literal(true),
  })
  .strict();

async function boundedConfirmation(request: NextRequest): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing confirmation");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Confirmation too large");
      chunks.push(value);
    }
    if (timedOut) throw new Error("Confirmation deadline exceeded");
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function GET(request: NextRequest) {
  try {
    const value = request.nextUrl.searchParams.get("selector");
    if (!value || value.length > 2048)
      return NextResponse.json({ error: "Ungültige Quelle" }, { status: 400 });
    const selector = tvReviewSelectorSchema.safeParse(JSON.parse(value));
    if (!selector.success) return NextResponse.json({ error: "Ungültige Quelle" }, { status: 400 });
    return NextResponse.json(await previewTvSource(selector.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Quelle nicht mehr eindeutig verifiziert. Erneut suchen und prüfen." },
      { status: 409 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!writesEnabled())
    return NextResponse.json({ error: "Wartung: keine neuen Aufträge" }, { status: 503 });
  // Unlike SAB, this deliberate GUI decision must not be an ambient cross-site POST.
  const origin = request.headers.get("origin");
  if (
    request.headers.get("X-Pingufunk-Manual-Review") !== "1" ||
    (origin && origin !== request.nextUrl.origin) ||
    ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")
  )
    return NextResponse.json({ error: "Bestätigung nur aus Pingufunk" }, { status: 403 });
  try {
    const text = await boundedConfirmation(request);
    if (Buffer.byteLength(text, "utf8") > 4096)
      return NextResponse.json({ error: "Ungültige Bestätigung" }, { status: 400 });
    const body = confirmationSchema.safeParse(JSON.parse(text));
    if (!body.success)
      return NextResponse.json({ error: "Ungültige Bestätigung" }, { status: 400 });
    return NextResponse.json(
      await confirmTvSource(body.data.selector, body.data.fingerprint, body.data.intentId),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // A timeout is ambiguous, not permission to create another intention.
    return NextResponse.json(
      {
        error:
          "Nicht bestätigt. Mit derselben Entscheidung erneut prüfen; keinen weiteren Auftrag erzeugen.",
      },
      { status: 409 }
    );
  }
}
