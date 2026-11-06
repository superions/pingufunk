import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { disposeOwned } from "./arr-test-instances.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const parent = resolve("downloads");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "arr-qa."));
  roots.push(root);
  const owner = "12345-67890";
  const network = `pingufunk-arr-${owner}`;
  const apps = Object.fromEntries(
    ["pingufunk", "sonarr"].map((app) => [
      app,
      { name: `pingufunk-arr-${app}-${owner}`, image: `image-${app}` },
    ])
  );
  const manifest = { owner, network, apps, youtube: true };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
  const names = [apps.pingufunk.name, apps.sonarr.name, `pingufunk-arr-youtube-rollback-${owner}`];
  const containers = new Map(
    names.map((name, i) => [
      String(i),
      {
        Name: `/${name}`,
        Image: i === 2 ? "rollback-image" : Object.values(apps)[i].image,
        Config: { Labels: { "pingufunk.arr-qa.owner": owner } },
      },
    ])
  );
  let networkPresent = true;
  let foreignNetworkMember = false;
  const docker = (args: string[]) => {
    if (args[0] === "ps") {
      const name = args[3].slice("name=^/".length, -1);
      return [...containers].find(([, item]) => item.Name === `/${name}`)?.[0] ?? "";
    }
    if (args[0] === "inspect") return JSON.stringify([containers.get(args[1])]);
    if (args[0] === "rm") {
      expect(args.slice(0, 3)).toEqual(["rm", "--force", "--volumes"]);
      containers.delete(args[3]);
      return args[3];
    }
    if (args[0] === "network" && args[1] === "ls") return networkPresent ? network : "";
    if (args[0] === "network" && args[1] === "inspect")
      return JSON.stringify([
        {
          Internal: true,
          Labels: { "pingufunk.arr-qa.owner": owner },
          Containers: foreignNetworkMember ? { foreign: {} } : {},
        },
      ]);
    if (args[0] === "network" && args[1] === "rm") {
      networkPresent = false;
      return network;
    }
    throw Error(`Unexpected fake Docker command: ${args.join(" ")}`);
  };
  return {
    root,
    manifest,
    containers,
    docker,
    setForeignNetworkMember: () => (foreignNetworkMember = true),
  };
}

describe("owned Arr fixture cleanup", () => {
  it("removes the test containers, rollback container, network and fixture", () => {
    const f = fixture();
    disposeOwned(f.root, f.manifest, f.docker);
    expect(f.containers.size).toBe(0);
    expect(existsSync(f.root)).toBe(false);
  });

  it("never removes a container whose owner label changed", () => {
    const f = fixture();
    f.containers.get("1")!.Config.Labels["pingufunk.arr-qa.owner"] = "foreign";
    expect(() => disposeOwned(f.root, f.manifest, f.docker)).toThrow("cleanup incomplete");
    expect(f.containers.has("1")).toBe(true);
    expect(existsSync(f.root)).toBe(true);
  });

  it("retains the fixture if a foreign container is attached to its network", () => {
    const f = fixture();
    f.setForeignNetworkMember();
    expect(() => disposeOwned(f.root, f.manifest, f.docker)).toThrow("cleanup incomplete");
    expect(existsSync(f.root)).toBe(true);
  });
});
