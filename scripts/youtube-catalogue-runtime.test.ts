import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { CREDENTIAL_ENV } from "../src/lib/settings-redaction";
import {
  YOUTUBE_INDEX_KEY,
  YOUTUBE_REGISTRY_KEY,
  YOUTUBE_ENABLED_KEY,
  confirmedYoutubeSave,
  type YoutubeSave,
  type YoutubeSnapshot,
} from "../src/lib/youtube-catalogue";

const pgEnabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (pgEnabled) {
  const target = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    target.pathname !== "/pingufunk_qa"
  )
    throw Error("Disposable loopback PostgreSQL required");
}
let directory: string | undefined;
let disconnect: (() => Promise<void>) | undefined;
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  await disconnect?.();
  stop = undefined;
  disconnect = undefined;
  delete (globalThis as { prisma?: unknown }).prisma;
  delete (globalThis as { youtubeCatalogueRuntime?: unknown }).youtubeCatalogueRuntime;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !pgEnabled)(
    `preserves generation-bound configuration, paged index, child ownership and zero jobs on real ${provider}`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-p172-catalogue-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p17_catalogue");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      for (const key of Object.values(CREDENTIAL_ENV)) {
        vi.stubEnv(key, undefined);
        vi.stubEnv(`${key}_FILE`, undefined);
      }
      const migrated = spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
        env: process.env,
        encoding: "utf8",
        timeout: 30000,
      });
      expect(migrated.status).toBe(0);
      vi.resetModules();
      let { prisma } = await import("../src/lib/db");
      disconnect = () => prisma.$disconnect();
      await prisma.config.deleteMany();
      await prisma.download.deleteMany();
      const fixture = path.join(directory, "metadata.json");
      const calls = path.join(directory, "calls.jsonl");
      const pids = path.join(directory, "pids.json");
      const executable = path.join(directory, "synthetic-ytdlp");
      const channel = "UCaaaaaaaaaaaaaaaaaaaaaa";
      writeFileSync(
        executable,
        `#!${process.execPath}
const fs=require('node:fs');const {spawn}=require('node:child_process');
const args=process.argv.slice(2);if(!args.includes('--simulate')||!args.includes('--skip-download')||!args.includes('--ignore-config'))process.exit(9);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const config=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)},'utf8'));
if(config.mode==='wait'){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},JSON.stringify({pid:process.pid,child:child.pid}));setInterval(()=>{},1000);}
else {
const url=new URL(args.at(-1));const id=url.searchParams.get('list')||url.searchParams.get('v')||url.pathname.split('/').at(-1);
const offset=Number(args[args.indexOf('--playlist-start')+1])-1;
if(config.mode==='followup'&&offset>0)process.exit(1);
if(config.mode==='invalid'){process.stdout.write('{}');process.exit(0);}
const count=config.mode==='limited'||config.mode==='capacity'?1000:101;
const entries=Array.from({length:Math.min(100,Math.max(0,count-offset))},(_,i)=>({id:String(offset+i+(config.mode==='overlap'?1000:0)).padStart(11,'0'),title:'Synthetic episode '+(offset+i),channel_id:config.mode==='foreign'?'UCbbbbbbbbbbbbbbbbbbbbbb':${JSON.stringify(channel)},duration:120,description:config.mode==='pagecapacity'?'ü'.repeat(8000):config.mode==='capacity'?'x'.repeat(8000):'Synthetic metadata',upload_date:'20260228'}));
if(config.mode==='missing')delete entries[0].id;
if(config.mode==='success'&&offset===100)entries.push({availability:'private',id:null,title:'[Private video]'});
process.stdout.write(JSON.stringify({id,channel_id:${JSON.stringify(channel)},channel:'Synthetic channel',title:'Synthetic programme',entries}));
}
`,
        { mode: 0o755 }
      );
      const mode = (value: string) => writeFileSync(fixture, JSON.stringify({ mode: value }));
      mode("success");
      await prisma.config.createMany({
        data: [
          { key: "download.ytdlpPath", value: executable },
          { key: "legacy.retained", value: "unchanged" },
        ],
      });
      const fetch = vi.fn(async () => {
        throw Error("No network in metadata fixture");
      });
      vi.stubGlobal("fetch", fetch);
      let api = await import("../src/app/api/youtube/catalogue/route");
      let service = await import("../src/services/youtube-catalogue");
      stop = () => service.stopYoutubeCatalogueRefresh();
      const post = (
        body: unknown,
        headers: Record<string, string> = { "X-Pingufunk-Catalogue": "1" }
      ) =>
        api.POST(
          new NextRequest("http://localhost/api/youtube/catalogue", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
          })
        );
      const snapshot = async () => {
        const response = await api.GET(new NextRequest("http://localhost/api/youtube/catalogue"));
        expect(response.status).toBe(200);
        return response.json() as Promise<YoutubeSnapshot>;
      };
      const page = async (n: number) => {
        const response = await api.GET(
          new NextRequest(`http://localhost/api/youtube/catalogue?page=${n}`)
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      const waitFor = async (predicate: () => Promise<boolean>) => {
        for (let i = 0; i < 250; i++) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw Error("Owned fixture did not settle");
      };
      const settled = () => waitFor(async () => !(await snapshot()).scan.state.includes("running"));
      const initial = await snapshot();
      expect(initial.enabled).toBe(false);
      expect(initial.registry.channels).toHaveLength(5);
      expect(await prisma.config.count()).toBe(2);
      expect(existsSync(calls)).toBe(false);
      expect((await post({ action: "inspect", url: "https://evil.invalid/path" })).status).toBe(
        400
      );
      expect((await post({ action: "inspect", url: channel }, {})).status).toBe(403);
      expect(
        (
          await post(
            { action: "inspect", url: channel },
            { "X-Pingufunk-Catalogue": "1", origin: "https://evil.invalid" }
          )
        ).status
      ).toBe(403);
      const checked = await post({ action: "inspect", url: channel });
      expect(checked.status).toBe(200);
      expect((await checked.json()).channelId).toBe(channel);
      const callCount = () =>
        existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
      const beforeSave = callCount();
      expect(
        (
          await api.POST(
            new NextRequest("http://localhost/api/youtube/catalogue", {
              method: "POST",
              headers: { "X-Pingufunk-Catalogue": "1" },
              body: " ".repeat(1024 * 1024) + '{"action":"cancel"}',
            })
          )
        ).status
      ).toBe(400);
      const submitted: YoutubeSave = {
        action: "save",
        revision: initial.revision,
        enabled: true,
        registry: structuredClone(initial.registry),
      };
      submitted.registry.channels.push({ id: channel, name: "Synthetic channel", enabled: true });
      submitted.registry.programMappings.push({
        kind: "series",
        channelId: channel,
        sourceId: "PLabcdefghijklm",
        name: "Synthetic programme",
        targetId: 42,
        enabled: true,
      });
      const saved = await post(submitted);
      expect(saved.status).toBe(200);
      let current = confirmedYoutubeSave(await saved.json(), submitted);
      expect(callCount()).toBe(beforeSave);
      expect(await prisma.download.count()).toBe(0);
      expect((await post(submitted)).status).toBe(409);
      expect((await snapshot()).revision).toBe(current.revision);
      // Second native statement fails: neither registry nor switch may partially commit.
      const fault =
        provider === "sqlite"
          ? `CREATE TRIGGER p17_reject_enable BEFORE UPDATE ON Config WHEN NEW.key='provider.youtube.enabled' BEGIN SELECT RAISE(ABORT,'synthetic'); END`
          : `ALTER TABLE "Config" ADD CONSTRAINT p17_reject_enable CHECK (key <> 'provider.youtube.enabled' OR value <> 'false') NOT VALID`;
      await prisma.$executeRawUnsafe(fault);
      try {
        const failed = await post({ ...submitted, revision: current.revision, enabled: false });
        expect(failed.status).toBe(500);
        expect((await failed.json()).committed).toBe("unknown");
        expect((await snapshot()).revision).toBe(current.revision);
      } finally {
        await prisma.$executeRawUnsafe(
          provider === "sqlite"
            ? "DROP TRIGGER p17_reject_enable"
            : `ALTER TABLE "Config" DROP CONSTRAINT p17_reject_enable`
        );
      }
      // Two same-generation writers must never both confirm a replacement.
      const concurrent = await Promise.all([
        post({ ...submitted, revision: current.revision }),
        post({ ...submitted, revision: current.revision }),
      ]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
      current = await snapshot();
      const transaction = prisma.$transaction.bind(prisma);
      const lost = vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (
        ...args: unknown[]
      ) => {
        await (transaction as (...args: unknown[]) => Promise<unknown>)(...args);
        throw Error("Synthetic lost acknowledgement");
      }) as typeof prisma.$transaction);
      try {
        const unknown = await post({ ...submitted, revision: current.revision });
        expect(unknown.status).toBe(500);
        expect((await unknown.json()).committed).toBe("unknown");
      } finally {
        lost.mockRestore();
      }
      const resolved = await snapshot();
      expect(resolved.revision).not.toBe(current.revision);
      expect(resolved.registry).toEqual(submitted.registry);
      current = resolved;
      expect((await post({ action: "refresh", revision: current.revision })).status).toBe(202);
      await settled();
      current = await snapshot();
      expect(current.scan.state).toBe("complete");
      expect(current.scan.batches).toBe(2);
      expect(current.scan.entries).toBe(102);
      let first = await page(0);
      const second = await page(1);
      expect(first.items).toHaveLength(100);
      expect(second.items).toHaveLength(2);
      expect(first.count).toBe(102);
      expect(first.items[0].content).toMatchObject({
        duration: 120,
        size: 0,
        url_video: "",
        url_video_hd: "",
        url_video_low: "",
        contentDates: { providerDay: "2026-02-28" },
      });
      expect(second.items[1]).toMatchObject({
        videoId: null,
        channelId: null,
        availability: "unavailable",
        content: null,
      });
      expect((await post({ action: "refresh", revision: current.revision })).status).toBe(409);
      let oldPages = await prisma.config.findMany({
        where: { key: { startsWith: `${YOUTUBE_INDEX_KEY}.page.` } },
        orderBy: { key: "asc" },
      });
      const age = async () => {
        const row = await prisma.config.findUniqueOrThrow({ where: { key: YOUTUBE_INDEX_KEY } });
        const manifest = JSON.parse(row.value);
        manifest.attemptedAt = Date.now() - 6 * 60 * 60 * 1000 - 1;
        await prisma.config.update({
          where: { key: YOUTUBE_INDEX_KEY },
          data: { value: JSON.stringify(manifest) },
        });
      };
      const firstSeen = first.items[0].content.filmlisteTimestamp;
      const future = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 60 * 1000 + 2000);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let publishing = false;
      let transactions = 0;
      const delayed = vi.spyOn(prisma, "$transaction").mockImplementation((async (
        ...args: unknown[]
      ) => {
        if (++transactions === 2) {
          publishing = true;
          await held;
        }
        return (transaction as (...args: unknown[]) => Promise<unknown>)(...args);
      }) as typeof prisma.$transaction);
      try {
        expect((await post({ action: "refresh", revision: current.revision })).status).toBe(202);
        await waitFor(async () => publishing);
        expect((await snapshot()).scan.state).toBe("running");
        release();
        await settled();
      } finally {
        release();
        delayed.mockRestore();
        future.mockRestore();
      }
      first = await page(0);
      expect(first.items[0].content.filmlisteTimestamp).toBe(firstSeen);
      expect(first.items[0].content.contentDates.catalogueUpdatedAt).toBeGreaterThan(firstSeen);
      oldPages = await prisma.config.findMany({
        where: { key: { startsWith: `${YOUTUBE_INDEX_KEY}.page.` } },
        orderBy: { key: "asc" },
      });
      const rejectPage =
        provider === "sqlite"
          ? `CREATE TRIGGER p17_reject_page BEFORE INSERT ON Config WHEN NEW.key LIKE 'internal.youtube.catalogue.v1.page.%' BEGIN SELECT RAISE(ABORT,'synthetic'); END`
          : `ALTER TABLE "Config" ADD CONSTRAINT p17_reject_page CHECK (key NOT LIKE 'internal.youtube.catalogue.v1.page.%') NOT VALID`;
      await prisma.$executeRawUnsafe(rejectPage);
      try {
        await age();
        expect((await post({ action: "refresh", revision: current.revision })).status).toBe(202);
        await settled();
        expect((await snapshot()).scan.state).toBe("failed");
        expect(
          await prisma.config.findMany({
            where: { key: { startsWith: `${YOUTUBE_INDEX_KEY}.page.` } },
            orderBy: { key: "asc" },
          })
        ).toEqual(oldPages);
      } finally {
        await prisma.$executeRawUnsafe(
          provider === "sqlite"
            ? "DROP TRIGGER p17_reject_page"
            : `ALTER TABLE "Config" DROP CONSTRAINT p17_reject_page`
        );
      }
      for (const failure of [
        "followup",
        "foreign",
        "missing",
        "invalid",
        "limited",
        "capacity",
        "pagecapacity",
      ]) {
        await age();
        mode(failure);
        const count = callCount();
        expect((await post({ action: "refresh", revision: current.revision })).status).toBe(202);
        if (failure === "pagecapacity") {
          const read = prisma.config.findUnique.bind(prisma.config);
          let captured = false;
          let release = () => {};
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          const delayedRead = vi.spyOn(prisma.config, "findUnique").mockImplementation((async (
            ...args: unknown[]
          ) => {
            const row = await (read as (...args: unknown[]) => Promise<{ value: string } | null>)(
              ...args
            );
            const request = args[0] as { where?: { key?: string } };
            if (
              !captured &&
              request.where?.key === YOUTUBE_INDEX_KEY &&
              row &&
              JSON.parse(row.value).scan.state === "running"
            ) {
              captured = true;
              await held;
            }
            return row;
          }) as typeof prisma.config.findUnique);
          const pending = snapshot();
          try {
            await waitFor(async () => captured);
            await waitFor(async () => {
              const row = await read({ where: { key: YOUTUBE_INDEX_KEY } });
              return !!row && JSON.parse(row.value).scan.state === "limited";
            });
            await service.cancelYoutubeCatalogue();
            release();
            expect((await pending).scan.state).toBe("limited");
          } finally {
            release();
            await pending;
            delayedRead.mockRestore();
          }
          const previous = await read({ where: { key: YOUTUBE_INDEX_KEY } });
          const foreignAttempt = JSON.parse(previous!.value);
          foreignAttempt.token = "00000000-0000-4000-8000-000000000001";
          foreignAttempt.scan.state = "running";
          await prisma.config.update({
            where: { key: YOUTUBE_INDEX_KEY },
            data: { value: JSON.stringify(foreignAttempt) },
          });
          expect((await snapshot()).scan.state).toBe("interrupted");
          await prisma.config.update({
            where: { key: YOUTUBE_INDEX_KEY },
            data: { value: previous!.value },
          });
        }
        await settled();
        const result = await snapshot();
        expect(result.scan.state).toBe(
          ["limited", "capacity", "pagecapacity"].includes(failure) ? "limited" : "failed"
        );
        if (failure === "capacity") expect(result.scan.message).toContain("8 MiB");
        if (failure === "pagecapacity") expect(result.scan.message).toContain("1 MiB");
        expect(
          await prisma.config.findMany({
            where: { key: { startsWith: `${YOUTUBE_INDEX_KEY}.page.` } },
            orderBy: { key: "asc" },
          })
        ).toEqual(oldPages);
        expect(callCount() - count).toBeLessThanOrEqual(10);
        expect((await page(0)).items).toEqual(first.items);
      }
      await age();
      mode("wait");
      expect((await post({ action: "refresh", revision: current.revision })).status).toBe(202);
      await waitFor(async () => existsSync(pids));
      const children = JSON.parse(readFileSync(pids, "utf8"));
      expect((await post({ action: "refresh", revision: current.revision })).status).toBe(409);
      const disabled = await post({ ...submitted, revision: current.revision, enabled: false });
      expect(disabled.status).toBe(200);
      await service.cancelYoutubeCatalogue();
      await waitFor(async () => {
        try {
          process.kill(children.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      await waitFor(async () => {
        try {
          process.kill(children.child, 0);
          return false;
        } catch {
          return true;
        }
      });
      expect((await snapshot()).enabled).toBe(false);
      expect((await page(0)).current).toBe(false);
      expect(await prisma.download.count()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        await prisma.config.findUniqueOrThrow({ where: { key: "legacy.retained" } })
      ).toMatchObject({ value: "unchanged" });
      const settings = await import("../src/app/api/settings/route");
      expect(
        await (await settings.GET(new NextRequest("http://localhost/api/settings"))).json()
      ).not.toHaveProperty(YOUTUBE_INDEX_KEY);
      expect(
        (
          await settings.GET(
            new NextRequest(`http://localhost/api/settings?key=${YOUTUBE_REGISTRY_KEY}`)
          )
        ).status
      ).toBe(404);
      expect(
        (
          await settings.POST(
            new NextRequest("http://localhost/api/settings", {
              method: "POST",
              body: JSON.stringify({ key: YOUTUBE_ENABLED_KEY, value: "true" }),
            })
          )
        ).status
      ).toBe(400);
      await service.stopYoutubeCatalogueRefresh();
      await prisma.$disconnect();
      delete (globalThis as { prisma?: unknown }).prisma;
      delete (globalThis as { youtubeCatalogueRuntime?: unknown }).youtubeCatalogueRuntime;
      vi.resetModules();
      ({ prisma } = await import("../src/lib/db"));
      disconnect = () => prisma.$disconnect();
      api = await import("../src/app/api/youtube/catalogue/route");
      service = await import("../src/services/youtube-catalogue");
      stop = () => service.stopYoutubeCatalogueRefresh();
      expect((await snapshot()).enabled).toBe(false);
      expect((await page(0)).items).toEqual(first.items);
      // One video may appear in two programme playlists; its first observation is global.
      const overlapping = structuredClone(submitted);
      overlapping.revision = (await snapshot()).revision;
      overlapping.registry.programMappings.push({
        ...overlapping.registry.programMappings.at(-1)!,
        sourceId: "PLoverlapping123",
      });
      expect((await post(overlapping)).status).toBe(200);
      mode("overlap");
      await age();
      const baseTime = Date.now();
      const baseCalls = callCount();
      const advancing = vi
        .spyOn(Date, "now")
        .mockImplementation(() => baseTime + (callCount() - baseCalls) * 2000);
      try {
        const revision = (await snapshot()).revision;
        expect((await post({ action: "refresh", revision })).status).toBe(202);
        await settled();
        expect((await snapshot()).scan.state).toBe("complete");
        const entries = [
          ...(await page(0)).items,
          ...(await page(1)).items,
          ...(await page(2)).items,
        ];
        const copies = entries.filter((row) => row.videoId === "00000001000");
        expect(copies).toHaveLength(2);
        const earliest = copies[0].content.filmlisteTimestamp;
        expect(copies[1].content.filmlisteTimestamp).toBe(earliest);
        await age();
        expect((await post({ action: "refresh", revision })).status).toBe(202);
        await settled();
        const refreshed = [
          ...(await page(0)).items,
          ...(await page(1)).items,
          ...(await page(2)).items,
        ];
        expect(
          refreshed
            .filter((row) => row.videoId === "00000001000")
            .map((row) => row.content.filmlisteTimestamp)
        ).toEqual([earliest, earliest]);
        expect(await prisma.download.count()).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        advancing.mockRestore();
      }
      await prisma.config.update({
        where: { key: YOUTUBE_REGISTRY_KEY },
        data: { value: "invalid private registry" },
      });
      const { withSettingsSnapshot } = await import("../src/lib/settings");
      expect(await withSettingsSnapshot(async () => "unrelated search remains independent")).toBe(
        "unrelated search remains independent"
      );
      expect(
        (await api.GET(new NextRequest("http://localhost/api/youtube/catalogue"))).status
      ).toBe(503);
      await prisma.config.deleteMany();
    },
    90000
  );
