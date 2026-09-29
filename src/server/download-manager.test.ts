import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fsp from "fs/promises";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";

// Everything stays the real implementation; only `link` is wrapped in a
// vi.fn so a single test can inject a failure into its first call (ESM module
// namespaces cannot be spied on directly).
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
});
import { tmpdir } from "os";
import path from "path";
import { jobDirectoryName } from "@/lib/download-paths";

const {
  configFindUnique,
  downloadCount,
  downloadFindUnique,
  downloadUpdate,
  ffmpegModuleLoaded,
  convertMp4ToMkv,
  downloadHlsStream,
} = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  downloadCount: vi.fn(),
  downloadFindUnique: vi.fn(),
  downloadUpdate: vi.fn(),
  ffmpegModuleLoaded: vi.fn(),
  convertMp4ToMkv: vi.fn(),
  downloadHlsStream: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique: configFindUnique },
    download: {
      count: downloadCount,
      findUnique: downloadFindUnique,
      update: downloadUpdate,
    },
  },
}));

vi.mock("./ffmpeg", () => {
  ffmpegModuleLoaded();
  return { convertMp4ToMkv };
});

vi.mock("./ytdlp", () => ({ downloadHlsStream }));

import { clearSettingsCache } from "@/lib/settings";
import { processDownload } from "./download-manager";

let testRoot: string;

it.each(["mkv", "mp4"])(
  "resolves SRF at download time and finishes HLS as %s across mounts",
  async (container) => {
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        where.key === "download.path"
          ? { value: testRoot }
          : where.key === "download.convertToMkv"
            ? { value: String(container === "mkv") }
            : null
      )
    );
    downloadFindUnique.mockResolvedValue({
      id: "hls",
      title: "Rundschau",
      category: "tv",
      status: "queued",
      url: "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111#rundfunkarr-height=480",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    downloadHlsStream.mockImplementation(async (_url: string, output: string) => {
      await writeFile(output, "media");
      return { success: true, outputPath: output };
    });
    vi.mocked(fsp.link).mockRejectedValueOnce(
      Object.assign(new Error("cross-device"), { code: "EXDEV" })
    );
    await processDownload("hls");
    expect(downloadHlsStream).toHaveBeenLastCalledWith(
      "srgssr:srf:video:11111111-1111-4111-8111-111111111111",
      expect.stringContaining(`Rundschau.${container}`),
      expect.any(Function),
      container,
      480
    );
    const finalPath = path.join(
      testRoot,
      "tv",
      jobDirectoryName("Rundschau", "hls"),
      `Rundschau.${container}`
    );
    expect(await readFile(finalPath, "utf8")).toBe("media");
    expect(downloadUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          filePath: finalPath,
        }),
      })
    );
  }
);

beforeEach(async () => {
  clearSettingsCache();
  configFindUnique.mockReset();
  downloadCount.mockReset();
  downloadFindUnique.mockReset();
  downloadUpdate.mockReset();
  convertMp4ToMkv.mockReset();

  testRoot = await mkdtemp(path.join(tmpdir(), "rundfunkarr-download-manager-"));
  vi.stubEnv("DOWNLOAD_TEMP_PATH", path.join(testRoot, "incomplete"));
  vi.stubEnv("DOWNLOAD_FOLDER_PATH_MAPPING", "/mapped/downloads");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(testRoot, { recursive: true, force: true });
});

describe("processDownload", () => {
  it("rejects an HLS output symlink before invoking yt-dlp", async () => {
    downloadHlsStream.mockClear();
    const title = "Show.S01E10";
    const id = "44444444-4444-4444-8444-444444444444";
    const outside = path.join(testRoot, "outside.mkv");
    const tempJobDir = path.join(testRoot, "incomplete", jobDirectoryName(title, id));
    await mkdir(tempJobDir, { recursive: true });
    await writeFile(outside, "neighbor");
    await symlink(outside, path.join(tempJobDir, `${title}.mkv`));
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === "download.path" ? { value: testRoot } : null)
    );
    downloadFindUnique.mockResolvedValue({
      id,
      title,
      category: "sonarr",
      status: "queued",
      url: "https://example.org/master.m3u8",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);

    await processDownload(id);

    expect(downloadHlsStream).not.toHaveBeenCalled();
    await expect(readFile(outside, "utf8")).resolves.toBe("neighbor");
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("rejects a conversion output symlink before invoking FFmpeg", async () => {
    const title = "Show.S01E11";
    const id = "55555555-5555-4555-8555-555555555555";
    const outside = path.join(testRoot, "outside.mkv");
    const tempJobDir = path.join(testRoot, "incomplete", jobDirectoryName(title, id));
    await mkdir(tempJobDir, { recursive: true });
    await writeFile(outside, "neighbor");
    await symlink(outside, path.join(tempJobDir, `${title}.mkv`));
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === "download.path" ? { value: testRoot } : null)
    );
    downloadFindUnique.mockResolvedValue({
      id,
      title,
      category: "sonarr",
      status: "queued",
      url: "https://example.org/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));

    await processDownload(id);

    expect(convertMp4ToMkv).not.toHaveBeenCalled();
    await expect(readFile(outside, "utf8")).resolves.toBe("neighbor");
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("never writes through a preexisting symlink in its staging directory", async () => {
    const title = "Show.S01E09";
    const id = "33333333-3333-4333-8333-333333333333";
    const outside = path.join(testRoot, "outside.mp4");
    const tempJobDir = path.join(testRoot, "incomplete", jobDirectoryName(title, id));
    await mkdir(tempJobDir, { recursive: true });
    await writeFile(outside, "neighbor");
    await symlink(outside, path.join(tempJobDir, `${title}.mp4`));
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        where.key === "download.path"
          ? { value: testRoot }
          : where.key === "download.convertToMkv"
            ? { value: "false" }
            : null
      )
    );
    downloadFindUnique.mockResolvedValue({
      id,
      title,
      category: "sonarr",
      status: "queued",
      url: "https://example.org/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));

    await processDownload(id);

    await expect(readFile(outside, "utf8")).resolves.toBe("neighbor");
    expect((await lstat(path.join(tempJobDir, `${title}.mp4`))).isSymbolicLink()).toBe(true);
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("does not replace an existing completed-job target", async () => {
    const title = "Show.S01E12";
    const id = "66666666-6666-4666-8666-666666666666";
    const jobDir = path.join(testRoot, "sonarr", jobDirectoryName(title, id));
    await mkdir(jobDir, { recursive: true });
    await writeFile(path.join(jobDir, `${title}.mp4`), "previous");
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        where.key === "download.path"
          ? { value: testRoot }
          : where.key === "download.convertToMkv"
            ? { value: "false" }
            : null
      )
    );
    downloadFindUnique.mockResolvedValue({
      id,
      title,
      category: "sonarr",
      status: "queued",
      url: "https://example.org/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));

    await processDownload(id);

    await expect(readFile(path.join(jobDir, `${title}.mp4`), "utf8")).resolves.toBe("previous");
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("isolates equal release names while an earlier job is imported", async () => {
    const title = "Show.S01E01.720p";
    const category = "sonarr";
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const firstDir = path.join(testRoot, category, jobDirectoryName(title, firstId));
    const secondDir = path.join(testRoot, category, jobDirectoryName(title, secondId));
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        where.key === "download.path"
          ? { value: testRoot }
          : where.key === "download.convertToMkv"
            ? { value: "false" }
            : null
      )
    );
    downloadFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        title,
        category,
        status: "queued",
        url: `https://example.org/${where.id === firstId ? "first" : "second"}.mp4`,
      })
    );
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("second")) {
          await rm(firstDir, { recursive: true });
        }
        return new Response(new TextEncoder().encode(url.includes("first") ? "first" : "second"));
      })
    );

    await Promise.all([processDownload(firstId), processDownload(secondId)]);

    expect(firstDir).not.toBe(secondDir);
    await expect(access(path.join(firstDir, `${title}.mp4`))).rejects.toThrow();
    await expect(readFile(path.join(secondDir, `${title}.mp4`), "utf8")).resolves.toBe("second");
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: firstId },
      data: expect.objectContaining({
        status: "completed",
        filePath: path.join(firstDir, `${title}.mp4`),
      }),
    });
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: secondId },
      data: expect.objectContaining({
        status: "completed",
        filePath: path.join(secondDir, `${title}.mp4`),
      }),
    });
  });

  it("keeps MP4 files unchanged when MKV conversion is disabled", async () => {
    const mediaBytes = new Uint8Array([1, 2, 3, 4]);
    const title = "Show.S01E01";
    const category = "sonarr";

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "false" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-1",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        })
      )
    );

    await processDownload("download-1");

    expect(ffmpegModuleLoaded).not.toHaveBeenCalled();
    expect(convertMp4ToMkv).not.toHaveBeenCalled();
    const finalPath = path.join(
      testRoot,
      category,
      jobDirectoryName(title, "download-1"),
      `${title}.mp4`
    );
    await expect(readFile(finalPath)).resolves.toEqual(Buffer.from(mediaBytes));
    await expect(access(path.join(path.dirname(finalPath), `${title}.mkv`))).rejects.toThrow();
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-1" },
      data: expect.objectContaining({
        status: "completed",
        filePath: finalPath,
      }),
    });
  });

  it("recovers when the category directory is removed mid-download", async () => {
    const mediaBytes = new Uint8Array([5, 6, 7, 8]);
    const title = "Show.S01E02";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category);

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "false" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-2",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    // An *arr app imports an earlier download and deletes the then-empty
    // category folder while this one is still transferring.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        await rm(categoryDir, { recursive: true, force: true });
        return new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        });
      })
    );

    await processDownload("download-2");

    await expect(
      readFile(path.join(categoryDir, jobDirectoryName(title, "download-2"), `${title}.mp4`))
    ).resolves.toEqual(Buffer.from(mediaBytes));
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-2" },
      data: expect.objectContaining({ status: "completed" }),
    });
  });

  it("recovers when the category directory is removed during MKV conversion", async () => {
    const mediaBytes = new Uint8Array([9, 10, 11, 12]);
    const mkvBytes = new Uint8Array([13, 14, 15, 16]);
    const title = "Show.S01E03";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category);

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "true" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-3",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    convertMp4ToMkv.mockImplementation(async (_source: string, target: string) => {
      await writeFile(target, mkvBytes);
      // The folder disappears while ffmpeg is busy -- this is the window that
      // stranded finished files before the fix.
      await rm(categoryDir, { recursive: true, force: true });
      return { success: true };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        })
      )
    );

    await processDownload("download-3");

    const finalPath = path.join(categoryDir, jobDirectoryName(title, "download-3"), `${title}.mkv`);
    await expect(readFile(finalPath)).resolves.toEqual(Buffer.from(mkvBytes));
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-3" },
      data: expect.objectContaining({
        status: "completed",
        filePath: finalPath,
      }),
    });
  });

  it("recovers when the folder vanishes between the re-create and the move", async () => {
    // The narrowest possible race: an *arr import deletes the category folder
    // in the instant AFTER moveIntoJobDir re-created it and BEFORE the
    // link runs. Simulated by deleting the folder from inside the first
    // link call itself.
    const mediaBytes = new Uint8Array([17, 18, 19, 20]);
    const title = "Show.S01E04";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category);

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "false" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-4",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        })
      )
    );

    const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
    vi.mocked(fsp.link).mockImplementationOnce(async (source, target) => {
      await rm(categoryDir, { recursive: true, force: true });
      return actual.link(source, target); // fails with ENOENT, the retry must recover
    });

    await processDownload("download-4");

    await expect(
      readFile(path.join(categoryDir, jobDirectoryName(title, "download-4"), `${title}.mp4`))
    ).resolves.toEqual(Buffer.from(mediaBytes));
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-4" },
      data: expect.objectContaining({ status: "completed" }),
    });
  });
});

it.each(["network error", "stall"])("removes partial files after a %s", async (failure) => {
  configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
    Promise.resolve(where.key === "download.path" ? { value: testRoot } : null)
  );
  downloadFindUnique.mockResolvedValue({
    id: "failed-transfer",
    title: "Partial",
    category: "tv",
    status: "queued",
    url: "https://example.org/video.mp4",
  });
  downloadUpdate.mockResolvedValue({});
  downloadCount.mockResolvedValue(0);
  let source!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          source = controller;
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      options.signal.addEventListener("abort", () => source.error(new Error("aborted")), {
        once: true,
      });
      return new Response(body, { headers: { "content-length": "100" } });
    })
  );
  vi.useFakeTimers();
  try {
    const done = processDownload("failed-transfer");
    await vi.waitFor(() =>
      expect(downloadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ downloadedBytes: 3 }),
        })
      )
    );
    if (failure === "stall") await vi.advanceTimersByTimeAsync(60001);
    else source.error(new Error("connection lost"));
    await done;
    await expect(
      access(
        path.join(
          testRoot,
          "incomplete",
          jobDirectoryName("Partial", "failed-transfer"),
          "Partial.mp4"
        )
      )
    ).rejects.toThrow();
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  } finally {
    vi.useRealTimers();
  }
});
