import { expect, it } from "vitest";
import seedData from "../../data/youtube-sources.json";
import {
  youtubeInput,
  youtubeRegistrySchema,
  mergeYoutubeRegistry,
  confirmedYoutubeSave,
  changeYoutubeTarget,
  normalizeYoutubePage,
  normalizeYoutubeInspection,
  type YoutubeSnapshot,
} from "./youtube-catalogue";

const seed = youtubeRegistrySchema.parse(seedData);
it("clears source-specific title exceptions when a programme ID changes, preserving same-ID edits", () => {
  const mapping = seed.programMappings[0];
  expect(changeYoutubeTarget(mapping, mapping.targetId)).toEqual(mapping);
  expect(changeYoutubeTarget(mapping, 42)).toMatchObject({
    targetId: 42,
    sourceNumbering: "canonical",
    episodeTitleAliases: [],
  });
});
it("projects only declared catalogue fields and keeps upload day separate from first discovery", () => {
  const channel = seed.channels[0],
    mapping = seed.programMappings[0];
  const root = {
    id: mapping.sourceId,
    channel_id: channel.id,
    entries: [
      {
        id: "abcdefghijk",
        channel_id: channel.id,
        title: "Programme: Actual title",
        duration: 120,
        upload_date: "20260228",
        audioLanguage: "German",
        season_number: 1,
        episode_number: 9,
        url: "https://unsafe.invalid/media",
        formats: [{ secret: "not copied" }],
      },
    ],
  };
  const [row] = normalizeYoutubePage(root, mapping, channel, 1700000000);
  expect(row.content).toEqual({
    channel: channel.name,
    topic: mapping.name,
    title: "Programme: Actual title",
    description: "",
    duration: 120,
    size: 0,
    filmlisteTimestamp: 1700000000,
    url_website: "https://www.youtube.com/watch?v=abcdefghijk",
    url_video: "",
    url_video_hd: "",
    url_video_low: "",
    contentDates: { providerDay: "2026-02-28", catalogueUpdatedAt: 1700000000 },
  });
  expect(JSON.stringify(row)).not.toMatch(/unsafe|secret|audioLanguage|episode_number/);
  expect(() =>
    normalizeYoutubeInspection(
      { channel_id: channel.id, channel: "Synthetic", id: "wrong" },
      youtubeInput(mapping.sourceId)
    )
  ).toThrow();
});
it("preserves explicit unavailable placeholders without assigning an ID or episode by position", () => {
  const channel = seed.channels[0],
    mapping = seed.programMappings[0];
  expect(
    normalizeYoutubePage(
      { id: mapping.sourceId, channel_id: channel.id, entries: [{ availability: "private" }] },
      mapping,
      channel,
      1700000000
    )
  ).toEqual([
    {
      videoId: null,
      channelId: null,
      mappingKey: `${channel.id}/series/${mapping.sourceId}`,
      availability: "unavailable",
      content: null,
    },
  ]);
  for (const entry of [
    { title: "Normal video", channel_id: channel.id },
    { id: "abcdefghijk", title: "Normal video" },
    { id: "abcdefghijk", title: "Foreign video", channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa" },
    { availability: "private", channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa" },
    null,
  ])
    expect(() =>
      normalizeYoutubePage(
        { id: mapping.sourceId, channel_id: channel.id, entries: [entry] },
        mapping,
        channel,
        1700000000
      )
    ).toThrow();
});
it("rejects capacity overflow rather than evicting unrelated channels or mappings", () => {
  const channels = Array.from({ length: 65 }, (_, i) => ({
    id: `UC${String(i).padStart(22, "0")}`,
    name: "Synthetic",
    enabled: false,
  }));
  expect(
    youtubeRegistrySchema.safeParse({ version: 1, channels, programMappings: [] }).success
  ).toBe(false);
  const programMappings = Array.from({ length: 257 }, (_, i) => ({
    ...seed.programMappings[0],
    sourceId: `PL${String(i).padStart(12, "0")}`,
  }));
  expect(youtubeRegistrySchema.safeParse({ ...seed, programMappings }).success).toBe(false);
});
it("ships five verified inactive channel identities and the explicit Kommissar mapping", () => {
  expect(seed.channels).toHaveLength(5);
  expect(seed.channels.every((channel) => !channel.enabled)).toBe(true);
  expect(seed.programMappings).toEqual([
    {
      kind: "series",
      channelId: "UCNMj6SRjtvagiUBKYoqsW_w",
      sourceId: "PL_H50xx0qoB_bynOI7Esvpfj6EhvxOFS5",
      name: "Der Kommissar",
      targetId: 133771,
      enabled: false,
      sourceNumbering: "publisher",
      targetOrder: "aired",
      episodeTitleAliases: [
        { source: "Noch zehn Minuten zu leben", canonical: "Noch 10 Minuten zu leben" },
      ],
    },
  ]);
});
it("preserves local corrections and disable across seed upgrades without activating new presets", () => {
  const local = structuredClone(seed);
  local.channels[0].name = "Lokaler Name";
  local.channels[0].enabled = false;
  local.programMappings[0].targetId = 42;
  const upgrade = structuredClone(seed);
  upgrade.channels[0].enabled = true;
  upgrade.channels.push({ id: "UCaaaaaaaaaaaaaaaaaaaaaa", name: "Neue Vorgabe", enabled: true });
  const merged = mergeYoutubeRegistry(upgrade, local);
  expect(merged.channels[0]).toEqual(local.channels[0]);
  expect(merged.channels.at(-1)?.enabled).toBe(false);
  expect(merged.programMappings[0].targetId).toBe(42);
});
it.each([
  "https://www.youtube.com/@KultKrimi",
  "https://www.youtube.com/channel/UCNMj6SRjtvagiUBKYoqsW_w",
  "https://www.youtube.com/playlist?list=PL_H50xx0qoB_bynOI7Esvpfj6EhvxOFS5",
  "https://youtu.be/abcdefghijk",
])("canonicalizes an explicit source input %s", (value) => {
  expect(youtubeInput(value).url).toMatch(/^https:\/\/www\.youtube\.com\//);
});
it.each([
  "http://youtube.com/@KultKrimi",
  "https://youtube.com.evil.invalid/@KultKrimi",
  "https://user:secret@youtube.com/@KultKrimi",
  "https://youtube.com:4430/@KultKrimi",
  "https://youtube.com/@KultKrimi#other",
  "https://youtube.com/watch?v=abcdefghijk&list=PLabcdefghij",
  "https://youtube.com/watch?v=abcdefghijk&v=ABCDEFGHIJK",
  "https://youtube.com/redirect?q=https://evil.invalid",
  "file:///tmp/video",
  "--exec echo test",
  "https://youtube.com/@KultKrimi?x=y",
  "https://youtu.be/abcdefghijk?si=extra",
  "https://youtube.com/channel/UCmissing",
  "https://youtube.com/@Kult Krimi",
])("rejects ambiguous/foreign input before I/O: %s", (value) =>
  expect(() => youtubeInput(value)).toThrow()
);
it("rejects duplicate keys, dangling channels, malformed IDs and uncontrolled payload fields", () => {
  for (const mutation of [
    { ...seed, channels: [...seed.channels, seed.channels[0]] },
    { ...seed, programMappings: [...seed.programMappings, seed.programMappings[0]] },
    { ...seed, channels: seed.channels.slice(1) },
    { ...seed, programMappings: [{ ...seed.programMappings[0], targetId: 0 }] },
    { ...seed, raw: { secret: "not accepted" } },
  ])
    expect(youtubeRegistrySchema.safeParse(mutation).success).toBe(false);
});
it("confirms normalized durable rows and blocks missing, stale or partial acknowledgements", () => {
  const submitted = {
    action: "save" as const,
    revision: "a".repeat(64),
    registry: seed,
    enabled: false,
  };
  const snapshot: YoutubeSnapshot = {
    revision: "b".repeat(64),
    enabled: false,
    registry: seed,
    scan: { state: "idle", completedMappings: 0, batches: 0, entries: 0, message: "" },
    lastCompleteAt: null,
    nextRefreshAt: null,
    indexCurrent: false,
    presetChannelIds: seed.channels.map((row) => row.id),
    presetMappingKeys: [],
  };
  expect(confirmedYoutubeSave({ success: true, snapshot }, submitted)).toEqual(snapshot);
  for (const reply of [
    { success: true },
    { success: true, snapshot: { ...snapshot, enabled: true } },
    { success: true, snapshot: { ...snapshot, revision: submitted.revision } },
    { success: true, snapshot: { ...snapshot, registry: { ...seed, channels: [] } } },
    { success: true, snapshot: { ...snapshot, scan: { state: "invented" } } },
  ])
    expect(() => confirmedYoutubeSave(reply, submitted)).toThrow();
});
