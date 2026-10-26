import seedData from "../../data/youtube-sources.json";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { youtubeTitleKey } from "@/lib/youtube-mapping";
import {
  youtubeMappingKey,
  youtubeRegistrySchema,
  type YoutubeIdentity,
  type YoutubeRegistry,
} from "@/lib/youtube-catalogue";
import { getCatalogueShowIdentities, getShowInfoByTvdbId } from "./shows";
import {
  findProgrammeIdentity,
  getMovieInfoByTmdbId,
  ProgrammeIdentityConflictError,
} from "./tmdb";
import { openSonarrSession } from "./sonarr-provider";
import { getRadarrMonitoredMovies, getRadarrMovie } from "./radarr-provider";
import { movieSourceTitle } from "./movie-matcher";

const seed = youtubeRegistrySchema.parse(seedData);
type Source = {
  kind: "series" | "movie";
  sourceId: string;
  channelId: string;
  name: string;
  channelName: string;
};
type Candidate = YoutubeIdentity["candidates"][number] & { crossId?: string | null };
const result = (
  state: YoutubeIdentity["state"],
  candidates: Candidate[] = []
): YoutubeIdentity => ({
  state,
  origin: state === "bound" ? "metadata" : "none",
  targetId: state === "bound" ? candidates[0].targetId : null,
  candidates: candidates.map(({ targetId, name, year }) => ({ targetId, name, year })),
});
function yearFromEpisodes(episodes: Array<{ aired: Date | null }>) {
  return episodes
    .filter((episode) => episode.aired && Number.isFinite(episode.aired.getTime()))
    .map((episode) => episode.aired!.getUTCFullYear())
    .reduce<number | null>((a, b) => (a === null ? b : Math.min(a, b)), null);
}
/** Suggestions never save, activate, search for media, or replace an explicit local ID. */
export async function suggestYoutubeIdentity(
  source: Source,
  local: YoutubeRegistry | null,
  deadlineAt = Date.now() + 15000
): Promise<YoutubeIdentity> {
  const key = youtubeMappingKey(source);
  for (const [origin, rows] of [
    ["local", local?.programMappings ?? []],
    ["preset", seed.programMappings],
  ] as const) {
    const mapping = rows.find((mapping) => youtubeMappingKey(mapping) === key);
    if (mapping)
      return {
        state: "bound",
        origin,
        targetId: mapping.targetId,
        candidates: [{ targetId: mapping.targetId, name: mapping.name, year: null }],
      };
  }
  const remaining = Math.min(15000, Math.floor(deadlineAt - Date.now()));
  if (remaining <= 0) return result("metadata_unavailable");
  const budget = new HttpRequestBudget(32, remaining);
  // Strip an actual uploader suffix only; upload dates never supply a production year.
  let name = source.name.trim();
  for (const separator of [" | ", " – ", " - "]) {
    const suffix = separator + source.channelName;
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length).trim();
  }
  const query = movieSourceTitle(name);
  if (!youtubeTitleKey(query.title)) return result("not_found");
  const matches = (names: Array<string | null | undefined>) =>
    names.some((name) => name && youtubeTitleKey(name) === youtubeTitleKey(query.title));
  const candidates = new Map<number, Candidate>();
  const observed = new Map<number, Candidate>();
  let available = false,
    ambiguous = false;
  const add = (candidate: Candidate) => {
    const previous = observed.get(candidate.targetId);
    if (
      (previous?.year && candidate.year && previous.year !== candidate.year) ||
      (previous?.crossId && candidate.crossId && previous.crossId !== candidate.crossId)
    )
      ambiguous = true;
    const merged = {
      ...candidate,
      year: candidate.year ?? previous?.year ?? null,
      crossId: candidate.crossId ?? previous?.crossId ?? null,
    };
    observed.set(candidate.targetId, merged);
    if (query.year !== null && candidate.year !== query.year) {
      if (candidate.year === null) ambiguous = true;
      return;
    }
    candidates.set(candidate.targetId, merged);
  };
  // Independent metadata owners share one attempt/deadline budget. Optional outages
  // cannot conceal an independently usable catalogue or configured provider.
  const lookups = await Promise.allSettled([
    (async () => {
      if (source.kind !== "series") return;
      const identities = await getCatalogueShowIdentities(budget);
      available = true;
      for (const identity of identities)
        if (matches(identity.names))
          add({ targetId: identity.targetId, name: identity.names[0], year: identity.year });
    })(),
    (async () => {
      if (source.kind === "series") {
        const session = await openSonarrSession();
        if (!session) return;
        const inventory = await session.inventory(budget);
        available = true;
        const matching = inventory.filter((series) =>
          matches([series.title, ...(series.aliases ?? [])])
        );
        if (matching.length > 20) {
          ambiguous = true;
          return;
        }
        for (const series of matching) {
          const show = await session.show(series.tvdbId, budget);
          if (!show) throw Error("Unconfirmed series metadata");
          add({
            targetId: series.tvdbId,
            name: series.title,
            year: yearFromEpisodes(show.episodes),
          });
        }
      } else {
        const movies = await getRadarrMonitoredMovies(budget);
        // Disabled integrations return an empty list without secret or network I/O.
        for (const movie of movies)
          if (matches([movie.title, movie.germanTitle, ...(movie.aliases ?? [])])) {
            available = true;
            add({
              targetId: movie.tmdbId,
              name: movie.germanTitle || movie.title,
              year: movie.productionYear ?? null,
              crossId: movie.imdbId,
            });
          }
      }
    })(),
    (async () => {
      const lookup = await findProgrammeIdentity(
        query.title,
        source.kind,
        query.year,
        budget,
        youtubeTitleKey
      );
      available ||= lookup.available;
      ambiguous ||= lookup.ambiguous;
      if (lookup.targetId !== null) {
        const metadata =
          source.kind === "series"
            ? await getShowInfoByTvdbId(lookup.targetId, budget)
            : await getMovieInfoByTmdbId(lookup.targetId, budget);
        if (!metadata) throw Error("Unconfirmed canonical metadata");
        if ("episodes" in metadata) {
          if (
            metadata.id !== lookup.targetId ||
            !metadata.episodes.length ||
            !matches([
              metadata.name,
              metadata.germanName,
              ...metadata.aliases.map((alias) => alias.name),
            ])
          )
            throw new ProgrammeIdentityConflictError("Conflicting canonical series identity");
          add({
            targetId: metadata.id,
            name: metadata.germanName || metadata.name,
            year: yearFromEpisodes(metadata.episodes),
          });
        } else {
          if (
            metadata.tmdbId !== lookup.targetId ||
            !matches([metadata.title, metadata.germanTitle, ...(metadata.aliases ?? [])])
          )
            throw new ProgrammeIdentityConflictError("Conflicting canonical movie identity");
          add({
            targetId: metadata.tmdbId,
            name: metadata.germanTitle || metadata.title,
            year:
              metadata.productionYear ??
              (metadata.releaseDate ? Number(metadata.releaseDate.slice(0, 4)) : null),
            crossId: metadata.imdbId,
          });
        }
      }
    })(),
  ]);
  if (
    lookups.some(
      (lookup) =>
        lookup.status === "rejected" && lookup.reason instanceof ProgrammeIdentityConflictError
    )
  )
    ambiguous = true;
  const values = [...candidates.values()].slice(0, 20);
  if (ambiguous || candidates.size > 1) return result("ambiguous", values);
  if (values.length === 1) {
    // Final metadata read verifies the selected namespace, not only a matching library label.
    try {
      const chosen = values[0];
      let verified;
      if (source.kind === "series") verified = await getShowInfoByTvdbId(chosen.targetId, budget);
      else {
        try {
          verified = await getRadarrMovie(chosen.targetId, chosen.crossId ?? null, budget);
        } catch {
          budget.assertAvailable();
        }
        verified ??= await getMovieInfoByTmdbId(chosen.targetId, budget);
      }
      if (
        !verified ||
        ("episodes" in verified
          ? verified.id !== chosen.targetId ||
            !verified.episodes.length ||
            !matches([
              verified.name,
              verified.germanName,
              ...verified.aliases.map((alias) => alias.name),
            ])
          : verified.tmdbId !== chosen.targetId ||
            !matches([verified.title, verified.germanTitle, ...(verified.aliases ?? [])]))
      )
        return result("metadata_unavailable", values);
      const verifiedYear =
        "episodes" in verified
          ? yearFromEpisodes(verified.episodes)
          : (verified.productionYear ??
            (verified.releaseDate ? Number(verified.releaseDate.slice(0, 4)) : null));
      if (query.year !== null && verifiedYear !== query.year)
        return result("metadata_unavailable", values);
      if (!("episodes" in verified) && chosen.crossId && verified.imdbId !== chosen.crossId)
        return result("metadata_unavailable", values);
      return result("bound", values);
    } catch {
      return result("metadata_unavailable", values);
    }
  }
  return result(
    !available || lookups.some((lookup) => lookup.status === "rejected")
      ? "metadata_unavailable"
      : "not_found"
  );
}
