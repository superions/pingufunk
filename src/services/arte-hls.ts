import { fetchWithRetry, HttpRequestBudget } from "@/lib/fetch-retry";
import { readBoundedProviderText } from "@/lib/bounded-provider-json";
import { getStreamHeight } from "@/lib/stream-url";
import { isGermanLanguageCode } from "@/lib/language-policy";

/** Only ARTE's indexed manifest service owns this multi-audio contract. */
export function isArteHls(value: string, programmeId?: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["manifest-arte.akamaized.net", "secure-manifest-arte.akamaized.net"].includes(
        url.hostname
      ) &&
      /^\/api\/manifest\/v1\/Generate\//.test(url.pathname) &&
      /\/\d{6}-\d{3}-[A-Z]\.m3u8$/.test(url.pathname) &&
      (!programmeId ||
        url.pathname.match(/(\d{6}-\d{3})-[A-Z]\.m3u8$/)?.[1] === programmeId.slice(0, 10))
    );
  } catch {
    return false;
  }
}

function attributes(line: string): Record<string, string> {
  return Object.fromEntries(
    [...line.matchAll(/([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g)].map((match) => [
      match[1],
      match[2] ?? match[3],
    ])
  );
}

/** Select explicitly German audio, preferring ordinary speech and excluding AD. */
export function parseArteHls(text: string, master: string, maximumHeight?: number) {
  if (!isArteHls(master) || !text.startsWith("#EXTM3U")) throw Error("Invalid ARTE manifest");
  const programme = new URL(master).pathname.match(/(\d{6}-\d{3}-[A-Z])\.m3u8$/)![1];
  const mediaUrl = (value: string) => {
    const url = new URL(value, master);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.endsWith(".akamaized.net") ||
      !url.pathname.endsWith(".m3u8") ||
      !url.pathname.includes(`/${programme}/`)
    )
      throw Error("Invalid ARTE rendition");
    return url.toString();
  };
  const lines = text.split(/\r?\n/);
  const germanAudio = lines
    .filter((line) => line.startsWith("#EXT-X-MEDIA:"))
    .map(attributes)
    .filter(
      (row) =>
        row.TYPE === "AUDIO" &&
        isGermanLanguageCode(row.LANGUAGE) &&
        !/describes-video|audiodeskription|hörfilm/i.test(`${row.CHARACTERISTICS},${row.NAME}`)
    );
  // LANGUAGE owns language evidence; version tokens never gate a German track.
  // Prefer ordinary speech, retaining a labelled clear-speech fallback for the GUI policy.
  const isClearSpeech = (row: Record<string, string>) =>
    /enhances-speech-intelligibility|klare\s+sprache/i.test(`${row.CHARACTERISTICS},${row.NAME}`);
  const standardAudio = germanAudio.filter((row) => !isClearSpeech(row));
  const audio = standardAudio.length ? standardAudio : germanAudio;
  const unique = [...new Set(audio.map((row) => mediaUrl(row.URI)))];
  if (unique.length !== 1) throw Error("German standard audio unavailable");
  const groups = new Set(audio.map((row) => row["GROUP-ID"]));
  const videos = lines
    .flatMap((line, i) => {
      if (!line.startsWith("#EXT-X-STREAM-INF:")) return [];
      const row = attributes(line),
        size = /^(\d+)x(\d+)$/.exec(row.RESOLUTION ?? "");
      if (!size || !groups.has(row.AUDIO) || !/(?:^|,)avc1\./.test(row.CODECS ?? "")) return [];
      const width = Number(size[1]),
        height = Number(size[2]);
      if (width <= 0 || height <= 0 || width > 65536 || height > (maximumHeight ?? 65536))
        return [];
      return [{ videoUrl: mediaUrl(lines[i + 1]?.trim()), width, height }];
    })
    .sort(
      (a, b) => b.height - a.height || b.width - a.width || a.videoUrl.localeCompare(b.videoUrl)
    );
  if (!videos.length) throw Error("ARTE video rendition unavailable");
  return {
    ...videos[0],
    audioUrl: unique[0],
    originalVersion: (audio[0].CHARACTERISTICS ?? "")
      .split(",")
      .some((value) => value.trim().startsWith("tv.arte.audio.version.vo")),
    clearSpeech: isClearSpeech(audio[0]),
  };
}

/** Search and transfer use the same bounded source parser; transfer refreshes expiring URLs. */
export async function resolveArteHls(
  master: string,
  budget = new HttpRequestBudget(),
  signal?: AbortSignal,
  maximumHeight = getStreamHeight(master)
) {
  if (!isArteHls(master)) throw Error("Invalid ARTE manifest");
  const response = await fetchWithRetry(
    master.split("#")[0],
    { signal },
    { requestBudget: budget, maxRetries: 0 }
  );
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw Error("ARTE manifest unavailable");
  }
  return parseArteHls(
    await readBoundedProviderText(response, budget.deadlineAt, 1024 * 1024, signal),
    master,
    maximumHeight
  );
}
