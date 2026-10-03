import { afterEach, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "./fetch-retry";
import { isProbeableMp4, probeMp4AudioLanguage, readMp4AudioLanguage } from "./mp4-audio-language";

function atom(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}
function metadata(codes: string[], version = 0) {
  return Buffer.concat(
    codes.map((code) => {
      const mdhd = Buffer.alloc(version ? 36 : 24);
      mdhd[0] = version;
      const packed = [...code].reduce(
        (value, letter) => (value << 5) | (letter.charCodeAt(0) - 96),
        0
      );
      mdhd.writeUInt16BE(packed, version ? 32 : 20);
      const handler = Buffer.alloc(12);
      handler.write("soun", 8);
      return atom("trak", atom("mdia", Buffer.concat([atom("hdlr", handler), atom("mdhd", mdhd)])));
    })
  );
}
const url = "https://rodlzdf-a.akamaihd.net/synthetic/movie.mp4";
afterEach(() => vi.unstubAllGlobals());

it.each([0, 1])("reads only coherent sound-track mdhd language, version %i", (version) => {
  expect(readMp4AudioLanguage(metadata(["deu"], version))).toBe("de");
  expect(readMp4AudioLanguage(metadata(["fra"], version))).toBe("fr");
  expect(readMp4AudioLanguage(metadata(["deu", "deu"], version))).toBe("de");
  expect(readMp4AudioLanguage(metadata(["deu", "fra"], version))).toBeNull();
  expect(readMp4AudioLanguage(metadata(["und"], version))).toBeNull();
  expect(readMp4AudioLanguage(metadata(["deu", "und"], version))).toBeNull();
  expect(readMp4AudioLanguage(Buffer.from("moov deutsch"))).toBeNull();
  expect(readMp4AudioLanguage(metadata(["deu"], 2))).toBeNull();
});

it("never probes an arbitrary host, port, credential, redirect target or playlist", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const value of [
    "http://127.0.0.1/a.mp4",
    "https://rodlzdf-a.akamaihd.net.evil.test/a.mp4",
    "https://user:secret@rodlzdf-a.akamaihd.net/a.mp4",
    "https://rodlzdf-a.akamaihd.net:4431/a.mp4",
    "https://rodlzdf-a.akamaihd.net/a.m3u8",
  ]) {
    expect(isProbeableMp4(value)).toBe(false);
    expect(await probeMp4AudioLanguage(value, new HttpRequestBudget())).toBeNull();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("skips a top-level mdat by its declared size, reading at most two bounded ranges", async () => {
  const ftyp = atom("ftyp", Buffer.from("isom"));
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(2_000_000);
  mdat.write("mdat", 4);
  const first = Buffer.concat([ftyp, mdat]);
  const last = atom("moov", metadata(["deu"]));
  const start = ftyp.length + 2_000_000;
  const total = start + last.length;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(first, {
        status: 206,
        headers: { "content-range": `bytes 0-${first.length - 1}/${total}` },
      })
    )
    .mockResolvedValueOnce(
      new Response(last, {
        status: 206,
        headers: { "content-range": `bytes ${start}-${total - 1}/${total}` },
      })
    );
  vi.stubGlobal("fetch", fetch);
  const budget = new HttpRequestBudget();
  expect(await probeMp4AudioLanguage(url, budget)).toBe("de");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { Range: "bytes=0-1048575", "Accept-Encoding": "identity" },
  });
  expect(fetch.mock.calls[1][1].headers.Range).toBe(`bytes=${start}-${start + 1048575}`);
  expect(budget.remainingAttempts).toBe(8);
});

it.each(["ignored", "wrong-offset", "overflow", "truncated", "encoded"])(
  "refuses %s Range responses",
  async (kind) => {
    const data = atom("moov", metadata(["deu"]));
    const headers: Record<string, string> = {
      "content-range": `bytes 0-${data.length - 1}/${data.length}`,
    };
    if (kind === "wrong-offset")
      headers["content-range"] = `bytes 1-${data.length}/${data.length + 1}`;
    if (kind === "overflow") headers["content-range"] = "bytes 0-1048576/2000000";
    if (kind === "truncated")
      headers["content-range"] = `bytes 0-${data.length}/${data.length + 1}`;
    if (kind === "encoded") headers["content-encoding"] = "gzip";
    const fetch = vi.fn(
      async () => new Response(data, { status: kind === "ignored" ? 200 : 206, headers })
    );
    vi.stubGlobal("fetch", fetch);
    expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it("rejects oversize streamed Range bodies and slow bodies within the shared deadline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(Buffer.alloc(1048577), {
          status: 206,
          headers: { "content-range": "bytes 0-1048575/2000000" },
        })
    )
  );
  await expect(probeMp4AudioLanguage(url, new HttpRequestBudget())).rejects.toThrow(
    "Invalid provider response"
  );
  let cancelled = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 206, headers: { "content-range": "bytes 0-7/8" } }
        )
    )
  );
  await expect(probeMp4AudioLanguage(url, new HttpRequestBudget(1, 10))).rejects.toThrow(
    "Invalid provider response"
  );
  expect(cancelled).toBe(true);
});
