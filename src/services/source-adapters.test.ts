import { beforeEach, expect, it, vi } from "vitest";
import { mediathekSearchAdapter } from "@/providers/mediathek/search";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { contentProviderForItem, queryContentWindow, searchCacheContext } from "./content-search";
import type { ApiResultItem } from "@/types";
import type { SearchProviderId } from "@/types/provider";

const { settings } = vi.hoisted(() => ({ settings: new Map<string, string>() }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const item: ApiResultItem = {
  channel: "Synthetic",
  topic: "Example",
  title: "Episode",
  description: "",
  filmlisteTimestamp: 1,
  duration: 120,
  size: 4,
  url_video: "https://example.invalid/a.mp4",
  url_video_hd: "",
  url_video_low: "",
  url_website: "",
};
beforeEach(() => {
  vi.restoreAllMocks();
  settings.clear();
});

it("uses an interchangeable source contract without fetching or classifying URLs in the coordinator", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
  const coverage = {
    complete: true,
    candidateWindowLimited: false,
    sources: [{ providerId: "orf" as const, state: "complete" as const, candidateCount: 1 }],
  };
  const search = vi
    .spyOn(mediathekSearchAdapter, "searchWindow")
    .mockResolvedValue({ items: [item], coverage });
  const budget = new HttpRequestBudget();
  const queries = [{ fields: ["title"], query: "Example" }];
  expect(
    await queryContentWindow(
      queries,
      50,
      { requestBudget: budget, deferLanguageSelection: true },
      "orf"
    )
  ).toEqual({ items: [item], coverage });
  expect(search).toHaveBeenCalledWith(
    queries,
    50,
    { requestBudget: budget, deferLanguageSelection: true, deadlineAt: budget.deadlineAt },
    false,
    "orf"
  );
  const classifier = vi.spyOn(mediathekSearchAdapter, "providerForItem").mockReturnValue("orf");
  expect(contentProviderForItem(item)).toBe("orf");
  expect(classifier).toHaveBeenCalledWith(item);
  expect(fetch).not.toHaveBeenCalled();
});

it("includes source-owned configuration in cache invalidation", async () => {
  const baseline = await searchCacheContext();
  settings.set("provider.orf.enabled", "true");
  expect(await searchCacheContext()).not.toBe(baseline);
});

it("rejects an unknown source scope before any source I/O", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
  await expect(
    mediathekSearchAdapter.searchWindow([], 10, {}, false, [
      "unregistered",
    ] as unknown as SearchProviderId)
  ).rejects.toThrow("Unknown content source");
  expect(fetch).not.toHaveBeenCalled();
});
