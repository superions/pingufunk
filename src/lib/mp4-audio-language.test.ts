import { afterEach, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "./fetch-retry";
import { isProbeableMp4, probeMp4AudioLanguage, readMp4AudioLanguage } from "./mp4-audio-language";
import { probeMp4MediaFacts } from "./mp4-audio-language";
import { syntheticMp4, mp4RangeResponse } from "./__fixtures__/mp4";

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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
        headers: {
          "content-range": `bytes 0-${first.length - 1}/${total}`,
          etag: '"synthetic-v1"',
        },
      })
    )
    .mockResolvedValueOnce(
      new Response(Buffer.concat([Buffer.alloc(256), last]), {
        status: 206,
        headers: {
          "content-range": `bytes ${start - 256}-${total - 1}/${total}`,
          etag: '"synthetic-v1"',
        },
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
  expect(fetch.mock.calls[1][1].headers.Range).toBe(
    `bytes=${start - 256}-${start - 256 + 1048575}`
  );
  expect(fetch.mock.calls[1][1].headers["If-Range"]).toBe('"synthetic-v1"');
  expect(budget.remainingAttempts).toBe(8);
});

function largeTrack(handlerType: string, code: string, padding: number) {
  const handler = Buffer.alloc(12);
  handler.write(handlerType, 8);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt16BE(
    [...code].reduce((value, letter) => (value << 5) | (letter.charCodeAt(0) - 96), 0),
    20
  );
  return atom(
    "trak",
    atom(
      "mdia",
      Buffer.concat([
        atom("mdhd", mdhd),
        atom("hdlr", handler),
        atom("minf", Buffer.alloc(padding)),
      ])
    )
  );
}

function stubRanges(data: Buffer) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => mp4RangeResponse(data, init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("retains parent headers across backwards seeks around distant sample tables and track trailers", async () => {
  const sample = Buffer.alloc(78);
  sample.writeUInt16BE(1920, 24);
  sample.writeUInt16BE(1080, 26);
  const description = Buffer.alloc(8);
  description.writeUInt32BE(1, 4);
  const handler = Buffer.alloc(12);
  handler.write("vide", 8);
  const trailer = atom("trgr", Buffer.alloc(8));
  const video = atom(
    "trak",
    Buffer.concat([
      atom(
        "mdia",
        Buffer.concat([
          atom("hdlr", handler),
          atom(
            "minf",
            atom(
              "stbl",
              Buffer.concat([
                atom("stts", Buffer.alloc(1400000)),
                atom("stsd", Buffer.concat([description, atom("avc1", sample)])),
                atom("stsz", Buffer.alloc(1600000)),
              ])
            )
          ),
        ])
      ),
      trailer,
    ])
  );
  const audio = largeTrack("soun", "deu", 1400000);
  const data = atom(
    "moov",
    Buffer.concat([video, atom("trak", Buffer.concat([audio.subarray(8), trailer]))])
  );
  const fetch = stubRanges(data);
  const budget = new HttpRequestBudget(4);
  expect(await probeMp4MediaFacts(url, budget)).toEqual({
    audioLanguage: "de",
    videoDimensions: { width: 1920, height: 1080 },
  });
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(4);
  for (const [, init] of fetch.mock.calls) {
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get("range")!)!;
    expect(Number(end) - Number(start) + 1).toBe(1024 * 1024);
  }
});

it.each([
  [1920, 1080],
  [1280, 720],
])(
  "reads coded %i x %i from the actual video sample entry, not slot hints",
  async (width, height) => {
    const fetch = stubRanges(syntheticMp4(width, height));
    expect(await probeMp4MediaFacts(url, new HttpRequestBudget())).toEqual({
      audioLanguage: "de",
      videoDimensions: { width, height },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it.each(["zero", "multi-video", "mixed-audio", "unsupported-description", "truncated"])(
  "keeps independent or missing facts honest: %s",
  async (kind) => {
    const data = syntheticMp4(
      kind === "zero" ? 0 : 1920,
      1080,
      kind === "mixed-audio" ? ["deu", "fra"] : ["deu"],
      kind === "multi-video" ? 2 : 1
    );
    if (kind === "unsupported-description") data.write("encv", data.indexOf(Buffer.from("avc1")));
    stubRanges(kind === "truncated" ? data.subarray(0, data.length - 1) : data);
    const result = await probeMp4MediaFacts(url, new HttpRequestBudget());
    expect(result.videoDimensions).toEqual(
      kind === "mixed-audio" ? { width: 1920, height: 1080 } : null
    );
    expect(result.audioLanguage).toBe(["mixed-audio", "truncated"].includes(kind) ? null : "de");
  }
);

it.each(["deu", "fra"])(
  "reads %s sound headers across large sample tables without fetching the tables",
  async (code) => {
    const video = largeTrack("vide", "und", 8 * 1024 * 1024);
    const audio = largeTrack("soun", code, 4 * 1024 * 1024);
    const data = atom("moov", Buffer.concat([video, audio]));
    const fetch = stubRanges(data);
    const budget = new HttpRequestBudget();
    expect(await probeMp4AudioLanguage(url, budget)).toBe(code === "deu" ? "de" : "fr");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.map((call) => (call[1].headers as Record<string, string>).Range)
    ).toEqual([
      "bytes=0-1048575",
      `bytes=${8 + video.length - 256}-${8 + video.length - 256 + 1048575}`,
    ]);
    expect(budget.remainingAttempts).toBe(8);
  }
);

it("inspects the further conflicting track in a third window, never accepting the first German tag", async () => {
  const data = atom(
    "moov",
    Buffer.concat([
      largeTrack("vide", "und", 8 * 1024 * 1024),
      largeTrack("soun", "deu", 4 * 1024 * 1024),
      metadata(["fra"]),
    ])
  );
  const fetch = stubRanges(data);
  expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(3);
});

function proofContext(fingerprint: string) {
  return { fingerprint, isCurrent: () => true };
}
function distantTracks(code = "deu") {
  return atom(
    "moov",
    Buffer.concat([largeTrack("vide", "und", 2 * 1024 * 1024), metadata([code])])
  );
}

it.each(["changed", "missing", "weak", "last-modified", "if-range-ignored"])(
  "never combines equally sized assets using an insufficient validator: %s",
  async (kind) => {
    const data = distantTracks();
    let count = 0;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const response = mp4RangeResponse(data, init);
      count++;
      if (kind === "changed" && count === 2) response.headers.set("etag", '"changed-same-size"');
      if (kind === "missing" || kind === "last-modified") response.headers.delete("etag");
      if (kind === "weak") response.headers.set("etag", 'W/"version"');
      if (kind === "last-modified") {
        response.headers.set("last-modified", "Tue, 06 Oct 2026 12:00:00 GMT");
        response.headers.set("date", "Tue, 06 Oct 2026 12:00:05 GMT");
      }
      if (kind === "if-range-ignored" && count === 2) return new Response(data, { status: 200 });
      return response;
    });
    vi.stubGlobal("fetch", fetch);
    expect(await probeMp4MediaFacts(url, new HttpRequestBudget())).toEqual({
      audioLanguage: null,
      videoDimensions: null,
    });
    expect(fetch).toHaveBeenCalledTimes(["changed", "if-range-ignored"].includes(kind) ? 2 : 1);
  }
);

it("revalidates temporal facts with a fresh first range and measures the saved range bytes", async () => {
  const data = distantTracks();
  const fetch = stubRanges(data);
  const context = proofContext("temporal-cache");
  const firstBudget = new HttpRequestBudget();
  const first = await probeMp4MediaFacts(url, firstBudget, true, context);
  expect(first.audioLanguage).toBe("de");
  expect(fetch).toHaveBeenCalledTimes(2);
  const secondBudget = new HttpRequestBudget();
  expect(await probeMp4MediaFacts(url, secondBudget, true, context)).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(secondBudget.remainingAttempts).toBe(9);
  const requestedStarts = fetch.mock.calls.map((call) => new Headers(call[1].headers).get("range"));
  expect(requestedStarts[2]).toBe("bytes=0-1048575");
  // The revalidation saves the final sound-track range, not the required first MiB.
  const finalStart = Number(/^bytes=(\d+)/.exec(requestedStarts[1]!)![1]);
  expect(data.length - finalStart).toBe(68 + 256);
});

it("refreshes a same-size changed asset, rotated URL and changed context without changing source identity", async () => {
  const context = proofContext("rotation-context");
  const first = distantTracks("deu");
  const changed = distantTracks("fra");
  expect(first.length).toBe(changed.length);
  const fetch = stubRanges(first);
  expect(
    (await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context)).audioLanguage
  ).toBe("de");
  fetch.mockImplementation(async (_url, init) => mp4RangeResponse(changed, init));
  expect(
    (await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context)).audioLanguage
  ).toBe("fr");
  expect(fetch).toHaveBeenCalledTimes(4);
  await probeMp4MediaFacts(url + "?token=rotated", new HttpRequestBudget(), true, context);
  await probeMp4MediaFacts(url, new HttpRequestBudget(), true, proofContext("new-credentials"));
  expect(fetch).toHaveBeenCalledTimes(8);
});

it("expires versioned proof and refuses late invalidated settings", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetch = stubRanges(distantTracks());
  const context = proofContext("expiry-context");
  await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context);
  now += 300_001;
  await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context);
  expect(fetch).toHaveBeenCalledTimes(4);
  let current = true;
  fetch.mockImplementation(async (_url, init) => {
    current = false;
    return mp4RangeResponse(distantTracks(), init);
  });
  expect(
    await probeMp4MediaFacts(url, new HttpRequestBudget(), true, {
      fingerprint: "invalidated",
      isCurrent: () => current,
    })
  ).toEqual({ audioLanguage: null, videoDimensions: null });
});

it("coalesces simultaneous probes while independently charging each caller's actual requests", async () => {
  const data = distantTracks();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    await gate;
    return mp4RangeResponse(data, init);
  });
  vi.stubGlobal("fetch", fetch);
  const one = new HttpRequestBudget();
  const two = new HttpRequestBudget();
  const context = proofContext("concurrent-context");
  const first = probeMp4MediaFacts(url, one, true, context);
  const second = probeMp4MediaFacts(url, two, true, context);
  release();
  const [a, b] = await Promise.all([first, second]);
  expect(a.audioLanguage).toBe("de");
  expect(b).toEqual(a);
  expect(b).not.toBe(a);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect([one.remainingAttempts, two.remainingAttempts]).toEqual([8, 8]);
});

it("does not turn weak proof, timeout or Unknown into a definitive cached miss", async () => {
  const context = proofContext("retry-context");
  const data = distantTracks();
  const fetch = stubRanges(data);
  fetch.mockImplementation(async (_url, init) => {
    const response = mp4RangeResponse(data, init);
    response.headers.delete("etag");
    return response;
  });
  expect(
    (await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context)).audioLanguage
  ).toBeNull();
  fetch.mockImplementation(() => new Promise(() => {}));
  await expect(
    probeMp4MediaFacts(url, new HttpRequestBudget(10, 5), true, context)
  ).rejects.toThrow("Provider request deadline exceeded");
  fetch.mockImplementation(async (_url, init) => mp4RangeResponse(data, init));
  expect(
    (await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context)).audioLanguage
  ).toBe("de");
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("does not reuse single-window facts without a strong tag or leak facts across rendition selectors", async () => {
  const data = syntheticMp4();
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const response = mp4RangeResponse(data, init);
    response.headers.delete("etag");
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  const context = proofContext("weak-single-window");
  const one = await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context);
  const two = await probeMp4MediaFacts(url, new HttpRequestBudget(), true, context);
  expect(one.audioLanguage).toBe("de");
  expect(two).toEqual(one);
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockImplementation(async (value, init) =>
    mp4RangeResponse(
      syntheticMp4(1280, 720, value.includes("edition=french") ? ["fra"] : ["deu"]),
      init
    )
  );
  const other = await probeMp4MediaFacts(
    url + "?edition=french",
    new HttpRequestBudget(),
    true,
    context
  );
  expect(other).toEqual({ audioLanguage: "fr", videoDimensions: { width: 1280, height: 720 } });
});

it("rejects a coalesced result exceeding the waiter's attempts or independent deadline", async () => {
  const data = distantTracks();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    await gate;
    return mp4RangeResponse(data, init);
  });
  vi.stubGlobal("fetch", fetch);
  const context = proofContext("caller-budget-bound");
  const first = probeMp4MediaFacts(url, new HttpRequestBudget(), true, context);
  const small = probeMp4MediaFacts(url, new HttpRequestBudget(1), true, context);
  const late = probeMp4MediaFacts(url, new HttpRequestBudget(10, 5), true, context);
  await expect(late).rejects.toThrow("Provider request deadline exceeded");
  release();
  expect((await first).audioLanguage).toBe("de");
  await expect(small).rejects.toThrow("Provider request deadline exceeded");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reads distant track trailers within four windows but refuses a fifth without a partial language", async () => {
  const trailer = atom("trgr", Buffer.alloc(8));
  const withTrailer = (type: string, code: string) => {
    const track = largeTrack(type, code, 2 * 1024 * 1024);
    return atom("trak", Buffer.concat([track.subarray(8), trailer]));
  };
  const data = atom(
    "moov",
    Buffer.concat([withTrailer("vide", "und"), withTrailer("soun", "deu")])
  );
  const fetch = stubRanges(data);
  expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBe("de");
  expect(fetch).toHaveBeenCalledTimes(3);
  const more = atom(
    "moov",
    Buffer.concat([
      withTrailer("vide", "und"),
      withTrailer("soun", "deu"),
      withTrailer("soun", "deu"),
      withTrailer("soun", "deu"),
      metadata(["fra"]),
    ])
  );
  const capped = stubRanges(more);
  expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBeNull();
  expect(capped).toHaveBeenCalledTimes(4);
});

it("revalidates a three-window audio proof with one request and the measured byte reduction", async () => {
  const trailer = atom("trgr", Buffer.alloc(8));
  const tracks = [
    ["vide", "und"],
    ["soun", "deu"],
  ].map(([type, code]) => {
    const track = largeTrack(type, code, 2 * 1024 * 1024);
    return atom("trak", Buffer.concat([track.subarray(8), trailer]));
  });
  const data = atom("moov", Buffer.concat(tracks));
  const fetch = stubRanges(data);
  const context = proofContext("four-window-byte-measurement");
  const first = await probeMp4MediaFacts(url, new HttpRequestBudget(), false, context);
  expect(first.audioLanguage).toBe("de");
  expect(fetch).toHaveBeenCalledTimes(3);
  const firstBytes = fetch.mock.calls.reduce((sum, [, init]) => {
    const from = Number(/^bytes=(\d+)/.exec(new Headers(init.headers).get("range")!)![1]);
    return sum + Math.min(1048576, data.length - from);
  }, 0);
  expect(await probeMp4MediaFacts(url, new HttpRequestBudget(), false, context)).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(firstBytes - 1048576).toBe(1048576 + 256 + trailer.length);
});

it("accepts only the explicit ARD CDN and still verifies all tracks", async () => {
  stubRanges(atom("moov", metadata(["deu"])));
  expect(
    await probeMp4AudioLanguage(
      "https://ctv-videos.daserste.de/synthetic/episode.mp4",
      new HttpRequestBudget()
    )
  ).toBe("de");
  expect(isProbeableMp4("https://ctv-videos.daserste.de.evil.test/episode.mp4")).toBe(false);
});

it.each([
  ["deu", "fra"],
  ["deu", "und"],
  ["deu", "deu"],
])("inspects every reachable audio header (%j)", async (first, last) => {
  const data = atom(
    "moov",
    Buffer.concat([largeTrack("vide", "und", 8 * 1024 * 1024), metadata([first, last])])
  );
  stubRanges(data);
  expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBe(
    first === last ? "de" : null
  );
});

it("refuses child sizes escaping their declared parent even when German text is readable", async () => {
  const data = atom("moov", metadata(["deu"]));
  data.writeUInt32BE(data.length, 24); // hdlr must fit inside mdia, not merely the response.
  stubRanges(data);
  expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBeNull();
});

it.each([0, 1, 2])("checks mdhd version %i on the actual Range path", async (version) => {
  stubRanges(atom("moov", metadata(["deu"], version)));
  expect(await probeMp4AudioLanguage(url, new HttpRequestBudget())).toBe(version < 2 ? "de" : null);
});

it("keeps the deadline through the final language decoding", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const budget = new HttpRequestBudget();
  stubRanges(atom("moov", metadata(["deu"])));
  vi.spyOn(Intl, "Locale").mockImplementation(function () {
    now += 16_000;
    return { language: "de" } as Intl.Locale;
  });
  await expect(probeMp4AudioLanguage(url, budget)).rejects.toThrow(
    "Provider request deadline exceeded"
  );
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
