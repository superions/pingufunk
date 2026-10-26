import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { CREDENTIAL_ENV } from "../src/lib/settings-redaction";
import { youtubeMappingKey, type YoutubeSave } from "../src/lib/youtube-catalogue";
import type { TvdbData } from "../src/types";
const fixture = vi.hoisted(() => ({ show: null as TvdbData | null }));
vi.mock("../src/services/shows", () => ({
  getShowInfoByTvdbId: async () => fixture.show,
  getCatalogueShowIdentities: async () => [],
}));
vi.mock("../src/services/tmdb", () => ({
  getMovieInfoByTmdbId: async () => null,
  findProgrammeIdentity: async () => ({ available: false, ambiguous: false, targetId: null }),
  ProgrammeIdentityConflictError: class extends Error {},
}));
vi.mock("../src/services/sonarr-provider", () => ({ openSonarrSession: async () => null }));
vi.mock("../src/services/radarr-provider", () => ({
  getRadarrMovie: async () => null,
  getRadarrMonitoredMovies: async () => [],
}));
const pgEnabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (pgEnabled) {
  const url = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/pingufunk_qa"
  )
    throw Error("Disposable PostgreSQL required");
}
let directory: string | undefined;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  delete (globalThis as { prisma?: unknown }).prisma;
  delete (globalThis as { youtubeCatalogueRuntime?: unknown }).youtubeCatalogueRuntime;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (directory) rmSync(directory, { recursive: true });
  directory = undefined;
});
for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !pgEnabled)(
    `carries a synthetic scan through persisted canonical report and restart without changing existing jobs on ${provider}`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-p173-mapping-"));
      let url = `file:${directory}/database.sqlite`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p17_mapping");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      for (const key of Object.values(CREDENTIAL_ENV)) {
        vi.stubEnv(key, undefined);
        vi.stubEnv(key + "_FILE", undefined);
      }
      const migrate = spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
        env: process.env,
        encoding: "utf8",
        timeout: 30000,
      });
      expect(migrate.status).toBe(0);
      vi.resetModules();
      let { prisma } = await import("../src/lib/db");
      let service = await import("../src/services/youtube-catalogue");
      cleanup = async () => {
        await service.stopYoutubeCatalogueRefresh();
        if (provider === "postgresql")
          await prisma.$executeRawUnsafe('DROP SCHEMA "p17_mapping" CASCADE');
        await prisma.$disconnect();
      };
      await prisma.config.deleteMany();
      await prisma.download.deleteMany();
      const existing = await prisma.download.create({
        data: {
          title: "Synthetic retained job",
          url: "https://example.invalid/retained.mp4",
          category: "tv",
          status: "queued",
        },
      });
      const channel = "UCaaaaaaaaaaaaaaaaaaaaaa",
        playlist = "PLsynthetic123456";
      fixture.show = {
        id: 42,
        name: "Synthetic series",
        germanName: "Synthetic series",
        aliases: [],
        episodes: Array.from({ length: 97 }, (_, i) => ({
          name: "Synthetic title " + i,
          seasonNumber: Math.floor(i / 13) + 1,
          episodeNumber: (i % 13) + 1,
          aired: null,
          runtime: null,
        })),
      };
      const executable = path.join(directory, "synthetic-ytdlp");
      writeFileSync(
        executable,
        `#!${process.execPath}
const args=process.argv.slice(2);if(!args.includes('--simulate')||!args.includes('--skip-download')||!args.includes('--ignore-config'))process.exit(9);
const u=new URL(args.at(-1));const id=u.searchParams.get('list');
const entries=Array.from({length:97},(_,i)=>({id:String(i).padStart(11,'0'),channel_id:${JSON.stringify(channel)},title:'Synthetic series, Staffel '+(20+Math.floor(i/13))+', Folge '+(i%13+1)+': Synthetic title '+i,duration:120}));
entries.push({id:'unavail0000',availability:'private'});
process.stdout.write(JSON.stringify({id,channel_id:${JSON.stringify(channel)},channel:'Synthetic channel',title:'Synthetic series',entries}));
`,
        { mode: 0o700 }
      );
      await prisma.config.createMany({
        data: [
          { key: "download.ytdlpPath", value: executable },
          { key: "synthetic.retained", value: "unchanged" },
        ],
      });
      const forbidden = vi.fn(async () => {
        throw Error("No external network in mapping runtime fixture");
      });
      vi.stubGlobal("fetch", forbidden);
      let api = await import("../src/app/api/youtube/catalogue/route");
      const post = (body: unknown) =>
        api.POST(
          new NextRequest("http://localhost/api/youtube/catalogue", {
            method: "POST",
            headers: { "content-type": "application/json", "X-Pingufunk-Catalogue": "1" },
            body: JSON.stringify(body),
          })
        );
      const initial = await service.youtubeCatalogueSnapshot();
      const submitted: YoutubeSave = {
        action: "save",
        revision: initial.revision,
        enabled: true,
        registry: structuredClone(initial.registry),
      };
      submitted.registry.channels.push({ id: channel, name: "Synthetic channel", enabled: true });
      submitted.registry.programMappings.push({
        kind: "series",
        sourceId: playlist,
        channelId: channel,
        name: "Synthetic series",
        targetId: 42,
        enabled: true,
        sourceNumbering: "publisher",
        targetOrder: "aired",
      });
      expect((await post(submitted)).status).toBe(200);
      const saved = await service.youtubeCatalogueSnapshot();
      expect((await post({ action: "refresh", revision: saved.revision })).status).toBe(202);
      for (
        let i = 0;
        i < 250 && (await service.youtubeCatalogueSnapshot()).scan.state === "running";
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await service.youtubeCatalogueSnapshot()).scan.state).toBe("complete");
      await service.cancelYoutubeCatalogue();
      const key = youtubeMappingKey(submitted.registry.programMappings.at(-1)!);
      const request = () =>
        new NextRequest(
          `http://localhost/api/youtube/catalogue?mapping=${encodeURIComponent(key)}`
        );
      const before = await prisma.config.findMany({ orderBy: { key: "asc" } });
      const reportResponse = await api.GET(request());
      expect(reportResponse.status).toBe(200);
      const report = await reportResponse.json();
      expect(report).toMatchObject({
        state: "ready",
        rowCount: 97,
        extraCount: 1,
        mediaReady: false,
        totals: { mapped: 97, missing: 0, ambiguous: 0, unavailable: 0 },
      });
      expect(report.rows).toHaveLength(97);
      expect(report.rows[0].sources[0].sourceCoordinates).toEqual({ season: 20, episode: 1 });
      expect(await prisma.config.findMany({ orderBy: { key: "asc" } })).toEqual(before);
      expect(await prisma.download.findMany()).toEqual([existing]);
      expect(forbidden).not.toHaveBeenCalled();
      const inspect = await post({ action: "inspect", url: playlist });
      expect(inspect.status).toBe(200);
      expect((await inspect.json()).identity).toMatchObject({
        state: "bound",
        origin: "local",
        targetId: 42,
      });
      expect(await prisma.download.findMany()).toEqual([existing]);
      await service.stopYoutubeCatalogueRefresh();
      await prisma.$disconnect();
      delete (globalThis as { prisma?: unknown }).prisma;
      delete (globalThis as { youtubeCatalogueRuntime?: unknown }).youtubeCatalogueRuntime;
      vi.resetModules();
      ({ prisma } = await import("../src/lib/db"));
      service = await import("../src/services/youtube-catalogue");
      api = await import("../src/app/api/youtube/catalogue/route");
      expect(await (await api.GET(request())).json()).toEqual(report);
      expect(await prisma.download.findMany()).toEqual([existing]);
      expect(forbidden).not.toHaveBeenCalled();
    },
    60000
  );
