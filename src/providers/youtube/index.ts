import { BaseProvider } from "../base";
import { youtubeSearchAdapter } from "./search";
import { apiResultToProviderItem, providerItemToApiResult } from "../content-item";
import { readYoutubeCatalogueIndex } from "@/services/youtube-catalogue";
import { getSetting, getMinDurationSeconds } from "@/lib/settings";
import { readLanguagePolicy, LANGUAGE_POLICY_SETTING_KEY } from "@/lib/language-policy";
import { selectLanguageVariants } from "@/services/language-editions";
import { selectRenditions } from "@/services/rendition-quality";
import { youtubeSourceReferenceSchema } from "@/lib/youtube-source";
import type {
  ProviderContentItem,
  ProviderDownloadInfo,
  ProviderSearchQuery,
  ProviderStatus,
} from "@/types/provider";

/** Registry/status facade only; both retrieval and bytes remain in the source modules. */
export class YoutubeProvider extends BaseProvider {
  readonly id = "youtube";
  readonly name = "YouTube (ÖR-Kanalregister)";
  readonly country = "DE" as const;
  readonly capabilities = {
    supportsHls: false,
    supportsDirectDownload: true,
    requiresProxy: false,
    hasOfficialApi: false,
  };
  async search(query: ProviderSearchQuery): Promise<ProviderContentItem[]> {
    if (!(await this.isEnabled()) || query.query.trim().length < 2) return [];
    const result = await youtubeSearchAdapter.searchWindow(
      [{ fields: ["topic", "title"], query: query.query.trim() }],
      query.limit ?? 100,
      { mediaType: query.type, deadlineAt: query.deadlineAt, requestBudget: query.requestBudget },
      false,
      "youtube"
    );
    if (!result.coverage.complete) throw Error("YouTube index unavailable");
    const minimum = await getMinDurationSeconds();
    const policy = readLanguagePolicy(await getSetting(LANGUAGE_POLICY_SETTING_KEY));
    return selectLanguageVariants(result.items, policy)
      .filter((item) => item.duration >= minimum && selectRenditions(item, "all", false).length > 0)
      .map((item) => apiResultToProviderItem(item, this.id));
  }
  async checkStatus(): Promise<ProviderStatus> {
    if (!(await this.isEnabled()))
      return { available: false, lastCheck: Date.now(), error: "YouTube source disabled" };
    try {
      const index = await readYoutubeCatalogueIndex();
      const available = index.enabled && index.indexed && index.current;
      return {
        available,
        lastCheck: Date.now(),
        ...(!available ? { error: "Prepare the configured metadata index in Settings" } : {}),
      };
    } catch {
      return { available: false, lastCheck: Date.now(), error: "YouTube index unavailable" };
    }
  }
  async getDownloadInfo(
    item: ProviderContentItem,
    preferredQuality: "low" | "standard" | "high" = "high"
  ): Promise<ProviderDownloadInfo> {
    youtubeSourceReferenceSchema.parse(item.sourceRef);
    const choices = selectRenditions(providerItemToApiResult(item), "all", false);
    const field =
      preferredQuality === "high"
        ? "url_video_hd"
        : preferredQuality === "standard"
          ? "url_video"
          : "url_video_low";
    const selected =
      choices.find((row) => row.field === field) ??
      (preferredQuality === "high" ? choices[0] : undefined);
    if (!selected || !("sourceRef" in selected)) throw Error("Requested rendition unavailable");
    const sourceRef = selected.sourceRef;
    // An information helper never returns a Watch URL as if it were media bytes.
    return {
      url: "",
      sourceRef,
      isHls: false,
      filename: this.generateFilename(item, `${sourceRef.selection.height}p`),
      expectedSize: item.size,
      quality: `${sourceRef.selection.height}p`,
    };
  }
}
export const youtubeProvider = new YoutubeProvider();
