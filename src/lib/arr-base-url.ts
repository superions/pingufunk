/** Shared with the settings form; no credentials or server-only imports. */
export function parseArrBaseUrl(value: string): URL {
  if (value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("Invalid metadata base URL");
  }
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid metadata base URL");
  return url;
}
