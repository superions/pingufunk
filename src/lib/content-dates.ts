/** Catalogue updates, broadcast instants and rights are independent source facts. */
export interface ContentDates {
  catalogueUpdatedAt?: number;
  broadcastAt?: number;
  /** An otherwise unspecified provider date; never a production year or rights start. */
  providerDate?: number;
}

export type SourceAvailability =
  | { state: "unknown" }
  | {
      state: "declared_rights";
      provenance: "arte_player" | "ard_player";
      checkedAt: number;
      beginsAt: number | null;
      endsAt: number | null;
      /** Exact URLs of the already verified programme, not stable/signature-stripped aliases. */
      urls: string[];
    };

export type AvailabilityState =
  | "unknown"
  | "rights_current"
  | "not_yet"
  | "expired"
  | "conflicting";

/** Epoch seconds from a provider contract; zero is an absent-date sentinel. */
export function sourceEpoch(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 253402300799 &&
    Number.isFinite(new Date(value * 1000).getTime())
    ? value
    : undefined;
}

/** Require a real calendar instant and explicit timezone; Date.parse alone normalizes impossible days. */
export function sourceInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  if (
    y < 1000 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch / 1000 : null;
}

/** Rights being current is not proof of media reachability, language, geography or identity. */
export function sourceAvailabilityState(
  availability: SourceAvailability | undefined,
  url: string,
  now = Date.now() / 1000
): AvailabilityState {
  if (!availability || availability.state === "unknown") return "unknown";
  if (
    availability.state !== "declared_rights" ||
    !["arte_player", "ard_player"].includes(availability.provenance) ||
    sourceEpoch(availability.checkedAt) === undefined ||
    availability.checkedAt > now ||
    !Array.isArray(availability.urls) ||
    !availability.urls.length ||
    availability.urls.length > 200 ||
    availability.urls.some((value) => typeof value !== "string" || !value) ||
    (availability.beginsAt !== null && sourceEpoch(availability.beginsAt) === undefined) ||
    (availability.endsAt !== null && sourceEpoch(availability.endsAt) === undefined) ||
    (availability.beginsAt === null && availability.endsAt === null) ||
    (availability.beginsAt !== null &&
      availability.endsAt !== null &&
      availability.beginsAt > availability.endsAt)
  )
    return "conflicting";
  if (!availability.urls.includes(url)) return "unknown";
  if (availability.beginsAt !== null && availability.beginsAt > now) return "not_yet";
  if (availability.endsAt !== null && availability.endsAt < now) return "expired";
  return "rights_current";
}
