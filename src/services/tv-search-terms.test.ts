import { afterEach, expect, it, vi } from "vitest";
import type { TvdbData } from "@/types";
const state = vi.hoisted(() => ({ topics: [] as string[], ambiguous: false }));
vi.mock("./rulesets", () => ({
  getAllTopics: () => state.topics,
  getRulesetsForTopicAndTvdbId: (topic: string, id: number) =>
    topic === "Lokales Polizeirevier" && id === 123 ? [{}] : [],
  getRulesetsForTopic: (topic: string) => [
    { media: { media_tvdbId: topic === "Lokales Polizeirevier" ? 123 : 999 } },
    ...(state.ambiguous ? [{ media: { media_tvdbId: 999 } }] : []),
  ],
}));
import { tvSearchQueries, verifiedRuleTopics } from "./tv-search-terms";
const show: TvdbData = {
  id: 123,
  name: "Synthetic precinct (2026)",
  germanName: null,
  aliases: [{ name: "Synthetisches Revier", language: "de" }],
  episodes: [],
};
afterEach(() => {
  state.topics = [];
  state.ambiguous = false;
});
it("does not promote topics shared by rules for multiple series to identity", () => {
  state.topics = ["Lokales Polizeirevier"];
  state.ambiguous = true;
  expect(verifiedRuleTopics(show)).toEqual([]);
  expect(tvSearchQueries(show).some((query) => query.query === "Lokales Polizeirevier")).toBe(
    false
  );
});
it("retrieves bound topics and aliases as OR alternatives without trusting the query as identity", () => {
  state.topics = ["Foreign series", "Fernsehfilme und Serien - Serien", "Lokales Polizeirevier"];
  const queries = tvSearchQueries(show, "User-provided search", "TBA");
  expect(queries).toContainEqual({ fields: ["topic"], query: "Lokales Polizeirevier" });
  expect(queries).toContainEqual({ fields: ["topic", "title"], query: "Synthetisches Revier" });
  expect(queries).toContainEqual({ fields: ["topic", "title"], query: "Synthetic precinct" });
  expect(
    queries.some((q) =>
      ["TBA", "Foreign series", "Fernsehfilme und Serien - Serien"].includes(q.query)
    )
  ).toBe(false);
  expect(show.aliases).toHaveLength(1);
});
it("deduplicates identical names/topics before its finite six-query cap", () => {
  state.topics = ["Lokales Polizeirevier"];
  const queries = tvSearchQueries({
    ...show,
    name: "Lokales Polizeirevier",
    germanName: "Lokales Polizeirevier",
    aliases: Array.from({ length: 100 }, (_, n) => ({ name: `Alias ${n}`, language: "und" })),
  });
  expect(queries).toHaveLength(6);
  expect(queries.filter((q) => q.query === "Lokales Polizeirevier")).toHaveLength(1);
});
