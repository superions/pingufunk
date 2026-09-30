/** Inclusive seconds-based check; unknown expected duration is not a successful expected check. */
export function verifiedDurationCheck(
  sourceSeconds: number,
  expectedSeconds: number | null,
  minimumSeconds: number,
  tolerancePercent: number
): { accepted: boolean; expectedVerified: boolean } {
  if (
    !Number.isFinite(sourceSeconds) ||
    sourceSeconds <= 0 ||
    !Number.isFinite(minimumSeconds) ||
    minimumSeconds < 0 ||
    !Number.isFinite(tolerancePercent) ||
    tolerancePercent < 0 ||
    tolerancePercent > 25
  )
    return { accepted: false, expectedVerified: false };
  if (expectedSeconds === null)
    return { accepted: sourceSeconds >= minimumSeconds, expectedVerified: false };
  if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0)
    return { accepted: false, expectedVerified: false };
  const delta =
    tolerancePercent === 0
      ? 0
      : Math.min(expectedSeconds * 0.25, Math.max(5, (expectedSeconds * tolerancePercent) / 100));
  const accepted =
    sourceSeconds >= Math.min(minimumSeconds, expectedSeconds - delta) &&
    sourceSeconds >= expectedSeconds - delta &&
    sourceSeconds <= expectedSeconds + delta;
  return { accepted, expectedVerified: accepted };
}
