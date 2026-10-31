import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import lintStaged from "lint-staged";
import { ESLint, Linter } from "eslint";
import { pathToFileURL } from "node:url";

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
  it("keeps callable CommonJS and named ESM matching consistent", async () => {
    const legacy = require("minimatch");
    const modern = await import(
      pathToFileURL(path.join(path.dirname(require.resolve("minimatch")), "index.mjs")).href
    );
    expect(modern.default).toBe(legacy);
    expect(modern.minimatch).toBe(legacy);
    expect(modern.Minimatch).toBe(legacy.Minimatch);
    for (const matches of [legacy, modern.minimatch]) {
      expect(matches("src/nested/view.tsx", "**/*.{ts,tsx}")).toBe(true);
      expect(matches("src/nested/view.css", "**/*.{ts,tsx}")).toBe(false);
    }
  });

  it("preserves ESLint file selection, extglobs, dot directories and global ignores", async () => {
    const cwd = fixture();
    for (const directory of ["src", ".hidden", "ignored"]) {
      mkdirSync(path.join(cwd, directory));
      for (const name of ["a", "b", "c"])
        writeFileSync(path.join(cwd, directory, name + ".js"), "debugger;");
    }
    const linter = new ESLint({
      cwd,
      overrideConfigFile: true,
      overrideConfig: [
        { ignores: ["ignored/**"] },
        { files: ["**/*.{js,jsx}"], rules: { "no-debugger": "error" } },
      ],
    });
    const results = await linter.lintFiles(["**/@(a|b).js"]);
    expect(results.map((result) => path.relative(cwd, result.filePath)).sort()).toEqual([
      ".hidden/a.js",
      ".hidden/b.js",
      "src/a.js",
      "src/b.js",
    ]);
    for (const result of results)
      expect(result.messages.map((message) => message.ruleId)).toEqual(["no-debugger"]);
  });

  it("applies actual project rules to JavaScript tools within their registered language scope", async () => {
    const linter = new ESLint();
    const results = await linter.lintText('const view = <img src="/fixture.png"/>;', {
      filePath: "tools/minimatch-compat/fixture.mjs",
    });
    const rules = results[0].messages.map((message) => message.ruleId);
    expect(rules).toContain("jsx-a11y/alt-text");
    expect(rules).toContain("@next/next/no-img-element");
  });

  it("retains React name exceptions without allowing other invalid component names", () => {
    const messages = new Linter().verify("const view = <><Bad_name/><Legacy_bad/><GoodName/></>;", [
      {
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { react: require("eslint-plugin-react") },
        rules: { "react/jsx-pascal-case": ["error", { ignore: ["Legacy_*"] }] },
      },
    ]);
    expect(messages.map((message) => message.ruleId)).toEqual(["react/jsx-pascal-case"]);
    expect(messages[0].message).toContain("Bad_name");
  });

  it("keeps React render-prop glob permission distinct from unstable nested components", () => {
    const messages = new Linter().verify(
      "function Parent() { return <List renderFooter={() => <span/>} drawFooter={() => <span/>}/>; }",
      [
        {
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { react: require("eslint-plugin-react") },
          rules: { "react/no-unstable-nested-components": "error" },
        },
      ]
    );
    expect(messages.map((message) => message.ruleId)).toEqual([
      "react/no-unstable-nested-components",
    ]);
  });

  it("keeps custom accessibility controls subject to an actual label", () => {
    const messages = new Linter().verify(
      "const view = <><label><FieldOne/></label><label>Name<FieldOne/></label></>;",
      [
        {
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { a11y: require("eslint-plugin-jsx-a11y") },
          rules: {
            "a11y/label-has-associated-control": [
              "error",
              { assert: "either", controlComponents: ["Field*"] },
            ],
          },
        },
      ]
    );
    expect(messages.map((message) => message.ruleId)).toEqual([
      "a11y/label-has-associated-control",
    ]);
  });

  it.each(["allow", "forbid"] as const)(
    "preserves import path %s rules through their compiled test consumer",
    (mode) => {
      const cwd = fixture();
      for (const directory of ["public", "private"]) {
        mkdirSync(path.join(cwd, directory));
        writeFileSync(path.join(cwd, directory, "api.js"), "export const value = 1;");
      }
      const messages = new Linter({ cwd }).verify(
        'import "./public/api.js"; import "./private/api.js";',
        [
          {
            plugins: { import: require("eslint-plugin-import") },
            rules: {
              "import/no-internal-modules": [
                "error",
                mode === "allow" ? { allow: ["**/public/**"] } : { forbid: ["**/private/**"] },
              ],
            },
          },
        ],
        { filename: path.join(cwd, "entry.js") }
      );
      expect(messages.map((message) => message.ruleId)).toEqual(["import/no-internal-modules"]);
      expect(messages[0].message).toContain("./private/api.js");
    }
  );

  it("bounds globparts amplification while retaining positive and negative matches", () => {
    const result = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=64",
        "-e",
        `const {Minimatch} = require("minimatch");
        const pattern = Array(24).fill("**/../a/b").join("/");
        const value = Array(24).fill("../a/b").join("/");
        const matcher = new Minimatch(pattern, {optimizationLevel: 2, braceExpandMax: 64});
        if (matcher.set.length > 64 || !matcher.match(value) || matcher.match(value + "/wrong")) process.exit(1);`,
      ],
      { timeout: 5000 }
    );
    expect(result.toString()).toBe("");
  }, 10000);

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
    // This tests stack safety, not a 5-second performance SLA: shared CI CPUs
    // need headroom while the equally deep input and success assertions stay fixed.
    const result = execFileSync(
      process.execPath,
      [
        "-e",
        `
      const {getRootDirs} = require(${JSON.stringify(path.join(pluginDirectory, "utils/get-root-dirs.js"))});
      const pattern = ${JSON.stringify(cwd)} + '/' + '{'.repeat(12000) + 'x' + '}'.repeat(12000);
      const roots = getRootDirs({cwd: ${JSON.stringify(cwd)}, settings: {next: {rootDir: pattern}}});
      if (roots.length) process.exit(1);
    `,
      ],
      { timeout: 20000 }
    );
    expect(result.toString()).toBe("");
  }, 30000);

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
