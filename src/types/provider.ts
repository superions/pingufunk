/**
 * Content Provider Types
 *
 * Defines the interface for content providers (MediathekView, SRF, ORF, etc.)
 */

/**
 * Supported countries for content providers
 */
export type ProviderCountry = "DE" | "CH" | "AT";

/**
 * Content item from a provider search result
 */
export interface ProviderContentItem {
  /** Unique identifier for this item (provider-specific) */
  id: string;
  /** Provider that returned this item */
  providerId: string;
  /** Broadcasting channel (e.g., "ARD", "ZDF", "SRF", "ORF") */
  channel: string;
  /** Topic/Show name */
  topic: string;
  /** Episode/Item title */
  title: string;
  /** Description text */
  description: string;
  /** Legacy provider sort/ID timestamp; not authoritative availability or film production year. */
  timestamp: number;
  contentDates?: import("@/lib/content-dates").ContentDates;
  sourceAvailability?: import("@/lib/content-dates").SourceAvailability;
  /** Explicit production-year metadata only; never derived from timestamp. */
  productionYear?: number;
  /** Duration in seconds */
  duration: number;
  /** File size in bytes (0 if unknown) */
  size: number;
  /** Only set from provider metadata that explicitly identifies the audio track language. */
  audioLanguage?: string | null;
  subtitleLanguage?: string | null;
  originalVersion?: boolean;
  audioDescription?: boolean;
  signLanguage?: boolean;
  clearSpeech?: boolean;
  /** Optional subtitle resource; never proof of the video's audio language. */
  subtitleUrl?: string;
  /** Trusted adapter facts remain bound to their exact rendition, never a slot label. */
  sourceAudioEvidence?: import("@/types").ApiResultItem["sourceAudioEvidence"];
  sourceVideoDimensions?: import("@/types").ApiResultItem["sourceVideoDimensions"];
  /** URL to the website page for this content */
  websiteUrl: string;
  /** Available video URLs by quality */
  videoUrls: ProviderVideoUrls;
}

/**
 * Video URLs by quality level
 */
export interface ProviderVideoUrls {
  /** Standard quality video URL */
  standard: string;
  /** Low quality video URL (optional) */
  low?: string;
  /** High/HD quality video URL (optional) */
  high?: string;
}

/**
 * Search query parameters for providers
 */
export interface ProviderSearchQuery {
  requestBudget?: import("@/lib/fetch-retry").HttpRequestBudget;
  deadlineAt?: number;
  /** Search text */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Content type filter */
  type?: "all" | "movie" | "series";
}

/**
 * Download information for a content item
 */
export interface ProviderDownloadInfo {
  /** URL to download */
  url: string;
  /** Whether this is an HLS stream */
  isHls: boolean;
  /** Suggested filename */
  filename: string;
  /** Expected file size in bytes (0 if unknown) */
  expectedSize: number;
  /** Quality label (e.g., "720p", "1080p") */
  quality: string;
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  /** Whether the provider supports HLS streams */
  supportsHls: boolean;
  /** Whether the provider supports direct downloads */
  supportsDirectDownload: boolean;
  /** Whether the provider requires a proxy for access */
  requiresProxy: boolean;
  /** Whether the provider has an official API */
  hasOfficialApi: boolean;
}

/**
 * Provider status information
 */
export interface ProviderStatus {
  /** Whether the provider is available/healthy */
  available: boolean;
  /** Last successful check timestamp */
  lastCheck: number;
  /** Error message if not available */
  error?: string;
}

/**
 * Content Provider interface
 *
 * All content providers must implement this interface
 */
export interface ContentProvider {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable provider name */
  readonly name: string;
  /** Country code for this provider */
  readonly country: ProviderCountry;
  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  /**
   * Initialize the provider
   * Called once when the provider is registered
   */
  initialize(): Promise<void>;

  /**
   * Search for content
   * @param query Search parameters
   * @returns Array of content items matching the query
   */
  search(query: ProviderSearchQuery): Promise<ProviderContentItem[]>;

  /**
   * Get download information for a content item
   * @param item Content item to get download info for
   * @param preferredQuality Preferred quality level
   * @returns Download information
   */
  getDownloadInfo(
    item: ProviderContentItem,
    preferredQuality?: "low" | "standard" | "high"
  ): Promise<ProviderDownloadInfo>;

  /**
   * Check if the provider is available
   * @returns Provider status
   */
  checkStatus(): Promise<ProviderStatus>;

  /**
   * Whether this provider is enabled
   */
  isEnabled(): Promise<boolean>;
}

/**
 * Provider configuration stored in settings
 */
export interface ProviderConfig {
  /** Provider ID */
  providerId: string;
  /** Whether the provider is enabled */
  enabled: boolean;
  /** Provider-specific settings */
  settings?: Record<string, string>;
}

export interface ContentQueryField {
  fields: string[];
  query: string;
}

export interface ContentSearchOptions {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  future?: boolean;
  offset?: number;
  deadlineAt?: number;
  requestBudget?: import("@/lib/fetch-retry").HttpRequestBudget;
  /** Callers can restrict their candidate window to progressive renditions. */
  progressiveOnly?: boolean;
  /** Verified metadata owner; shared-topic ARTE editions are resolved before language selection. */
  arteSeries?: import("@/types").TvdbData;
  /** Internal catalogue owner must resolve verified editions before final selection. */
  deferLanguageSelection?: boolean;
  /** Supplemental RSS owners may bound raw pages to protect the shared primary budget. */
  maxCandidatePages?: number;
}

export type SearchProviderId = "mediathekview" | "orf" | "srf";

export interface ContentSearchWindow {
  items: import("@/types").ApiResultItem[];
  /** Successful bounded retrieval is not a claim that the complete catalogue was searched. */
  coverage: {
    complete: boolean;
    candidateWindowLimited: boolean;
    sources: Array<{
      providerId: SearchProviderId;
      state: "complete" | "failed" | "disabled";
      candidateCount: number;
    }>;
  };
}

/** Source modules own retrieval; the coordinator owns shared policy and consumers. */
export interface ContentSearchAdapter {
  readonly cacheSettingKeys: readonly string[];
  readonly providerIds: readonly SearchProviderId[];
  readonly rssWindowAttempts: number;
  providerForItem(item: import("@/types").ApiResultItem): SearchProviderId;
  searchWindow(
    queries: ContentQueryField[],
    size: number,
    options: ContentSearchOptions,
    hlsEnabled: boolean,
    providerId?: SearchProviderId
  ): Promise<ContentSearchWindow>;
}

/** Existing persisted jobs have a Mediathek URL, not an inferred YouTube extractor target. */
export interface SourceDownloadReference {
  family: "mediathek";
  url: string;
}

/** The worker owns directories, policy and persistence; source modules only transfer bytes. */
export interface SourceDownloadContext {
  stagingDirectory: string;
  filename: string;
  /** Read once when needed: streams before transfer, direct files before postprocessing. */
  getContainer: () => Promise<"mkv" | "mp4">;
  expectations: import("@/lib/media-expectations").MediaExpectations | null;
  signal: AbortSignal;
  onProgress: (
    percent: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number
  ) => Promise<void>;
}

export interface SourceDownloadArtifact {
  path: string;
  /** Selected output suffix, not a replacement for the common physical media probe. */
  extension: string;
}

export interface SourceDownloadAdapter {
  transfer(
    source: SourceDownloadReference,
    context: SourceDownloadContext
  ): Promise<SourceDownloadArtifact>;
}
