import { AsyncLocalStorage } from "node:async_hooks";

const indexerUrls = new AsyncLocalStorage<string>();

/** Explicit public URL wins; untrusted forwarding headers never select link hosts. */
export function withIndexerUrl<T>(requestUrl: string, operation: () => T): T {
  const configured = process.env.PINGUFUNK_PUBLIC_URL;
  let base: URL;
  try {
    if (configured && configured.trim() !== configured) throw new Error();
    base = new URL(configured || new URL(requestUrl).origin);
  } catch {
    throw new Error("Invalid public indexer URL");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid public indexer URL");
  base.pathname = base.pathname.replace(/\/+$/, "") + "/";
  return indexerUrls.run(base.href, operation);
}

export function getIndexerBaseUrl(): string | undefined {
  return indexerUrls.getStore();
}

export function indexerDownloadUrl(relativePath: string): string {
  const base = getIndexerBaseUrl();
  return base ? new URL(relativePath.replace(/^\//, ""), base).href : relativePath;
}
