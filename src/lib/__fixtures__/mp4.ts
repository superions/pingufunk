/** Synthetic ISO-BMFF metadata; no real catalogue rows, URLs or media bytes. */
export function mp4Box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}

export function syntheticMp4(width = 1920, height = 1080, codes = ["deu"], videoCount = 1): Buffer {
  const handler = (type: string) => {
    const data = Buffer.alloc(12);
    data.write(type, 8);
    return mp4Box("hdlr", data);
  };
  const sample = Buffer.alloc(78);
  sample.writeUInt16BE(1, 6);
  sample.writeUInt16BE(width, 24);
  sample.writeUInt16BE(height, 26);
  const description = Buffer.alloc(8);
  description.writeUInt32BE(1, 4);
  const video = mp4Box(
    "trak",
    mp4Box(
      "mdia",
      Buffer.concat([
        handler("vide"),
        mp4Box(
          "minf",
          mp4Box("stbl", mp4Box("stsd", Buffer.concat([description, mp4Box("avc1", sample)])))
        ),
      ])
    )
  );
  const audio = codes.map((code) => {
    const mdhd = Buffer.alloc(24);
    mdhd.writeUInt16BE(
      [...code].reduce((value, letter) => (value << 5) | (letter.charCodeAt(0) - 96), 0),
      20
    );
    return mp4Box("trak", mp4Box("mdia", Buffer.concat([handler("soun"), mp4Box("mdhd", mdhd)])));
  });
  return mp4Box(
    "moov",
    Buffer.concat([...Array.from({ length: videoCount }, () => video), ...audio])
  );
}

export function mp4RangeResponse(data: Buffer, init: RequestInit): Response {
  const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get("range") ?? "");
  if (!range) throw new Error("Expected bounded Range request");
  const start = Number(range[1]),
    end = Math.min(Number(range[2]), data.length - 1);
  return new Response(new Uint8Array(data.subarray(start, end + 1)), {
    status: 206,
    headers: { "content-range": `bytes ${start}-${end}/${data.length}` },
  });
}
