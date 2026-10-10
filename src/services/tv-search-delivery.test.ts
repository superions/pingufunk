import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TvSearchDeliveryJournal } from "./tv-search-delivery";
import { SourceMediaFactsStore } from "./source-media-facts";
import { syntheticMp4, mp4RangeResponse } from "@/lib/__fixtures__/mp4";
import type { MatchedEpisodeInfo, TvdbData } from "@/types";

vi.mock("@/lib/db", () => ({ prisma: { config: {} } }));
const scope = "a".repeat(64);
const url = (id = 1) => `https://rodlzdf-a.akamaihd.net/synthetic/delivery-${id}.mp4`;
const show = (count = 1): TvdbData => ({
  id: 123,
  name: "Synthetic Series",
  germanName: null,
  aliases: [],
  episodes: [],
  sonarrMonitoredCoordinates: Array.from({ length: count }, (_, i) => `1:${i + 1}`),
});
function match(id = 1): MatchedEpisodeInfo {
  return {
    tvdbId: 123,
    showName: "Synthetic Series",
    episode: { name: `Episode ${id}`, seasonNumber: 1, episodeNumber: id },
    item: {
      channel: "ZDF",
      topic: "Synthetic Series",
      title: `Episode ${id} (S01E${String(id).padStart(2, "0")})`,
      description: "Synthetic",
      duration: 600,
      size: 0,
      filmlisteTimestamp: 1,
      url_website: "https://example.invalid/synthetic",
      url_video_hd: url(id),
      url_video: "",
      url_video_low: "",
    },
  } as MatchedEpisodeInfo;
}
let persisted: string | null, journal: TvSearchDeliveryJournal, facts: SourceMediaFactsStore;
const write = vi.fn(async (value: string) => {
  persisted = value;
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const response = mp4RangeResponse(syntheticMp4(), init);
      response.headers.set("etag", '"synthetic"');
      return response;
    })
  );
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
  persisted = null;
  write.mockClear();
  facts = new SourceMediaFactsStore();
  journal = new TvSearchDeliveryJournal({ read: async () => persisted, write }, facts);
});
afterEach(async () => {
  journal.dispose();
  facts.clear();
  await facts.idle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("persists bounded discovery, not media facts; first readiness and identity do not move on repeated searches", async () => {
  await journal.register(scope, show(), [match()]);
  const first = (await journal.current(scope))[0];
  expect(first.readyAt).toBeNull();
  expect(persisted).not.toContain("fingerprint");
  facts.remember(url(), {
    facts: { audioLanguage: "de", videoDimensions: { width: 1920, height: 1080 } },
    fingerprint: "b".repeat(64),
  });
  await journal.idle();
  const ready = (await journal.current(scope))[0];
  expect(ready.readyAt).toBe(Date.now());
  await vi.advanceTimersByTimeAsync(1000);
  const changed = match();
  changed.item.description = "Changed listing";
  changed.item.filmlisteTimestamp = 999;
  await journal.register(scope, show(), [changed]);
  expect(await journal.current(scope)).toEqual([ready]);
  expect(ready.expiresAt).toBe(first.createdAt + 7_200_000);
});

it("recovers discovery after a cold restart but obtains fresh range proof instead of trusting persisted readiness", async () => {
  await journal.register(scope, show(), [match()]);
  journal.dispose();
  facts.clear();
  await facts.idle();
  facts = new SourceMediaFactsStore();
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const response = mp4RangeResponse(syntheticMp4(), init);
    response.headers.set("etag", '"synthetic"');
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  journal = new TvSearchDeliveryJournal({ read: async () => persisted, write }, facts);
  expect((await journal.current(scope))[0].readyAt).toBeNull();
  await vi.advanceTimersByTimeAsync(30);
  await facts.idle();
  await journal.idle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await journal.current(scope))[0].readyAt).toBe(Date.now() - 5);
  expect(facts.get(url())?.facts.audioLanguage).toBe("de");
  expect(await journal.current("c".repeat(64))).toEqual([]);
});

it("rejects conflicting source coordinates and ignores unmonitored/runtime-conflicting discoveries", async () => {
  await journal.register(scope, show(2), [match()]);
  const conflict = match(2);
  conflict.item.url_video_hd = url();
  await expect(journal.register(scope, show(2), [conflict])).rejects.toThrow();
  const runtime = match(2);
  runtime.runtimeConflict = true;
  await journal.register(scope, show(), [match(3), runtime]);
  expect(await journal.current(scope)).toHaveLength(1);
});

it("bounds capacity and expiry; imported entries release only their own refresh work", async () => {
  await expect(
    journal.register(
      scope,
      show(129),
      Array.from({ length: 129 }, (_, i) => match(i + 1))
    )
  ).rejects.toThrow();
  expect(persisted).toBeNull();
  await journal.register(scope, show(), [match()]);
  const [entry] = await journal.current(scope);
  const release = vi.spyOn(facts, "release");
  await journal.remove([entry.id]);
  expect(await journal.current(scope)).toEqual([]);
  expect(release).toHaveBeenCalledWith(expect.arrayContaining([url()]));
  await journal.register(scope, show(), [match()]);
  await vi.advanceTimersByTimeAsync(7_200_001);
  expect(await journal.current(scope)).toEqual([]);
});

it("fails closed persistently after a write failure and rejects corrupt journals on every read", async () => {
  write.mockRejectedValueOnce(new Error("private DB detail"));
  await expect(journal.register(scope, show(), [match()])).rejects.toThrow(
    "Optional episode metadata unavailable"
  );
  await expect(journal.current(scope)).rejects.toThrow();
  journal.dispose();
  facts.clear();
  persisted = JSON.stringify({ version: 1, entries: [{ invalid: true }] });
  journal = new TvSearchDeliveryJournal({ read: async () => persisted, write }, facts);
  await expect(journal.current(scope)).rejects.toThrow();
  await expect(journal.current(scope)).rejects.toThrow();
});

it("does not re-probe a failed source automatically or persist its exception", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("private source detail");
  });
  vi.stubGlobal("fetch", fetch);
  await journal.register(scope, show(), [match()]);
  await vi.advanceTimersByTimeAsync(30);
  await facts.idle();
  await journal.idle();
  expect((await journal.current(scope))[0].blockedUrls).toEqual([url()]);
  expect(persisted).not.toContain("private source detail");
  await journal.register(scope, show(), [match()]);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("persists each eligible release's first announcement across restarts without extending retention", async () => {
  await journal.register(scope, show(), [match()]);
  const [entry] = await journal.current(scope);
  const sd = [{ entryId: entry.id, guid: "synthetic-sd" }];
  const first = await journal.announce(scope, sd);
  await vi.advanceTimersByTimeAsync(1000);
  journal.dispose();
  journal = new TvSearchDeliveryJournal({ read: async () => persisted, write }, facts);
  expect(await journal.announce(scope, sd)).toEqual(first);
  const hd = await journal.announce(scope, [{ entryId: entry.id, guid: "synthetic-hd" }]);
  expect(hd.get("synthetic-hd")).toBe(Date.now());
  expect(hd.get("synthetic-hd")).toBeGreaterThan(first.get("synthetic-sd")!);
  expect((await journal.current(scope))[0].expiresAt).toBe(entry.expiresAt);
  expect(persisted).not.toContain("synthetic-hd"); // Persist hashes, never proofs or ACKs.
});

it("rejects an overflowing announcement batch atomically and fails closed on publication write failure", async () => {
  await journal.register(scope, show(), [match()]);
  const [entry] = await journal.current(scope);
  const before = persisted;
  await expect(
    journal.announce(
      scope,
      Array.from({ length: 7 }, (_, i) => ({ entryId: entry.id, guid: `synthetic-${i}` }))
    )
  ).rejects.toThrow();
  expect(persisted).toBe(before);
  expect((await journal.current(scope))[0].announcements).toEqual([]);
  write.mockRejectedValueOnce(new Error("private DB detail"));
  await expect(
    journal.announce(scope, [{ entryId: entry.id, guid: "synthetic-hd" }])
  ).rejects.toThrow();
  await expect(journal.current(scope)).rejects.toThrow();
  expect(persisted).toBe(before);
});

it("rejects persisted announcement dates outside discovery retention", async () => {
  await journal.register(scope, show(), [match()]);
  const [entry] = await journal.current(scope);
  journal.dispose();
  persisted = JSON.stringify({
    version: 1,
    entries: [{ ...entry, announcements: [{ release: "b".repeat(64), at: entry.expiresAt }] }],
  });
  journal = new TvSearchDeliveryJournal({ read: async () => persisted, write }, facts);
  await expect(journal.current(scope)).rejects.toThrow();
});
