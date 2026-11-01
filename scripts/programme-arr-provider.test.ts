import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { programmeFixture } from "./programme-arr-provider.mjs";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pingufunk-programme-provider-"));
  await writeFile(path.join(root, "programme.mp4"), "owned German synthetic media");
  await writeFile(path.join(root, "programme-french.mp4"), "owned French synthetic media");
});
afterEach(async () => {
  await rm(root, { recursive: true });
});

it("keeps publisher coordinates and the explicit target separate and scopes actual source queries", async () => {
  const fetch = programmeFixture(root);
  const catalogue = new URL(
    "https://raw.githubusercontent.com/superions/pingufunk/main/data/shows.json"
  );
  expect((await fetch(catalogue, {})!.json())[0].mediathekProgrammes).toEqual([]);
  await writeFile(
    path.join(root, "programme-mode.json"),
    JSON.stringify({ binding: true, source: "valid" })
  );
  expect((await fetch(catalogue, {})!.json())[0].mediathekProgrammes).toMatchObject([
    { source: { season: 2019, episode: 1 }, target: { season: 8, episode: 1 } },
  ]);
  const query = (term: string) =>
    fetch(new URL("https://mediathekviewweb.de/api/query"), {
      body: JSON.stringify({ queries: [{ fields: ["topic", "title"], query: term }] }),
    })!.json();
  expect((await query("Source Solstice")).result.results).toHaveLength(1);
  expect((await query("Foreign series")).result.results).toEqual([]);
  expect(fetch(new URL("https://unhandled.invalid/"), {})).toBeUndefined();
});

it("serves exact bounded bytes and records real transfer versus metadata reads", async () => {
  const fetch = programmeFixture(root);
  const url = new URL("https://rodlzdf-a.akamaihd.net/synthetic/programme-solstice.mp4");
  const part = fetch(url, { headers: { Range: "bytes=6-11" } })!;
  expect(part.status).toBe(206);
  expect(part.headers.get("Content-Range")).toBe("bytes 6-11/28");
  expect(await part.text()).toBe("German");
  expect(await fetch(url, {})!.text()).toBe("owned German synthetic media");
  expect(() => fetch(url, { headers: { Range: "bytes=6-" } })).toThrow(
    "Owned exact programme range"
  );
  const rows = (await readFile(path.join(root, "programme-requests.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(rows.map((row) => row.ranged)).toEqual([true, false]);
});
