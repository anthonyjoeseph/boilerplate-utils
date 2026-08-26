/**
 * Resolution tests for callees that live in an npm dependency.
 *
 * The behavioral specs under `tests/spec` are deliberately hermetic — only
 * relative imports resolve there — so nothing else covers the path a real user
 * hits first: a monorepo package importing from `node_modules`, where the
 * callee's body is several hops away from anything the editor can see.
 *
 * Each fixture below is a published-package layout written to a temp dir, and
 * every one of them is driven with `workspaceRoot` set to the REPO ROOT (as VS
 * Code reports it), not the package — the dependency is only reachable from the
 * importing file's own `node_modules`, as under pnpm.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as vscode from "vscode";

import { handleSmartInline, type VscodeApi } from "../src/commandHandlers";
import { runSmartInline, selectionOffsets } from "../src/commandRunners";
import { createMockEditor, createMockVscode } from "./mockVscode";

let repoRoot: string;

/** Write `files` (path relative to `dir`) to disk, creating directories. */
function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

/** A source map whose only job is to name the file it was generated from. */
function mapTo(file: string, source: string): string {
  return JSON.stringify({
    version: 3,
    file,
    sourceRoot: "",
    sources: [source],
    names: [],
    mappings: "AAAA"
  });
}

/** Inline the call marked by `selection` in `<app>/main.ts`. */
async function inlineInApp(app: string, selection: string) {
  const fileName = path.join(repoRoot, app, "main.ts");
  const sourceText = fs.readFileSync(fileName, "utf8");
  const { start, end } = selectionOffsets(sourceText, selection);
  return runSmartInline({
    sourceText,
    start,
    end,
    fileName,
    // The workspace folder, i.e. the monorepo root — not the app package.
    workspaceRoot: repoRoot,
    scriptKind: "ts"
  });
}

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smart-inline-"));

  // The monorepo root: a package.json, and deliberately no tsconfig.json.
  writeFiles(repoRoot, { "package.json": '{ "name": "monorepo-root" }' });

  // typed-app: dependency ships .d.ts + declarationMap, and no .js source map.
  writeFiles(path.join(repoRoot, "typed-app"), {
    "package.json": '{ "name": "typed-app" }',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true
      }
    }),
    "main.ts": [
      'import { double, needy, thirsty } from "typed-pkg";',
      "",
      "export const x = double(21);",
      "export const y = needy(4);",
      "export const z = thirsty(4);",
      ""
    ].join("\n"),
    "node_modules/typed-pkg/package.json": JSON.stringify({
      name: "typed-pkg",
      version: "1.0.0",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      // Only the entry point is published: nothing else is importable by name.
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }
    }),
    "node_modules/typed-pkg/src/index.ts":
      'export { double } from "./inner";\nexport { needy } from "./needy";\nexport { thirsty } from "./thirsty";\n',
    "node_modules/typed-pkg/dist/needy.js": 'var secret_1 = require("./secret");\nexports.needy = function (n) { return secret_1.secret(n) + 1; };\n',
    "node_modules/typed-pkg/dist/secret.js": "exports.secret = function (n) { return n * 10; };\n",
    "node_modules/typed-pkg/src/inner.ts":
      "export function double(n: number): number {\n  return n * 2;\n}\n",
    "node_modules/typed-pkg/dist/index.js":
      'var inner_1 = require("./inner");\nexports.double = inner_1.double;\n',
    "node_modules/typed-pkg/dist/index.d.ts":
      'export { double } from "./inner";\nexport { needy } from "./needy";\nexport { thirsty } from "./thirsty";\n//# sourceMappingURL=index.d.ts.map\n',
    "node_modules/typed-pkg/dist/index.d.ts.map": mapTo("index.d.ts", "../src/index.ts"),
    "node_modules/typed-pkg/dist/inner.d.ts":
      "export declare function double(n: number): number;\n//# sourceMappingURL=inner.d.ts.map\n",
    "node_modules/typed-pkg/dist/inner.d.ts.map": mapTo("inner.d.ts", "../src/inner.ts"),

    // A second export whose body leans on a module the package does not publish.
    "node_modules/typed-pkg/src/needy.ts":
      'import { secret } from "./secret";\n\nexport function needy(n: number): number {\n  return secret(n) + 1;\n}\n',
    "node_modules/typed-pkg/src/secret.ts":
      "export function secret(n: number): number {\n  return n * 10;\n}\n",
    "node_modules/typed-pkg/dist/needy.d.ts":
      "export declare function needy(n: number): number;\n//# sourceMappingURL=needy.d.ts.map\n",
    "node_modules/typed-pkg/dist/needy.d.ts.map": mapTo("needy.d.ts", "../src/needy.ts"),

    // A third export that leans on a package typed-app has not installed.
    "node_modules/typed-pkg/src/thirsty.ts":
      'import { helper } from "absent-pkg";\n\nexport function thirsty(n: number): number {\n  return helper(n);\n}\n',
    "node_modules/typed-pkg/dist/thirsty.d.ts":
      "export declare function thirsty(n: number): number;\n//# sourceMappingURL=thirsty.d.ts.map\n",
    "node_modules/typed-pkg/dist/thirsty.d.ts.map": mapTo("thirsty.d.ts", "../src/thirsty.ts")
  });

  // mapped-app: no tsconfig (so the LanguageService cannot resolve the import),
  // dependency ships a .js source map pointing at a barrel that re-exports.
  writeFiles(path.join(repoRoot, "mapped-app"), {
    "package.json": '{ "name": "mapped-app" }',
    "main.ts": ['import { triple } from "mapped-pkg";', "", "export const x = triple(5);", ""].join(
      "\n"
    ),
    "node_modules/mapped-pkg/package.json": JSON.stringify({
      name: "mapped-pkg",
      version: "1.0.0",
      main: "./dist/index.js"
    }),
    "node_modules/mapped-pkg/src/index.ts": 'export * from "./inner";\n',
    "node_modules/mapped-pkg/src/inner.ts":
      "export function triple(n: number): number {\n  return n * 3;\n}\n",
    "node_modules/mapped-pkg/dist/index.js":
      'var inner_1 = require("./inner");\nexports.triple = inner_1.triple;\n//# sourceMappingURL=index.js.map\n',
    "node_modules/mapped-pkg/dist/index.js.map": mapTo("index.js", "../src/index.ts")
  });

  // wildcard-app: dependency publishes its internals through an `exports`
  // wildcard, the way rxjs publishes `rxjs/internal/*`.
  writeFiles(path.join(repoRoot, "wildcard-app"), {
    "package.json": '{ "name": "wildcard-app" }',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true
      }
    }),
    "main.ts": ['import { scaled } from "wildcard-pkg";', "", "export const x = scaled(2);", ""].join(
      "\n"
    ),
    "node_modules/wildcard-pkg/package.json": JSON.stringify({
      name: "wildcard-pkg",
      version: "1.0.0",
      main: "./dist/cjs/index.js",
      types: "./dist/types/index.d.ts",
      exports: {
        ".": { types: "./dist/types/index.d.ts", default: "./dist/cjs/index.js" },
        "./internal/*": {
          types: "./dist/types/internal/*.d.ts",
          default: "./dist/cjs/internal/*.js"
        }
      }
    }),
    "node_modules/wildcard-pkg/src/index.ts": 'export { scaled } from "./internal/scaled";\n',
    // `offset` shares an import declaration with `factor` but is used by a
    // different export, so it must not be dragged along.
    "node_modules/wildcard-pkg/src/internal/scaled.ts":
      'import { factor, offset } from "./util/factor";\n\nexport function scaled(n: number): number {\n  return n * factor;\n}\n\nexport function shifted(n: number): number {\n  return n + offset;\n}\n',
    "node_modules/wildcard-pkg/src/internal/util/factor.ts":
      "export const factor = 3;\nexport const offset = 7;\n",
    "node_modules/wildcard-pkg/dist/cjs/index.js":
      'var scaled_1 = require("./internal/scaled");\nexports.scaled = scaled_1.scaled;\n',
    "node_modules/wildcard-pkg/dist/types/index.d.ts":
      'export { scaled } from "./internal/scaled";\n//# sourceMappingURL=index.d.ts.map\n',
    "node_modules/wildcard-pkg/dist/types/index.d.ts.map": mapTo("index.d.ts", "../../src/index.ts"),
    "node_modules/wildcard-pkg/dist/types/internal/scaled.d.ts":
      "export declare function scaled(n: number): number;\n//# sourceMappingURL=scaled.d.ts.map\n",
    "node_modules/wildcard-pkg/dist/types/internal/scaled.d.ts.map": mapTo(
      "scaled.d.ts",
      "../../../src/internal/scaled.ts"
    ),
    "node_modules/wildcard-pkg/dist/types/internal/util/factor.d.ts":
      "export declare const factor = 3;\n"
  });

  // bare-app: dependency ships nothing but transpiled JS. Nothing to inline.
  writeFiles(path.join(repoRoot, "bare-app"), {
    "package.json": '{ "name": "bare-app" }',
    "main.ts": ['import { quad } from "bare-pkg";', "", "export const x = quad(5);", ""].join("\n"),
    "node_modules/bare-pkg/package.json": JSON.stringify({
      name: "bare-pkg",
      version: "1.0.0",
      main: "./dist/index.js"
    }),
    "node_modules/bare-pkg/dist/index.js":
      "exports.quad = function (n) {\n  return n * 4;\n};\n"
  });
});

afterAll(() => {
  if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("resolving a callee in an npm dependency", () => {
  it("follows a declaration map from the package's types entry to the source", async () => {
    // dist/index.d.ts -> declaration map -> src/index.ts -> re-export -> src/inner.ts
    const result = await inlineInApp("typed-app", "double(21)");
    expect(result).toMatchObject({ ok: true, expression: "42" });
  });

  it("follows a source map through a re-exporting barrel", async () => {
    // dist/index.js -> source map -> src/index.ts -> `export *` -> src/inner.ts
    const result = await inlineInApp("mapped-app", "triple(5)");
    expect(result).toMatchObject({ ok: true, expression: "15" });
  });

  it("rewrites an internal import to the specifier the package publishes", async () => {
    // `scaled`'s body needs `factor`, which it imports as `./util/factor`.
    // That path means nothing from the caller, but the same module is published
    // as `wildcard-pkg/internal/util/factor` — and that is what gets imported.
    const result = await inlineInApp("wildcard-app", "scaled(2)");
    expect(result).toMatchObject({ ok: true, expression: "2 * factor" });
    if (!result.ok) return;
    expect(result.neededImportTexts.join("")).toContain(
      'from "wildcard-pkg/internal/util/factor"'
    );
    expect(result.neededImportTexts.join("")).not.toContain("node_modules");
    // `offset` shares that declaration but is not part of the inlined code.
    expect(result.neededImportTexts.join("")).not.toContain("offset");
  });

  it("still inlines when the package does not publish what the body needs", async () => {
    // `needy` calls `secret`, which lives behind a relative import inside the
    // package, and typed-pkg's `exports` map publishes only its entry point.
    // The import is emitted in the form the package would publish it under —
    // not as `./node_modules/typed-pkg/src/secret`, which reaches around the
    // exports map — and reported so the caller can decide what to do.
    const result = await inlineInApp("typed-app", "needy(4)");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.neededImportTexts.join("")).toContain('from "typed-pkg/secret"');
    expect(result.unresolvedImports).toEqual([
      { specifier: "typed-pkg/secret", names: ["secret"], reason: "not-published" }
    ]);
  });

  it("still inlines when the body needs a package the caller has not installed", async () => {
    const result = await inlineInApp("typed-app", "thirsty(4)");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.neededImportTexts.join("")).toContain('from "absent-pkg"');
    expect(result.unresolvedImports).toEqual([
      { specifier: "absent-pkg", names: ["helper"], reason: "not-installed" }
    ]);
  });

  it("reports a resolution failure when the dependency ships no sources", async () => {
    const result = await inlineInApp("bare-app", "quad(5)");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('Could not resolve function declaration for "quad"')
    });
  });

  it("warns about the unresolved imports it added, and still applies the edit", async () => {
    const fileName = path.join(repoRoot, "typed-app", "main.ts");
    const sourceText = fs.readFileSync(fileName, "utf8");
    const { start, end } = selectionOffsets(sourceText, "thirsty(4)");
    const mockVscode = createMockVscode(repoRoot);
    const editor = createMockEditor(sourceText, start, end, { fileName });

    await handleSmartInline(
      mockVscode as unknown as VscodeApi,
      editor as unknown as vscode.TextEditor
    );

    expect(mockVscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(editor.edit).toHaveBeenCalled();
    expect(mockVscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('"absent-pkg" (helper) is not installed here')
    );
  });
});
