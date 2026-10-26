import { beforeEach, expect, it, vi } from "vitest";
import { readYoutubeCataloguePage } from "./catalogue";
import { youtubeInput, normalizeYoutubePage } from "@/lib/youtube-catalogue";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/server/ytdlp", () => ({ readYoutubeMetadata: read }));
const channel = { id: "UCaaaaaaaaaaaaaaaaaaaaaa", name: "Synthetic", enabled: true };
const mapping = {
  kind: "series" as const,
  channelId: channel.id,
  sourceId: "PLsynthetic123456",
  name: "Synthetic programme",
  targetId: 42,
  enabled: true,
};
const missing = (id: string) => ({
  id,
  _type: "url",
  ie_key: "Youtube",
  title: null,
  channel_id: null,
  duration: null,
  availability: null,
});
const root = (entries: unknown[]) => ({ id: mapping.sourceId, channel_id: channel.id, entries });
const checks = () => ({ count: 0, known: new Map<string, unknown>() });
const signal = () => new AbortController().signal;
beforeEach(() => read.mockReset());
it("confirms an exact unidentified flat entry rather than inventing its title, uploader or episode", async () => {
  read
    .mockResolvedValueOnce(root([missing("abcdefghijk")]))
    .mockResolvedValueOnce({ id: "abcdefghijk", availability: "unavailable" });
  const raw = await readYoutubeCataloguePage(youtubeInput(mapping.sourceId), 0, signal(), checks());
  expect(normalizeYoutubePage(raw, mapping, channel, 1700000000)).toEqual([
    {
      videoId: "abcdefghijk",
      firstSeenAt: 1700000000,
      channelId: null,
      mappingKey: `${channel.id}/series/${mapping.sourceId}`,
      availability: "unavailable",
      content: null,
    },
  ]);
  expect(read.mock.calls[1][0]).toMatchObject({
    id: "abcdefghijk",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
  });
  expect(read.mock.calls[1][3]).toBe(true);
});
it("does not retry missing normal fields or accept a changed video/uploader from the confirmation", async () => {
  const normal = { id: "abcdefghijk", title: "Normal title", duration: 120 };
  read.mockResolvedValueOnce(root([normal]));
  const raw = await readYoutubeCataloguePage(youtubeInput(mapping.sourceId), 0, signal(), checks());
  expect(() => normalizeYoutubePage(raw, mapping, channel, 1700000000)).toThrow();
  expect(read).toHaveBeenCalledTimes(1);
  read
    .mockResolvedValueOnce(root([missing("abcdefghijk")]))
    .mockResolvedValueOnce({ id: "zyxwvutsrqp", availability: "unavailable" });
  await expect(
    readYoutubeCataloguePage(youtubeInput(mapping.sourceId), 0, signal(), checks())
  ).rejects.toThrow();
  read.mockResolvedValueOnce(root([missing("abcdefghijk")])).mockResolvedValueOnce({
    id: "abcdefghijk",
    channel_id: "UCbbbbbbbbbbbbbbbbbbbbbb",
    title: "Other programme",
  });
  const foreign = await readYoutubeCataloguePage(
    youtubeInput(mapping.sourceId),
    0,
    signal(),
    checks()
  );
  expect(() => normalizeYoutubePage(foreign, mapping, channel, 1700000000)).toThrow();
});
it("reuses only this scan's exact confirmation and keeps duplicate playlist IDs visible to validation", async () => {
  const context = checks();
  read
    .mockResolvedValueOnce(root([missing("abcdefghijk"), missing("abcdefghijk")]))
    .mockResolvedValueOnce({ id: "abcdefghijk", availability: "unavailable" });
  const raw = await readYoutubeCataloguePage(youtubeInput(mapping.sourceId), 0, signal(), context);
  expect((raw as { entries: unknown[] }).entries).toHaveLength(2);
  expect(context.count).toBe(1);
  expect(read).toHaveBeenCalledTimes(2);
});
it("limits supplementary checks instead of skipping unresolved entries or looping on failures", async () => {
  read.mockResolvedValueOnce(
    root(Array.from({ length: 11 }, (_, i) => missing(String(i).padStart(11, "0"))))
  );
  for (let i = 0; i < 10; i++)
    read.mockResolvedValueOnce({ id: String(i).padStart(11, "0"), availability: "unavailable" });
  await expect(
    readYoutubeCataloguePage(youtubeInput(mapping.sourceId), 0, signal(), checks())
  ).rejects.toMatchObject({ reason: "detail_limit" });
  expect(read).toHaveBeenCalledTimes(11);
  read
    .mockReset()
    .mockResolvedValueOnce(root([missing("abcdefghijk")]))
    .mockRejectedValueOnce(Error("Synthetic transport failure"));
  await expect(
    readYoutubeCataloguePage(youtubeInput(mapping.sourceId), 0, signal(), checks())
  ).rejects.toThrow("Synthetic transport failure");
  expect(read).toHaveBeenCalledTimes(2);
});
it("preserves an unavailable registered movie without fabricating a current uploader", async () => {
  const movie = { ...mapping, kind: "movie" as const, sourceId: "abcdefghijk" };
  read.mockResolvedValueOnce({ id: movie.sourceId, availability: "unavailable" });
  const raw = await readYoutubeCataloguePage(youtubeInput(movie.sourceId), 0, signal(), checks());
  expect(normalizeYoutubePage(raw, movie, channel, 1700000000)[0]).toMatchObject({
    videoId: movie.sourceId,
    availability: "unavailable",
    channelId: null,
    content: null,
  });
  expect(() =>
    normalizeYoutubePage(
      { id: movie.sourceId, availability: "unavailable", channel_id: "UCbbbbbbbbbbbbbbbbbbbbbb" },
      movie,
      channel,
      1700000000
    )
  ).toThrow();
});
