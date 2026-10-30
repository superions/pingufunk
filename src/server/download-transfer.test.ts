import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { downloadFile } from "./download-transfer";

afterEach(() => vi.unstubAllGlobals());

it("streams bounded ranges from a real HTTP server into one exclusive file, with whole-asset progress", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pingufunk-ranges-"));
  const payload = Buffer.from("synthetic video and audio");
  const ranges: string[] = [];
  const encodings: string[] = [];
  const ifRanges: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "")!;
    ranges.push(req.headers.range!);
    encodings.push(req.headers["accept-encoding"] ?? "");
    ifRanges.push(
      typeof req.headers["if-range"] === "string" ? req.headers["if-range"] : undefined
    );
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), payload.length - 1);
    res.writeHead(206, {
      "content-range": `bytes ${start}-${end}/${payload.length}`,
      "content-length": end - start + 1,
      etag: '"fixed"',
    });
    res.end(payload.subarray(start, end + 1));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const progress = vi.fn(async () => {});
    const destination = path.join(root, "video");
    expect(
      await downloadFile(`http://127.0.0.1:${port}/video`, destination, progress, undefined, {
        chunkSize: 7,
      })
    ).toBeNull();
    expect(await readFile(destination)).toEqual(payload);
    expect(ranges).toEqual(["bytes=0-6", "bytes=7-13", "bytes=14-20", "bytes=21-27"]);
    expect(
      encodings.every((value) =>
        value.split(",").every((encoding) => encoding.trim() === "identity")
      )
    ).toBe(true);
    expect(ifRanges).toEqual([undefined, '"fixed"', '"fixed"', '"fixed"']);
    expect(progress.mock.calls.at(-1)).toEqual([
      100,
      payload.length,
      payload.length,
      expect.any(Number),
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "ignored",
  "offset",
  "total",
  "tag",
  "length",
  "short",
  "overflow",
  "encoding",
  "cancel",
  "existing",
])(
  "fails closed for %s, without overwriting an existing artifact or making a retry",
  async (fault) => {
    const root = await mkdtemp(path.join(tmpdir(), "pingufunk-range-failure-"));
    const destination = path.join(root, "video");
    const controller = new AbortController();
    const requests: string[] = [];
    if (fault === "existing") await writeFile(destination, "preserved partial data");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        requests.push(new Headers(init.headers).get("range")!);
        const second = requests.length === 2;
        if (fault === "ignored") return new Response("private response", { status: 200 });
        return new Response(
          fault === "short" && second
            ? "c"
            : fault === "overflow" && second
              ? "cde"
              : second
                ? "cd"
                : "ab",
          {
            status: 206,
            headers: {
              "content-range": second
                ? `bytes ${fault === "offset" ? 1 : 2}-3/${fault === "total" ? 5 : 4}`
                : "bytes 0-1/4",
              "content-length": fault === "length" && second ? "1" : "2",
              etag: second && fault === "tag" ? '"changed"' : '"fixed"',
              ...(second && fault === "encoding" ? { "content-encoding": "gzip" } : {}),
            },
          }
        );
      })
    );
    try {
      const failure = await downloadFile(
        "https://synthetic.invalid?token=private",
        destination,
        async () => {
          if (fault === "cancel") controller.abort();
        },
        controller.signal,
        { chunkSize: 2 }
      );
      expect(failure).not.toBeNull();
      expect(JSON.stringify(failure)).not.toContain("private");
      expect(requests.length).toBeLessThanOrEqual(2);
      if (fault === "existing")
        expect(await readFile(destination, "utf8")).toBe("preserved partial data");
      else await expect(access(destination)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
