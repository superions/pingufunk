const [tag, expected] = process.argv.slice(2);
if (!/^(?:main|sha-[0-9a-f]{40})$/.test(tag ?? "")) throw Error("Invalid image tag");
if (!/^sha256:[0-9a-f]{64}$/.test(expected ?? "")) throw Error("Invalid image identity");
if (!process.env.PUBLIC_GHCR_TOKEN) throw Error("The GHCR token is required");

const scope = "repository:superions/pingufunk:pull";
const tokenUrl = new URL("https://ghcr.io/token");
tokenUrl.searchParams.set("service", "ghcr.io");
tokenUrl.searchParams.set("scope", scope);
const tokenResponse = await fetch(tokenUrl, {
  headers: {
    Authorization: `Basic ${Buffer.from(`superions:${process.env.PUBLIC_GHCR_TOKEN}`).toString("base64")}`,
  },
  signal: AbortSignal.timeout(15000),
});
if (!tokenResponse.ok) throw Error(`Cannot authenticate to GHCR: HTTP ${tokenResponse.status}`);
const token = (await tokenResponse.json()).token;
if (!token) throw Error("GHCR did not issue a read token");
const response = await fetch(`https://ghcr.io/v2/superions/pingufunk/manifests/${tag}`, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept:
      "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
  },
  signal: AbortSignal.timeout(15000),
});
if (response.status === 404) process.exit(3);
if (!response.ok) throw Error(`Cannot read GHCR manifest: HTTP ${response.status}`);
const manifest = await response.json();
if (manifest.config?.digest !== expected)
  throw Error("Published image differs from the tested image");
const digest = response.headers.get("docker-content-digest");
if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? "")) throw Error("GHCR did not return an image digest");
console.log(digest);
