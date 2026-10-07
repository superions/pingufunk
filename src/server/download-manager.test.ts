import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fsp from "fs/promises";
import { WriteStream } from "fs";
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
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { jobDirectoryName } from "@/lib/download-paths";

const {
  configFindUnique,
  downloadCount,
  downloadFindFirst,
  downloadFindUnique,
  downloadUpdate,
  downloadUpdateMany,
  ffmpegModuleLoaded,
  convertMp4ToMkv,
  downloadHlsStream,
  probeJobMedia,
} = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  downloadCount: vi.fn(),
  downloadFindFirst: vi.fn(),
  downloadFindUnique: vi.fn(),
  downloadUpdate: vi.fn(),
  downloadUpdateMany: vi.fn(),
  ffmpegModuleLoaded: vi.fn(),
  convertMp4ToMkv: vi.fn(),
  downloadHlsStream: vi.fn(),
  probeJobMedia: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique: configFindUnique },
    $transaction: async (
      callback: (tx: { download: { update: typeof downloadUpdate } }) => Promise<void>
    ) => callback({ download: { update: downloadUpdate } }),
    download: {
      count: downloadCount,
      findFirst: downloadFindFirst,
      findUnique: downloadFindUnique,
      update: downloadUpdate,
      updateMany: downloadUpdateMany,
    },
  },
}));

vi.mock("./ffmpeg", () => {
  ffmpegModuleLoaded();
  return { convertMp4ToMkv };
});

vi.mock("./ytdlp", () => ({ downloadHlsStream }));
vi.mock("./media-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media-probe")>()),
  probeJobMedia,
}));
import { unknownMediaExpectations } from "@/lib/media-expectations";
import { mediaSourceIdentity } from "@/services/source-audio";
import { validateMediaProbe } from "./media-probe";
import type { TransferFailure } from "./download-failure";

const basicFacts = {
  durationSeconds: 120,
  video: [{ width: 320, height: 180 }],
  audioLanguages: [],
  expectedChecks: { duration: "unknown", audio: "unknown", resolution: "unknown" },
};

function progressiveJob(id = "probe-job", mediaExpectations: string | null = null) {
  configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
    Promise.resolve(
      where.key === "download.path"
        ? { value: testRoot }
        : where.key === "download.convertToMkv"
          ? { value: "false" }
          : null
    )
  );
  const job = {
    id,
    title: "Synthetic.S01E01",
    category: "sonarr",
    status: "queued",
    url: "https://example.invalid/media.mp4",
    mediaExpectations,
  };
  downloadFindUnique.mockResolvedValue(job);
  downloadUpdate.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } })
    )
  );
  return job;
}

const syntheticProbe = {
  format: { format_name: "mov,mp4", duration: "120" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 320, height: 180 },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 1 },
  ],
};

import { clearSettingsCache } from "@/lib/settings";
import { unknownJobMediaExpectations } from "@/lib/media-expectations";
import {
  processDownload,
  recoverInterruptedDownloads,
  startDownloadProcessing,
} from "./download-manager";

let testRoot: string;

function failedTransfer(): TransferFailure {
  const call = downloadUpdate.mock.calls.find(([call]) => call.data.status === "failed")?.[0];
  expect(call).toBeDefined();
  expect(probeJobMedia).not.toHaveBeenCalled();
  expect(downloadUpdate.mock.calls.some(([call]) => call.data.status === "completed")).toBe(false);
  return JSON.parse(call.data.error.slice("Download failed: ".length));
}

it("classifies a progress DB failure separately and redacts both history and logs", async () => {
  const job = progressiveJob();
  const secret = "secret-in-prisma-meta";
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  downloadUpdate.mockImplementation(async ({ data }) => {
    if (data.downloadedBytes)
      throw Object.assign(new Error(`postgresql://${secret}`), {
        code: "P1008",
        meta: { query: secret },
      });
    return {};
  });
  try {
    await processDownload(job.id);
    expect(failedTransfer()).toMatchObject({
      phase: "progress",
      reason: "exception",
      code: "P1008",
      receivedBytes: 4,
      writtenBytes: 4,
      expectedBytes: 4,
      httpStatus: 200,
    });
    expect(JSON.stringify(downloadUpdate.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
    const temp = path.join(
      testRoot,
      "incomplete",
      jobDirectoryName(job.title, job.id),
      job.title + ".mp4"
    );
    await expect(access(temp)).rejects.toThrow();
  } finally {
    errors.mockRestore();
  }
});

it("retains the transfer diagnostic through a failed status write and later reconciliation", async () => {
  const job = progressiveJob("db-reconnect-diagnostic");
  let available = false;
  downloadUpdate.mockImplementation(async ({ data }) => {
    if (data.downloadedBytes || (!available && data.status === "failed"))
      throw Object.assign(new Error("private DB details"), { code: "P1001" });
    if (data.status) job.status = data.status;
    return job;
  });
  downloadFindFirst.mockImplementation(async () => (job.status === "queued" ? job : null));
  await expect(startDownloadProcessing()).rejects.toThrow("private DB details");
  available = true;
  await startDownloadProcessing();
  expect(job.status).toBe("failed");
  expect(failedTransfer()).toMatchObject({ phase: "progress", code: "P1001" });
});

it.each([503, 403])(
  "records numeric HTTP %s without response text or credentials",
  async (status) => {
    const job = progressiveJob();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("private response body", {
            status,
            statusText: "private status text",
          })
      )
    );
    await processDownload(job.id);
    expect(failedTransfer()).toMatchObject({
      phase: "response",
      reason: "http_status",
      httpStatus: status,
    });
    expect(JSON.stringify(downloadUpdate.mock.calls)).not.toContain("private");
  }
);

it("classifies an exclusive-open race and preserves the preexisting file", async () => {
  const job = progressiveJob();
  const file = path.join(
    testRoot,
    "incomplete",
    jobDirectoryName(job.title, job.id),
    `${job.title}.mp4`
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await writeFile(file, "neighbor-content");
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } });
    })
  );
  await processDownload(job.id);
  expect(failedTransfer()).toMatchObject({
    phase: "file_open",
    code: "EEXIST",
    writtenBytes: 0,
    receivedBytes: 0,
  });
  expect(await readFile(file, "utf8")).toBe("neighbor-content");
});

it("classifies an injected write error without exposing paths or treating it as a network error", async () => {
  const job = progressiveJob();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const write = vi.spyOn(WriteStream.prototype, "write").mockImplementationOnce((...args) => {
    const callback = args.at(-1);
    if (typeof callback !== "function") throw Error("Test requires the real write callback");
    callback(
      Object.assign(new Error("private-destination-path"), {
        code: "ENOSPC",
        path: "private-destination-path",
      })
    );
    return false;
  });
  try {
    await processDownload(job.id);
    expect(failedTransfer()).toMatchObject({
      phase: "file_write",
      code: "ENOSPC",
      receivedBytes: 4,
      writtenBytes: 0,
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private-destination-path");
    expect(JSON.stringify(downloadUpdate.mock.calls)).not.toContain("private-destination-path");
    await expect(
      access(
        path.join(testRoot, "incomplete", jobDirectoryName(job.title, job.id), `${job.title}.mp4`)
      )
    ).rejects.toThrow();
  } finally {
    write.mockRestore();
    errors.mockRestore();
  }
});

it("does not mislabel a timeout during progress persistence as a network stall", async () => {
  const job = progressiveJob();
  let resume!: () => void;
  downloadUpdate.mockImplementation(async ({ data }) => {
    if (data.downloadedBytes)
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
    return {};
  });
  vi.useFakeTimers();
  try {
    const work = processDownload(job.id);
    await vi.waitFor(() => expect(resume).toBeDefined());
    await vi.advanceTimersByTimeAsync(60001);
    resume();
    await work;
    expect(failedTransfer()).toMatchObject({
      phase: "progress",
      reason: "inactivity_timeout",
      writtenBytes: 4,
    });
  } finally {
    vi.useRealTimers();
  }
});

describe("isolated native HTTP transfer reproduction", () => {
  let server: Server;
  const nativeFetch = globalThis.fetch;
  let requests: string[];
  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push(req.url!.split("?")[0]);
      if (req.url!.startsWith("/reset")) {
        res.writeHead(200, { "Content-Length": "4096" });
        res.write(Buffer.alloc(1024, 1));
        const timer = setTimeout(() => res.destroy(), 30);
        res.once("close", () => clearTimeout(timer));
      } else if (req.url!.startsWith("/redirect")) {
        res.writeHead(302, { Location: "/private-target?token=synthetic-secret" });
        res.end();
      } else if (req.url!.startsWith("/gzip")) {
        void import("node:zlib").then(({ gzipSync }) => {
          const encoded = gzipSync(Buffer.alloc(1024, 2));
          res.writeHead(200, {
            "Content-Length": String(encoded.length),
            "Content-Encoding": "gzip",
          });
          res.end(encoded);
        });
      } else {
        res.writeHead(200, { "Content-Length": "1024" });
        res.end(Buffer.alloc(1024, 3));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("reproduces a socket abort after real received bytes and removes only its partial file", async () => {
    const job = progressiveJob();
    job.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/reset.mp4?token=synthetic-secret`;
    vi.stubGlobal("fetch", nativeFetch);
    await processDownload(job.id);
    expect(failedTransfer()).toMatchObject({
      phase: "body_read",
      code: "UND_ERR_SOCKET",
      receivedBytes: 1024,
      writtenBytes: 1024,
      expectedBytes: 4096,
      httpStatus: 200,
    });
    expect(JSON.stringify(downloadUpdate.mock.calls)).not.toContain("synthetic-secret");
    expect(requests).toEqual(["/reset.mp4"]);
    await expect(
      access(
        path.join(testRoot, "incomplete", jobDirectoryName(job.title, job.id), job.title + ".mp4")
      )
    ).rejects.toThrow();
  });

  it("rejects redirects without requesting their target or exposing Location", async () => {
    const job = progressiveJob();
    job.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/redirect.mp4`;
    vi.stubGlobal("fetch", nativeFetch);
    await processDownload(job.id);
    expect(failedTransfer()).toMatchObject({
      phase: "request",
      code: "UNKNOWN",
      reason: "exception",
    });
    expect(requests).toEqual(["/redirect.mp4"]);
    expect(JSON.stringify(downloadUpdate.mock.calls)).not.toContain("synthetic-secret");
  });

  it.each(["valid", "gzip"])(
    "finishes %s real HTTP bytes through the same worker/probe boundary",
    async (source) => {
      const job = progressiveJob();
      job.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${source}.mp4`;
      vi.stubGlobal("fetch", nativeFetch);
      await processDownload(job.id);
      expect(probeJobMedia).toHaveBeenCalledTimes(1);
      const completed = downloadUpdate.mock.calls.find(
        ([call]) => call.data.status === "completed"
      )?.[0];
      expect(completed.data.size).toBe(1024);
      const file = path.join(
        testRoot,
        job.category,
        jobDirectoryName(job.title, job.id),
        job.title + ".mp4"
      );
      expect(await readFile(file)).toEqual(Buffer.alloc(1024, source === "gzip" ? 2 : 3));
      expect(requests).toEqual([`/${source}.mp4`]);
    }
  );
});

it("does not report legacy completion until the probe resolves and persists unknown checks", async () => {
  const job = progressiveJob();
  let finishProbe: (value: typeof basicFacts) => void = () => {};
  probeJobMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishProbe = resolve;
      })
  );
  const work = processDownload(job.id);
  await vi.waitFor(() => expect(probeJobMedia).toHaveBeenCalledTimes(1));
  expect(downloadUpdate.mock.calls.some(([call]) => call.data.status === "completed")).toBe(false);
  expect(probeJobMedia).toHaveBeenCalledWith(
    expect.stringContaining(jobDirectoryName(job.title, job.id)),
    expect.any(String),
    null,
    10
  );
  finishProbe(basicFacts);
  await work;
  const completed = downloadUpdate.mock.calls.find(([call]) => call.data.status === "completed")![0]
    .data;
  expect(JSON.parse(completed.mediaValidation)).toEqual({ version: 1, ...basicFacts });
  expect(completed.filePath).toBe(
    path.join(testRoot, job.category, jobDirectoryName(job.title, job.id), `${job.title}.mp4`)
  );
});

it("passes v2 source URL to the media owner and persists separate evidence without invented track tags", async () => {
  const url = "https://fixture.akamaized.net/movie.mp4";
  const sourceAudio = {
    provider: "arte_hbbtv" as const,
    videoId: "123456-001-A",
    language: "de",
    mediaIdentity: mediaSourceIdentity(url),
  };
  const expected = { ...unknownMediaExpectations(), version: 2, sourceAudio };
  const job = progressiveJob("v2-source", JSON.stringify(expected));
  job.url = url;
  probeJobMedia.mockResolvedValue({
    ...basicFacts,
    sourceAudioEvidence: sourceAudio,
    expectedChecks: { ...basicFacts.expectedChecks, audio: "passed_provider" },
  });
  await processDownload(job.id);
  expect(probeJobMedia).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expected,
    10,
    url
  );
  const completed = downloadUpdate.mock.calls.find(([call]) => call.data.status === "completed")![0]
    .data;
  expect(JSON.parse(completed.mediaValidation)).toMatchObject({
    version: 2,
    audioLanguages: [],
    sourceAudioEvidence: sourceAudio,
    expectedChecks: { audio: "passed_provider" },
  });
});

it.each(["missing-audio", "html", "sample", "probe-timeout"])(
  "rejects %s before completion and continues the next queued job",
  async (failure) => {
    const expectations = {
      ...unknownMediaExpectations(),
      duration: { seconds: 5400, provenance: "episode_metadata" as const },
    };
    const first = progressiveJob(
      "bad-job",
      failure === "sample" ? JSON.stringify(expectations) : null
    );
    const next = { ...first, id: "next-job", mediaExpectations: null };
    const jobs = [first, next];
    downloadFindFirst.mockImplementation(
      async () => jobs.find((job) => job.status === "queued") ?? null
    );
    downloadFindUnique.mockImplementation(async ({ where }) =>
      jobs.find((job) => job.id === where.id)
    );
    downloadUpdate.mockImplementation(async ({ where, data }) => {
      const job = jobs.find((job) => job.id === where.id)!;
      if (data.status) job.status = data.status;
      return job;
    });
    probeJobMedia
      .mockImplementationOnce(async (_file, _dir, expected, tolerance) => {
        if (failure === "probe-timeout") throw new Error("Local media validation failed");
        const probe =
          failure === "html"
            ? { format: { format_name: "html", duration: "120" }, streams: [] }
            : failure === "missing-audio"
              ? { ...syntheticProbe, streams: syntheticProbe.streams.slice(0, 1) }
              : syntheticProbe;
        return validateMediaProbe(probe, expected, tolerance);
      })
      .mockImplementationOnce(async (_file, _dir, expected, tolerance) =>
        validateMediaProbe(syntheticProbe, expected, tolerance)
      );
    await startDownloadProcessing();
    expect(jobs.map((job) => job.status)).toEqual(["failed", "completed"]);
    expect(
      downloadUpdate.mock.calls.some(
        ([call]) => call.where.id === first.id && call.data.status === "completed"
      )
    ).toBe(false);
  }
);

it.each(["3", "5", "4junk", "0"])(
  "fails an incomplete or invalid reliable Content-Length %s before probing",
  async (length) => {
    const job = progressiveJob();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": length } })
      )
    );
    await processDownload(job.id);
    expect(probeJobMedia).not.toHaveBeenCalled();
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: job.id },
      data: expect.objectContaining({ status: "failed" }),
    });
    expect(downloadUpdate.mock.calls.some(([call]) => call.data.status === "completed")).toBe(
      false
    );
    expect(failedTransfer()).toMatchObject({
      reason:
        length === "4junk"
          ? "invalid_length"
          : length === "5"
            ? "length_mismatch"
            : "length_overflow",
      expectedBytes: length === "4junk" ? null : Number(length),
    });
  }
);

it("does not confuse compressed wire length with the decoded local file length", async () => {
  const job = progressiveJob();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-length": "2", "content-encoding": "gzip" },
        })
    )
  );
  await processDownload(job.id);
  expect(probeJobMedia).toHaveBeenCalledTimes(1);
  expect(downloadUpdate.mock.calls.some(([call]) => call.data.status === "completed")).toBe(true);
});

it("pauses on a failed completion DB write, then reconciles its own job before the next wakeup", async () => {
  const job = progressiveJob("interrupted-db-job");
  let unavailable = false;
  downloadUpdate.mockImplementation(async ({ data }) => {
    if (data.status === "completed") {
      unavailable = true;
      throw new Error("synthetic database failure");
    }
    if (unavailable) throw new Error("synthetic database failure");
    if (data.status) job.status = data.status;
    return job;
  });
  downloadFindFirst.mockImplementation(async () => (job.status === "queued" ? job : null));
  await expect(startDownloadProcessing()).rejects.toThrow("synthetic database failure");
  expect(job.status).toBe("downloading");
  expect(downloadFindFirst).toHaveBeenCalledTimes(1);
  unavailable = false;
  await startDownloadProcessing();
  expect(job.status).toBe("failed");
  expect(probeJobMedia).toHaveBeenCalledTimes(1);
});

it("validates stored v1 before fetching and never recovers a corrupt payload as legacy", async () => {
  const job = progressiveJob("corrupt-expectations", "{}");
  await processDownload(job.id);
  expect(fetch).not.toHaveBeenCalled();
  expect(probeJobMedia).not.toHaveBeenCalled();
  expect(downloadUpdate.mock.calls.some(([call]) => call.data.status === "completed")).toBe(false);
});

it("does not overwrite a verified durable completion after a lost write acknowledgement", async () => {
  const job = progressiveJob("lost-commit-ack");
  downloadUpdate.mockImplementation(async ({ data }) => {
    if (data.status) job.status = data.status;
    if (data.status === "completed") throw new Error("Synthetic lost commit acknowledgement");
    return job;
  });
  await processDownload(job.id);
  expect(job.status).toBe("completed");
  expect(probeJobMedia).toHaveBeenCalledTimes(1);
  expect(downloadUpdate.mock.calls.some(([call]) => call.data.status === "failed")).toBe(false);
});

it("passes the persisted v1 expectations and configured P06 tolerance to the common gate", async () => {
  const expectations = {
    ...unknownMediaExpectations(),
    duration: { seconds: 120, provenance: "episode_metadata" as const },
  };
  const job = progressiveJob("strict-duration", JSON.stringify(expectations));
  const lookup = configFindUnique.getMockImplementation()!;
  configFindUnique.mockImplementation(async (args) =>
    args.where.key === "matching.sonarr.tolerancePercent" ? { value: "0" } : lookup(args)
  );
  probeJobMedia.mockImplementation(async (_file, _dir, expected, tolerance) =>
    validateMediaProbe(syntheticProbe, expected, tolerance)
  );
  await processDownload(job.id);
  expect(probeJobMedia).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expectations,
    0
  );
  const completed = downloadUpdate.mock.calls.find(([call]) => call.data.status === "completed")![0]
    .data;
  expect(JSON.parse(completed.mediaValidation).expectedChecks).toEqual({
    duration: "passed",
    audio: "unknown",
    resolution: "unknown",
  });
});

it("uses frozen v3 references without reading or repairing current series policy", async () => {
  const expectations = {
    ...unknownJobMediaExpectations(),
    mediaKind: "series" as const,
    durations: {
      source: {
        seconds: 120,
        provenance: "source_catalogue" as const,
        tolerancePercent: 10 as const,
      },
      metadata: { seconds: 120, provenance: "episode_metadata" as const, tolerancePercent: 15 },
    },
  };
  const job = progressiveJob("frozen-v3", JSON.stringify(expectations));
  const lookup = configFindUnique.getMockImplementation()!;
  configFindUnique.mockImplementation(async (args) =>
    args.where.key === "matching.sonarr.tolerancePercent" ? { value: "invalid" } : lookup(args)
  );
  probeJobMedia.mockImplementation(async (_file, _dir, expected, tolerance) =>
    validateMediaProbe(syntheticProbe, expected, tolerance)
  );
  await processDownload(job.id);
  expect(
    configFindUnique.mock.calls.some(
      ([args]) => args.where.key === "matching.sonarr.tolerancePercent"
    )
  ).toBe(false);
  expect(probeJobMedia).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expectations,
    0
  );
  expect(
    downloadUpdate.mock.calls.find(([call]) => call.data.status === "completed")?.[0].data
      .mediaValidation
  ).toContain('"version":3');
});

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
  downloadFindFirst.mockReset();
  downloadFindUnique.mockReset();
  downloadUpdate.mockReset();
  downloadUpdateMany.mockReset();
  convertMp4ToMkv.mockReset();
  probeJobMedia.mockReset().mockResolvedValue(basicFacts);

  testRoot = await mkdtemp(path.join(tmpdir(), "rundfunkarr-download-manager-"));
  vi.stubEnv("DOWNLOAD_TEMP_PATH", path.join(testRoot, "incomplete"));
  vi.stubEnv("DOWNLOAD_FOLDER_PATH_MAPPING", "/mapped/downloads");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(testRoot, { recursive: true, force: true });
});

it("blocks recovery and worker processing before any database or file access in maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  await expect(recoverInterruptedDownloads()).rejects.toThrow("writes are disabled");
  await expect(startDownloadProcessing()).rejects.toThrow("writes are disabled");
  await expect(processDownload("synthetic-job")).rejects.toThrow("writes are disabled");
  expect(downloadUpdateMany).not.toHaveBeenCalled();
  expect(downloadFindFirst).not.toHaveBeenCalled();
  expect(downloadFindUnique).not.toHaveBeenCalled();
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

it.each(["network", "ffmpeg", "filesystem"])(
  "drains a %s failure before processing the next queued job",
  async (failure) => {
    const jobs = ["failed-job", "next-job"];
    downloadFindFirst
      .mockResolvedValueOnce({ id: jobs[0] })
      .mockResolvedValueOnce({ id: jobs[1] })
      .mockResolvedValueOnce(null);
    downloadFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      title: where.id,
      category: "sonarr",
      status: "queued",
      url: `https://example.org/video.${failure === "ffmpeg" && where.id === jobs[1] ? "webm" : "mp4"}`,
    }));
    configFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === "download.path"
        ? { value: testRoot }
        : where.key === "download.convertToMkv"
          ? { value: String(failure === "ffmpeg") }
          : null
    );
    downloadUpdate.mockResolvedValue({});
    if (failure === "filesystem") {
      const tempJobDir = path.join(testRoot, "incomplete", jobDirectoryName(jobs[0], jobs[0]));
      await mkdir(tempJobDir, { recursive: true });
      await writeFile(path.join(tempJobDir, `${jobs[0]}.mp4`), "preexisting");
    }
    if (failure === "ffmpeg") {
      convertMp4ToMkv.mockResolvedValue({ success: false, error: "ffmpeg unavailable" });
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          failure === "network"
            ? new Response("unavailable", { status: 503 })
            : new Response(new Uint8Array([1, 2, 3]))
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    );

    await startDownloadProcessing();

    expect(downloadFindUnique.mock.calls.map(([args]) => args.where.id)).toEqual([
      jobs[0],
      jobs[0],
      jobs[1],
    ]);
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: jobs[0] },
      data: expect.objectContaining({ status: "failed" }),
    });
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: jobs[1] },
      data: expect.objectContaining({ status: "completed" }),
    });
  }
);

it("resets queue state after a database poll failure", async () => {
  downloadFindFirst
    .mockRejectedValueOnce(new Error("synthetic database failure"))
    .mockResolvedValueOnce(null);
  await expect(startDownloadProcessing()).rejects.toThrow("synthetic database failure");
  await expect(startDownloadProcessing()).resolves.toBeUndefined();
  expect(downloadFindFirst).toHaveBeenCalledTimes(2);
});

it("rechecks the queue when an enqueue wakeup races with an empty poll", async () => {
  let release!: () => void;
  downloadFindFirst
    .mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          release = () => resolve(null);
        })
    )
    .mockResolvedValueOnce(null);
  const first = startDownloadProcessing();
  await vi.waitFor(() => expect(release).toBeDefined());
  const wakeup = startDownloadProcessing();
  release();
  await Promise.all([first, wakeup]);
  expect(downloadFindFirst).toHaveBeenCalledTimes(2);
});

it("marks only interrupted active rows failed at startup", async () => {
  downloadUpdateMany.mockResolvedValue({ count: 2 });
  expect(await recoverInterruptedDownloads()).toBe(2);
  expect(downloadUpdateMany).toHaveBeenCalledWith({
    where: { status: { in: ["downloading", "converting"] } },
    data: expect.objectContaining({ status: "failed", completedAt: expect.any(Date) }),
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
    expect(failedTransfer()).toMatchObject({
      phase: "body_read",
      reason: failure === "stall" ? "inactivity_timeout" : "exception",
      writtenBytes: 3,
      receivedBytes: 3,
      expectedBytes: 100,
    });
  } finally {
    vi.useRealTimers();
  }
});
