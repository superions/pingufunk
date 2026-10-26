#!/usr/bin/env node
// Synthetic metadata executable for the owned, externally blocked Arr harness only.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
if (
  process.env.PINGUFUNK_ARR_QA_YOUTUBE !== "1" ||
  !/^\d+-\d+$/.test(process.env.PINGUFUNK_MEDIA_QA_OWNER ?? "")
)
  throw Error("Owned synthetic YouTube runtime required");
const args = process.argv.slice(2);
if (
  !args.includes("--simulate") ||
  !args.includes("--skip-download") ||
  !args.includes("--ignore-config") ||
  args[args.indexOf("--extractor-retries") + 1] !== "0" ||
  !args.includes("--no-remote-components") ||
  !args.includes("--js-runtimes")
)
  throw Error("Bounded metadata-only arguments required");
const url = new URL(args.at(-1));
const channel = "UCaaaaaaaaaaaaaaaaaaaaaa",
  playlist = "PLsynthetic123456";
const entries = Array.from({ length: 4 }, (_, i) => ({
  id: String(i).padStart(11, "0"),
  channel_id: channel,
  title: `Synthetic Series, Staffel 9, Folge ${i + 1}: Synthetic Episode ${Math.floor(i / 2) + 1}-${(i % 2) + 1}`,
  duration: 60,
}));
entries.push({ ...entries[0], id: "00000000004" });
entries.push({ id: "private0000", availability: "private" });
if (args.includes("--flat-playlist") && url.searchParams.has("list")) {
  if (url.searchParams.get("list") !== playlist) throw Error("Owned playlist required");
  process.stdout.write(
    JSON.stringify({
      id: playlist,
      channel_id: channel,
      channel: "Synthetic channel",
      title: "Synthetic Series",
      entries,
    })
  );
} else {
  const id = url.searchParams.get("v");
  if (!/^0000000000[0-5]$/.test(id ?? "")) throw Error("Owned video required");
  const stats = `/qa/youtube-metadata-${id}.json`;
  const count = existsSync(stats) ? JSON.parse(readFileSync(stats, "utf8")).count : 0;
  writeFileSync(stats, JSON.stringify({ count: count + 1 }));
  await delay(1000);
  const expires = id === "00000000004" ? 1 : Math.floor(Date.now() / 1000) + 600;
  const address = (stream, format) =>
    `https://rr1.synthetic.googlevideo.com/videoplayback?expire=${expires}&id=${id}&stream=${stream}&format=${format}&sig=${count}`;
  process.stdout.write(
    JSON.stringify({
      id,
      title: id === "00000000005" ? "Synthetic Media (2024)" : entries[Number(id)].title,
      channel_id: channel,
      duration: 60,
      is_live: false,
      availability: "public",
      formats: [
        {
          format_id: "313",
          url: address("video", "313"),
          protocol: "https",
          vcodec: "vp9",
          acodec: "none",
          width: 3840,
          height: 2160,
        },
        {
          format_id: "137",
          url: address("video", "137"),
          protocol: "https",
          vcodec: "avc1",
          acodec: "none",
          width: 1920,
          height: 1080,
          audio_channels: null,
          abr: null,
        },
        {
          format_id: "136",
          url: address("video", "136"),
          protocol: "https",
          vcodec: "avc1",
          acodec: "none",
          width: 1280,
          height: 720,
          audio_channels: null,
          abr: null,
        },
        {
          format_id: "140",
          url: address("audio", "140"),
          protocol: "https",
          vcodec: "none",
          acodec: "mp4a",
          language: "deu",
          audio_channels: 2,
          abr: 128,
          width: null,
          height: null,
          fps: null,
        },
        {
          format_id: "sb0",
          url: "https://example.invalid/storyboard",
          protocol: "mhtml",
          vcodec: "images",
          acodec: null,
          width: 160,
          height: 90,
          audio_channels: null,
        },
      ],
    })
  );
}
