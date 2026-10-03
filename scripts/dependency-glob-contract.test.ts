import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import lintStaged from "lint-staged";
import { Linter } from "eslint";

const require = createRequire(import.meta.url);
const pluginDirectory = path.dirname(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = require(path.join(pluginDirectory, "utils/get-root-dirs.js"));
const fixtures: string[] = [];

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "pingufunk-glob-"));
  fixtures.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true });
});

describe("installed development glob consumers", () => {
  it("preserves Next rootDir defaults, directory-only braces, extglobs and arrays", () => {
    const cwd = fixture();
    for (const name of ["web", "admin", "other", ".hidden"]) {
      mkdirSync(path.join(cwd, "apps", name), { recursive: true });
    }
    writeFileSync(path.join(cwd, "apps", "file"), "not a directory");
    const roots = (rootDir?: string | unknown[]) =>
      getRootDirs({ cwd, settings: { next: { rootDir } } })
        .map((directory: string) => path.resolve(directory))
        .sort();
    const selected = [path.join(cwd, "apps/admin"), path.join(cwd, "apps/web")];
    expect(roots()).toEqual([cwd]);
    expect(roots(`${cwd}/apps/{web,admin}`)).toEqual(selected);
    expect(roots(`${cwd}/apps/@(web|admin)`)).toEqual(selected);
    expect(roots([`${cwd}/apps/web`, `${cwd}/apps/admin`, 42])).toEqual(selected);
    expect(roots(`${cwd}/apps/*`)).toEqual([...selected, path.join(cwd, "apps/other")].sort());
    expect(roots(`${cwd}/missing/*`)).toEqual([]);
  });

  it("keeps the actual Next link rule active for discovered pages and app routes", () => {
    const cwd = fixture();
    mkdirSync(path.join(cwd, "apps/web/pages"), { recursive: true });
    mkdirSync(path.join(cwd, "apps/admin/app"), { recursive: true });
    writeFileSync(path.join(cwd, "apps/web/pages/about.js"), "export default function Page() {}");
    writeFileSync(path.join(cwd, "apps/admin/app/page.js"), "export default function Page() {}");
    const linter = new Linter();
    const plugin = require("@next/eslint-plugin-next");
    const messages = linter.verify(
      'const view = <><a href="/about">About</a><a href="/">Home</a><a href="https://example.invalid">External</a><a href="/unknown">Unknown</a></>;',
      [
        {
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { next: plugin },
          settings: { next: { rootDir: `${cwd}/apps/{web,admin}` } },
          rules: { "next/no-html-link-for-pages": "error" },
        },
      ]
    );
    expect(messages.map((message) => message.ruleId)).toEqual([
      "next/no-html-link-for-pages",
      "next/no-html-link-for-pages",
    ]);
    expect(messages[0].message).toContain("/about/");
    expect(messages[1].message).toContain("`/`");
  });

  it("does not exhaust the stack on deeply nested braces in the real Next consumer", () => {
    const cwd = fixture();
    const pattern = `${cwd}/${"{".repeat(12000)}x${"}".repeat(12000)}`;
    // Run the installed consumer in a bounded child, not a mock or source-string check.
    const result = execFileSync(
      process.execPath,
      [
        "-e",
        `
      const {getRootDirs} = require(${JSON.stringify(path.join(pluginDirectory, "utils/get-root-dirs.js"))});
      const roots = getRootDirs({cwd: ${JSON.stringify(cwd)}, settings: {next: {rootDir: ${JSON.stringify(pattern)}}}});
      if (roots.length) process.exit(1);
    `,
      ],
      { timeout: 5000 }
    );
    expect(result.toString()).toBe("");
  });

  it("retains staged-file selection for the shipped hook patterns without touching this checkout", async () => {
    const cwd = fixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd });
    git("init", "--quiet");
    git("config", "user.name", "Synthetic fixture");
    git("config", "user.email", "fixture@example.invalid");
    mkdirSync(path.join(cwd, "src/nested"), { recursive: true });
    const files = [
      "src/nested/a.ts",
      "src/b.tsx",
      "config.json",
      "src/style.css",
      "README.md",
      "src/plain.js",
    ];
    for (const file of files) writeFileSync(path.join(cwd, file), "initial");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
    for (const file of files) writeFileSync(path.join(cwd, file), "changed");
    git("add", ".");
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const selected: Record<string, string[]> = {};
    const config = Object.fromEntries(
      Object.keys(manifest["lint-staged"]).map((pattern) => [
        pattern,
        (matched: readonly string[]) => {
          selected[pattern] = matched.map((file) => path.relative(cwd, file)).sort();
          return `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
        },
      ])
    );
    expect(await lintStaged({ cwd, config, stash: false, quiet: true })).toBe(true);
    expect(selected).toEqual({
      "*.{ts,tsx}": ["src/b.tsx", "src/nested/a.ts"],
      "*.{json,css}": ["config.json", "src/style.css"],
    });
  });
});
