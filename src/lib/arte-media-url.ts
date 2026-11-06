export function isArteProgressiveUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    // Shared trust boundary for ARTE progressive downloads and metadata enrichment.
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname.endsWith(".arte.tv") ||
        url.hostname.endsWith(".akamaized.net") ||
        url.hostname === "arteptweb-a.akamaihd.net") &&
      /\.mp4$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
