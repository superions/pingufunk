import { beforeEach, expect, it, vi } from "vitest";
import type { ApiResultItem, TvdbData } from "@/types";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  create: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  queryContent: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    generatedRuleset: {
      create: state.create,
      findUnique: state.findUnique,
      findFirst: state.findFirst,
      findMany: async () => [...state.rows.values()],
    },
  },
}));
vi.mock("./content-search", () => ({ queryContent: state.queryContent }));
import {
  generateRulesetForShow,
  getGeneratedRulesetByTopic,
  getGeneratedRulesets,
} from "./ruleset-generator";

const topic = "Fernsehfilme und Serien - Serien";
const show = (id: number): TvdbData => ({
  id,
  name: `Series ${id}`,
  germanName: null,
  aliases: [],
  episodes: [],
});
const item = (id: number): ApiResultItem => ({
  topic,
  title: `Series ${id} (S01/E01)`,
  channel: "ARTE",
  description: "",
  duration: 2700,
  size: 0,
  filmlisteTimestamp: 0,
  url_website: "",
  url_video: "",
  url_video_low: "",
  url_video_hd: "",
});
beforeEach(() => {
  vi.clearAllMocks();
  state.rows.clear();
  state.findFirst.mockImplementation(
    async ({ where }) => [...state.rows.values()].find((row) => row.tvdbId === where.tvdbId) ?? null
  );
  state.findUnique.mockImplementation(
    async ({ where }) =>
      state.rows.get(`${where.tvdbId_topic.tvdbId}/${where.tvdbId_topic.topic}`) ?? null
  );
  state.create.mockImplementation(async ({ data }) => {
    const row = { id: `0000000${data.tvdbId}-synthetic`, ...data };
    state.rows.set(`${data.tvdbId}/${data.topic}`, row);
    return row;
  });
  state.queryContent.mockImplementation(async (queries) =>
    queries[0].query === "Series 7" ? [item(7), item(8)] : [item(8), item(7)]
  );
});
it("generates and reads two series in the same topic without replacing IDs or filters", async () => {
  const first = await generateRulesetForShow(7, show(7));
  const second = await generateRulesetForShow(8, show(8));
  expect(first?.media.media_tvdbId).toBe(7);
  expect(second?.media.media_tvdbId).toBe(8);
  expect(first?.topic).toBe(topic);
  expect(second?.topic).toBe(topic);
  expect(await getGeneratedRulesetByTopic(topic, 7)).toEqual(first);
  expect(await getGeneratedRulesetByTopic(topic, 8)).toEqual(second);
  expect(await getGeneratedRulesetByTopic(topic, 9)).toBeNull();
  expect(await getGeneratedRulesets()).toHaveLength(2);
  expect(await generateRulesetForShow(7, show(7))).toEqual(first);
  expect(state.create).toHaveBeenCalledTimes(2);
});
it("returns only the same identity's concurrent winner", async () => {
  state.create.mockImplementationOnce(async ({ data }) => {
    state.rows.set(`${data.tvdbId}/${data.topic}`, { id: "winner", ...data });
    throw { code: "P2002" };
  });
  expect((await generateRulesetForShow(7, show(7)))?.media.media_tvdbId).toBe(7);
  expect(state.findUnique.mock.calls.at(-1)?.[0]).toEqual({
    where: { tvdbId_topic: { tvdbId: 7, topic } },
  });
});
it("does not publish a requested ID when its metadata belongs to another series", async () => {
  expect(await generateRulesetForShow(7, show(8))).toBeNull();
  expect(state.queryContent).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
});
