import { afterEach, expect, it, vi } from "vitest";
import { indexerDownloadUrl, withIndexerUrl } from "./indexer-url";

afterEach(() => vi.unstubAllEnvs());

it("isolates concurrent request origins and preserves explicit deployment prefixes", async () => {
  vi.stubEnv("PINGUFUNK_PUBLIC_URL", undefined);
  const paths = await Promise.all(
    ["https://one.example.invalid", "http://two.example.invalid:6767"].map((origin) =>
      withIndexerUrl(origin + "/api/newznab", async () => {
        await Promise.resolve();
        return indexerDownloadUrl("/api/newznab/fake_nzb_download?q=synthetic");
      })
    )
  );
  expect(paths).toEqual([
    "https://one.example.invalid/api/newznab/fake_nzb_download?q=synthetic",
    "http://two.example.invalid:6767/api/newznab/fake_nzb_download?q=synthetic",
  ]);
  expect(indexerDownloadUrl("/api/newznab/fake_nzb_download")).toBe(
    "/api/newznab/fake_nzb_download"
  );
});

it.each([
  "not-a-url",
  " ",
  "ftp://example.invalid",
  "https://user:synthetic-private@example.invalid",
  "https://example.invalid?key=synthetic-private",
  "https://example.invalid#fragment",
])("fails generically for an invalid configured URL: %s", (value) => {
  vi.stubEnv("PINGUFUNK_PUBLIC_URL", value);
  expect(() => withIndexerUrl("http://localhost/api/newznab", () => {})).toThrow(
    "Invalid public indexer URL"
  );
});
