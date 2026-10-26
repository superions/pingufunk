import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { transferSource } from "./source-download";
import { mediathekDownloadAdapter } from "@/providers/mediathek/download";
import type { SourceDownloadContext, SourceDownloadReference } from "@/types/provider";

const { downloadHlsStream } = vi.hoisted(() => ({ downloadHlsStream: vi.fn() }));
vi.mock("@/server/ytdlp", () => ({ downloadHlsStream }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

let root: string;
let context: SourceDownloadContext;
beforeEach(async () => {
  vi.restoreAllMocks();
  downloadHlsStream.mockReset();
  root = await mkdtemp(path.join(tmpdir(), "pingufunk-source-download-"));
  const stagingDirectory = path.join(root, "staging");
  await mkdir(stagingDirectory);
  context = {
    stagingDirectory,
    filename: "Episode",
    getContainer: vi.fn(async () => "mkv" as const),
    expectations: null,
    signal: new AbortController().signal,
    onProgress: vi.fn(async () => {}),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } })
    )
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

it("transfers real direct bytes into owned staging without reading the postprocessing preference", async () => {
  const artifact = await transferSource(
    { family: "mediathek", url: "https://example.invalid/video.mp4" },
    context
  );
  expect(artifact).toEqual({
    path: path.join(context.stagingDirectory, "Episode.mp4"),
    extension: ".mp4",
  });
  expect([...(await readFile(artifact.path))]).toEqual([1, 2, 3, 4]);
  expect(context.getContainer).not.toHaveBeenCalled();
  expect(context.onProgress).toHaveBeenCalledWith(100, 4, 4, expect.any(Number));
  expect(downloadHlsStream).not.toHaveBeenCalled();
});

it.each(["mkv", "mp4"] as const)(
  "resolves HLS/SRF within the source module and returns %s staging",
  async (container) => {
    context.getContainer = vi.fn(async () => container);
    downloadHlsStream.mockImplementation(async (_url, output, progress) => {
      await progress(95, 4, 4, 1);
      await writeFile(output, "media");
      return { success: true, outputPath: output };
    });
    const artifact = await transferSource(
      {
        family: "mediathek",
        url: "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111#rundfunkarr-height=480",
      },
      context
    );
    expect(await readFile(artifact.path, "utf8")).toBe("media");
    expect(downloadHlsStream).toHaveBeenCalledWith(
      "srgssr:srf:video:11111111-1111-4111-8111-111111111111",
      artifact.path,
      context.onProgress,
      container,
      480,
      context.signal
    );
    expect(context.getContainer).toHaveBeenCalledOnce();
    expect(artifact.extension).toBe(`.${container}`);
    expect(fetch).not.toHaveBeenCalled();
  }
);

it("does not guess a supported source or fall back to a generic URL downloader", async () => {
  const source = {
    family: "unregistered",
    url: "https://example.invalid/video.mp4",
  } as unknown as SourceDownloadReference;
  await expect(transferSource(source, context)).rejects.toThrow("Unsupported download source");
  expect(fetch).not.toHaveBeenCalled();
  expect(downloadHlsStream).not.toHaveBeenCalled();
});

it.each(["outside", "symlink", "empty", "directory"])(
  "rejects a %s artifact before shared postprocessing",
  async (kind) => {
    const outside = path.join(root, "outside.mp4");
    await writeFile(outside, "neighbor");
    const file = path.join(context.stagingDirectory, "Episode.mp4");
    if (kind === "symlink") await symlink(outside, file);
    if (kind === "empty") await writeFile(file, "");
    if (kind === "directory") await mkdir(file);
    vi.spyOn(mediathekDownloadAdapter, "transfer").mockResolvedValue({
      path: kind === "outside" ? outside : file,
      extension: ".mp4",
    });
    await expect(
      transferSource({ family: "mediathek", url: "https://example.invalid/video.mp4" }, context)
    ).rejects.toThrow("Invalid staged media file");
    expect(await readFile(outside, "utf8")).toBe("neighbor");
    expect(fetch).not.toHaveBeenCalled();
  }
);

it("rejects an escaping output name before invoking the backend", async () => {
  await expect(
    transferSource(
      { family: "mediathek", url: "https://example.invalid/video.mp4" },
      { ...context, filename: "../neighbor" }
    )
  ).rejects.toThrow("Invalid staging filename");
  expect(fetch).not.toHaveBeenCalled();
  expect(downloadHlsStream).not.toHaveBeenCalled();
});

it.each(["before", "during"])("honors cancellation %s the source invocation", async (when) => {
  const controller = new AbortController();
  context.signal = controller.signal;
  const adapter = vi.spyOn(mediathekDownloadAdapter, "transfer").mockImplementation(async () => {
    const file = path.join(context.stagingDirectory, "Episode.mp4");
    await writeFile(file, "media");
    controller.abort();
    return { path: file, extension: ".mp4" };
  });
  if (when === "before") controller.abort();
  await expect(
    transferSource({ family: "mediathek", url: "https://example.invalid/video.mp4" }, context)
  ).rejects.toThrow();
  expect(adapter).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
  expect(fetch).not.toHaveBeenCalled();
});

it("retains closed HTTP diagnostics and never leaks a tool's raw error or retries another transport", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("private-body", { status: 503 }));
  await expect(
    transferSource(
      { family: "mediathek", url: "https://example.invalid/video.mp4?token=private" },
      context
    )
  ).rejects.toMatchObject({
    transferFailure: { phase: "response", reason: "http_status", httpStatus: 503 },
  });
  vi.mocked(fetch).mockClear();
  downloadHlsStream.mockResolvedValue({
    success: false,
    error: "https://private.invalid?token=secret",
  });
  await expect(
    transferSource({ family: "mediathek", url: "https://example.invalid/video.m3u8" }, context)
  ).rejects.toThrow(/^HLS download failed$/);
  expect(fetch).not.toHaveBeenCalled();
  expect(downloadHlsStream).toHaveBeenCalledOnce();
});
