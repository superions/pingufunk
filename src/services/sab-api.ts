import { NextRequest, NextResponse } from "next/server";
import { InvalidDownloadInputError, UnsafeDownloadPathError } from "@/lib/download-paths";
import { MediaExpectationsError } from "@/lib/media-expectations";
import { writesEnabled } from "@/lib/write-gate";
import { DownloadReadError, parseDownloadRead } from "@/lib/download-read";
import {
  ENQUEUE_KEY_HEADER,
  EnqueueConflictError,
  EnqueueRequestError,
  parseEnqueueKey,
  readNzbBody,
} from "@/lib/enqueue-request";
import {
  getQueue,
  getHistory,
  deleteHistoryItem,
  addToQueue,
  parseNzbContent,
  getConfigResponse,
  retryDownload,
} from "@/services/download";

/** Bound read responses, including an established socket to an unavailable DB.
 * Prisma reads cannot be cancelled here; their eventual result is ignored.
 * Never wrap mutations: a timeout must not suggest a failed write is retry-safe.
 */
async function boundedRead<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Download read deadline exceeded")), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Both shipped SAB URLs share status, mutation and redacted failure contracts. */
export async function GET(request: NextRequest) {
  try {
    const response = await getResponse(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof DownloadReadError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Failed to read download API");
    return NextResponse.json({ error: "Failed to read download API" }, { status: 500 });
  }
}

async function getResponse(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("mode");
  const name = searchParams.get("name");
  const value = searchParams.get("value");
  const delFiles = searchParams.get("del_files") === "1";

  switch (mode) {
    case "version":
      return NextResponse.json({ version: "4.3.3" });

    case "get_config":
      return NextResponse.json(await boundedRead(getConfigResponse));

    case "fullstatus": {
      const queue = await boundedRead(getQueue);
      return NextResponse.json({
        status: {
          paused: false,
          speed: "0",
          kbpersec: "0",
          mbleft: "0",
          mb: "0",
          noofslots: queue.noofslots ?? queue.slots.length,
          state: "IDLE",
        },
      });
    }

    case "queue": {
      const options = parseDownloadRead(searchParams, "queue");
      const queue = await boundedRead(() => getQueue(options));
      return NextResponse.json({ queue });
    }

    case "history": {
      if (name && !writesEnabled()) {
        return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
      }
      // Handle history deletion
      if (name === "delete" && value) {
        try {
          const isDeleted = await deleteHistoryItem(value, delFiles);
          if (isDeleted) {
            return NextResponse.json({ status: true });
          }
          return NextResponse.json({ status: false, error: "Item not found" }, { status: 404 });
        } catch (error) {
          if (
            error instanceof UnsafeDownloadPathError ||
            error instanceof InvalidDownloadInputError
          ) {
            return NextResponse.json({ status: false, error: error.message }, { status: 409 });
          }
          throw error;
        }
      }

      // Handle retry
      if (name === "retry" && value) {
        try {
          const result = await retryDownload(value);
          if (result) {
            return NextResponse.json({ status: true, nzo_id: result.id });
          }
          return NextResponse.json({ status: false, error: "Item not found" }, { status: 404 });
        } catch (error) {
          if (
            error instanceof InvalidDownloadInputError ||
            error instanceof MediaExpectationsError
          ) {
            return NextResponse.json({ status: false, error: error.message }, { status: 409 });
          }
          throw error;
        }
      }

      // Return history list
      const options = parseDownloadRead(searchParams, "history");
      const history = await boundedRead(() => getHistory(options));
      return NextResponse.json({ history });
    }

    default:
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
  }
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("mode");
  const cat = searchParams.get("cat") || "default";

  if (mode !== "addfile") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  try {
    if (
      request.nextUrl.search.length > 16_384 ||
      ["mode", "cat"].some((key) => searchParams.getAll(key).length > 1)
    )
      throw new EnqueueRequestError("Invalid enqueue parameters");
    const key = parseEnqueueKey(request.headers.get(ENQUEUE_KEY_HEADER));
    const nzbContent = await readNzbBody(request);

    const parsed = parseNzbContent(nzbContent);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid NZB format" }, { status: 400 });
    }

    const { title, url, mediaExpectations } = parsed;

    // Add to the download queue
    const queueItem =
      key !== undefined
        ? await addToQueue(url, title, cat, mediaExpectations, key)
        : mediaExpectations === undefined
          ? await addToQueue(url, title, cat)
          : await addToQueue(url, title, cat, mediaExpectations);

    return NextResponse.json({
      status: true,
      nzo_ids: [queueItem.id],
    });
  } catch (error) {
    if (error instanceof EnqueueRequestError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof EnqueueConflictError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Error adding file");
    if (error instanceof InvalidDownloadInputError || error instanceof MediaExpectationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to add file" }, { status: 500 });
  }
}
