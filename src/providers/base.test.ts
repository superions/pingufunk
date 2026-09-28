import { describe, expect, it } from "vitest";
import { BaseProvider } from "./base";
import type {
  ProviderCapabilities,
  ProviderContentItem,
  ProviderSearchQuery,
} from "@/types/provider";

class FixtureProvider extends BaseProvider {
  readonly id = "fixture";
  readonly name = "Fixture";
  readonly country = "CH" as const;
  readonly capabilities: ProviderCapabilities = {
    supportsHls: true,
    supportsDirectDownload: true,
    requiresProxy: false,
    hasOfficialApi: true,
  };

  async search(_query: ProviderSearchQuery): Promise<ProviderContentItem[]> {
    return [];
  }
}

const item: ProviderContentItem = {
  id: "fixture-item",
  providerId: "fixture",
  channel: "SRF",
  topic: "Example",
  title: "Example programme",
  description: "Synthetic provider result",
  timestamp: 1_700_000_000,
  duration: 1800,
  size: 1_000_000,
  websiteUrl: "https://www.srf.ch/play/tv/example",
  videoUrls: { standard: "https://example.org/example.mp4" },
};

describe("provider download filenames", () => {
  it("keeps unknown provider audio neutral even for German-language domains/channels", async () => {
    const info = await new FixtureProvider().getDownloadInfo(item);

    expect(info.filename).not.toContain("GERMAN");
    expect(info.filename).toContain("Example.programme");
  });

  it("labels a filename German only with explicit German audio evidence", async () => {
    const info = await new FixtureProvider().getDownloadInfo({ ...item, audioLanguage: "de-CH" });

    expect(info.filename).toContain(".GERMAN.");
  });
});
