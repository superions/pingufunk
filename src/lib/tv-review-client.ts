import type { TvReviewPreview } from "@/services/tv-source-review";

/** Persist only an opaque decision identity, never media URLs or a provider credential. */
export function tvReviewIntent(fingerprint: string): string {
  const key = `pingufunk.tv-review.${fingerprint}`;
  const previous = sessionStorage.getItem(key);
  if (previous && /^[a-f0-9-]{36}$/.test(previous)) return previous;
  // randomUUID is unavailable on some plain-HTTP LAN origins; getRandomValues is not.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  sessionStorage.setItem(key, id);
  return id;
}

export async function submitTvReview(preview: TvReviewPreview) {
  const intentId = tvReviewIntent(preview.fingerprint);
  const response = await fetch("/api/tv-source-review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Pingufunk-Manual-Review": "1" },
    body: JSON.stringify({
      selector: preview.selector,
      fingerprint: preview.fingerprint,
      intentId,
      confirmRuntimeException: true,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  if (!response.ok || typeof result.id !== "string" || typeof result.status !== "string")
    throw new Error("Auftrag nicht bestätigt");
  // Keep the key after success too: reload/repeated click returns the same receipt.
  return result as { id: string; status: string };
}
