const base = new URL(process.env.GITHUB_SERVER_URL);
if (base.protocol !== "https:") throw Error("Forgejo must use HTTPS");
const [owner, repo, extra] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
if (!owner || !repo || extra) throw Error("Invalid source repository");
if (!process.env.FORGEJO_TOKEN) throw Error("The Forgejo job token is required");
if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? ""))
  throw Error("A full source commit is required");
const url = new URL(
  `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/main`,
  base
);
const response = await fetch(url, {
  headers: { Authorization: `token ${process.env.FORGEJO_TOKEN}` },
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw Error(`Cannot verify Forgejo main: HTTP ${response.status}`);
const branch = await response.json();
if (branch.commit?.id !== process.env.GITHUB_SHA)
  throw Error("Forgejo main moved since this run began");
