import { describe, expect, it } from "vitest";
import { hasSharedTopicSeriesEvidence } from "./ruleset-identity";
import type { ApiResultItem, TvdbData } from "@/types";

const show: TvdbData = {
  id: 123,
  name: "Synthetic series",
  germanName: "Beispielserie",
  aliases: [{ language: "deu", name: "Die Beispielserie" }],
  episodes: [],
};
function item(title: string, topic = "Fernsehfilme und Serien - Serien"): ApiResultItem {
  return {
    channel: "ARTE",
    topic,
    title,
    description: "",
    duration: 3600,
    size: 0,
    filmlisteTimestamp: 0,
    url_website: "",
    url_video: "",
    url_video_low: "",
    url_video_hd: "",
  };
}
describe("shared catalogue series identity", () => {
  it.each([
    "Synthetic series - Staffel 2 (1/6)",
    "Beispielserie: Staffel 2 (1/6)",
    "Die Beispielserie (1/6)",
  ])("accepts verified name/alias %s", (title) => {
    expect(hasSharedTopicSeriesEvidence(item(title), show)).toBe(true);
  });
  it.each([
    "Foreign series - Staffel 2 (1/6)",
    "Synthetic series sequel - Staffel 2 (1/6)",
    "Staffel 2 (1/6)",
    "Report about Synthetic series",
  ])("rejects coordinates and incidental title %s", (title) => {
    expect(hasSharedTopicSeriesEvidence(item(title), show)).toBe(false);
  });
  it("does not weaken ordinary series-owned rules", () => {
    expect(hasSharedTopicSeriesEvidence(item("Episode title", "Series-owned topic"), show)).toBe(
      true
    );
  });
});
