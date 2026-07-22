/**
 * Integration tests for the unified Smart Inline command
 * (`smartInlineFunction.inline`).
 *
 * There is now ONE command. It classifies what the selection points at and
 * dispatches to one of four behaviors — relocate a function body, evaluate a
 * `.map(...)`, evaluate an `Object.fromEntries(...)`, or fold an expression. These
 * tests drive the single production handler (`handleSmartInline`) with a mocked
 * vscode/editor and assert that the right behavior fires from context alone.
 *
 * The four behaviors used to be four commands with four handlers; the per-behavior
 * success paths below are ported from those retired test files. The behavior that
 * CHANGED under the merge is called out in "dispatch replaces the old per-command
 * guards": inputs that used to earn a command-specific "wrong command" error now
 * simply route to whichever behavior fits.
 */

import type * as vscode from "vscode";
import { describe, it, expect, vi } from "vitest";
import { handleSmartInline, type VscodeApi } from "../src/commandHandlers";
import { selectionOffsets } from "../src/commandRunners";
import {
  firstCallArgs,
  createMockEditor,
  createMockVscode,
  FAKE_FILE,
  FAKE_WORKSPACE
} from "./mockVscode";

/** Run the unified handler over `source` with `selection` selected. */
async function run(
  source: string,
  selection: string,
  opts: { workspace?: string } = {}
) {
  const { start, end } = selectionOffsets(source, selection);
  const vscode = createMockVscode(opts.workspace);
  const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });
  await handleSmartInline(
    vscode as unknown as VscodeApi,
    editor as unknown as vscode.TextEditor
  );
  return { vscode, editor };
}

/** Collect the text passed to every editBuilder.replace(...) call. */
async function replacedTexts(editor: {
  edit: { mock: { calls: unknown[][] } };
}): Promise<string[]> {
  const builder = firstCallArgs(editor.edit, "editor.edit")[0] as (b: {
    replace: unknown;
    insert: unknown;
  }) => Promise<void> | void;
  const replace = vi.fn();
  const insert = vi.fn();
  await builder({ replace, insert });
  return replace.mock.calls.map((c: unknown[]) => String(c[1]));
}

describe("Smart Inline (smartInlineFunction.inline) — unified command", () => {
  describe("dispatches to smart-inline (relocate a function body)", () => {
    it("inlines a same-file function, preserving variable names", async () => {
      const source = `
const addTwo = (a: number) => a + 2;
const three = 3;
const result = addTwo(three);
`;
      const { vscode, editor } = await run(source, "addTwo(three)", {
        workspace: FAKE_WORKSPACE
      });
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts.some((t) => t.trim() === "three + 2")).toBe(true);
    });

    it("inlines an awaited async call inside an async function", async () => {
      const source = `
const asyncFetch = async () => 42;
async function go() {
  const x = await asyncFetch();
}
`;
      const { vscode, editor } = await run(source, "asyncFetch()", {
        workspace: FAKE_WORKSPACE
      });
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts.some((t) => t.trim() === "42")).toBe(true);
    });
  });

  describe("dispatches to literal-inline-array (evaluate a .map)", () => {
    it("reduces a const array .map(callback) to an array literal", async () => {
      const source = `
const myArray = [1, 2, 3];
const doubled = myArray.map((x) => x * 2);
`;
      const { vscode, editor } = await run(source, "myArray.map((x) => x * 2)");
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts.some((t) => t.trim() === "[2, 4, 6]")).toBe(true);
    });

    it("reduces Object.entries(obj).map(callback) when obj is const", async () => {
      const source = `
const obj = { a: 1, b: 2 };
const entries = Object.entries(obj).map(([k, v]) => v * 2);
`;
      const { vscode, editor } = await run(
        source,
        "Object.entries(obj).map(([k, v]) => v * 2)"
      );
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts.some((t) => t.trim() === "[2, 4]")).toBe(true);
    });
  });

  describe("dispatches to literal-inline-object (evaluate Object.fromEntries)", () => {
    it("reduces Object.fromEntries(entries) to an object literal when entries is const", async () => {
      const source = `
const entries = [["a", 1], ["b", 2]];
const obj = Object.fromEntries(entries);
`;
      const { vscode, editor } = await run(source, "Object.fromEntries(entries)");
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      const joined = texts.join("");
      expect(joined).toMatch(/a.*1|1.*a/);
      expect(joined).toMatch(/b.*2|2.*b/);
    });
  });

  describe("dispatches to literal-inline (fold an expression)", () => {
    it("folds arithmetic against a const binding", async () => {
      const source = `
const arg = 3;
const sum = arg + 3;
`;
      const { vscode, editor } = await run(source, "arg + 3");
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts).toContain("6");
    });

    it("flattens an array spread when the spread source is a const array", async () => {
      const source = `
const arg = [7, 8];
const bigArray = [...arg, 4, 5];
`;
      const { vscode, editor } = await run(source, "[...arg, 4, 5]");
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts).toContain("[7, 8, 4, 5]");
    });
  });

  describe("reports the behavior's own failure (no silent fallback)", () => {
    it("smart-inline: reports an unresolvable function rather than folding it", async () => {
      const { vscode, editor } = await run(
        `const result = unknownFunc(1);`,
        "unknownFunc(1)",
        { workspace: FAKE_WORKSPACE }
      );
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Could not resolve/)
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("smart-inline: reports a too-complex body rather than folding the call", async () => {
      // Arrow form so the substring "complex()" occurs only at the call site,
      // not in the declaration — the selection must land on the call.
      const source = `
const complex = () => {
  const a = 1;
  const b = 2;
  if (a) return b;
  return a + b;
};
const result = complex();
`;
      const { vscode, editor } = await run(source, "complex()", {
        workspace: FAKE_WORKSPACE
      });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/too complex/)
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("async: reports a non-awaited async call in a non-async function", async () => {
      const source = `
const asyncFetch = async () => 42;
function go() {
  const x = asyncFetch();
}
`;
      const { vscode, editor } = await run(source, "asyncFetch()", {
        workspace: FAKE_WORKSPACE
      });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/not awaited|not async/i)
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("array: reports a non-const source array", async () => {
      const source = `
let myArray = [1, 2];
const doubled = myArray.map((x) => x * 2);
`;
      const { vscode, editor } = await run(source, "myArray.map((x) => x * 2)");
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/const/)
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("object: reports non-const entries", async () => {
      const source = `
let entries = [["a", 1]];
const obj = Object.fromEntries(entries);
`;
      const { vscode, editor } = await run(source, "Object.fromEntries(entries)");
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/const|entries/)
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("reports when there is nothing actionable at the selection", async () => {
      const source = `const x = ;`;
      const vscode = createMockVscode();
      const editor = createMockEditor(source, 0, source.length, {
        fileName: FAKE_FILE
      });
      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor
      );
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Nothing to inline/)
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });
  });

  describe("dispatch replaces the old per-command guards", () => {
    // These inputs used to earn a command-specific "you picked the wrong command"
    // error. Under the single command they route to whichever behavior fits — the
    // cursor position carries the intent the command choice used to.

    it("a bare arithmetic expression (no call) now folds instead of erroring", async () => {
      // Previously: smart-inline said "No function call expression found."
      const source = `const x = 1 + 2;`;
      const { vscode, editor } = await run(source, "1 + 2");
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts).toContain("3");
    });

    it("a const array outside any .map now folds instead of erroring", async () => {
      // Previously: literal-inline-array said "Selection must be inside a .map(...)".
      const source = `const x = [1, 2, 3];`;
      const { vscode, editor } = await run(source, "[1, 2, 3]");
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      const texts = await replacedTexts(editor);
      expect(texts.some((t) => t.trim() === "[1, 2, 3]")).toBe(true);
    });
  });
});
