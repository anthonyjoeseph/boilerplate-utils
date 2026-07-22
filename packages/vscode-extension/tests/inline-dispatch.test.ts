/**
 * Unit tests for the selection classifier (classifyInlineTarget).
 *
 * This is the reusable core of the eventual single-command merge. It is pure, so
 * it is tested directly against a ts.SourceFile with no mocked editor.
 */
import * as ts from "typescript";
import { describe, it, expect } from "vitest";

import { classifyInlineTarget } from "../src/inlineDispatch";
import { selectionOffsets } from "../src/commandRunners";

function classify(source: string, selection: string) {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const { start, end } = selectionOffsets(source, selection);
  return classifyInlineTarget(sourceFile, start, end);
}

describe("classifyInlineTarget", () => {
  it("classifies Object.fromEntries(...) as literal-inline-object", () => {
    const source = `const o = Object.fromEntries([["a", 1]]);`;
    expect(classify(source, `Object.fromEntries([["a", 1]])`).kind).toBe(
      "literal-inline-object"
    );
  });

  it("classifies Object.fromEntries wrapping a .map as object (outer wins)", () => {
    const source = `const o = Object.fromEntries(Object.entries(x).map((e) => e));`;
    // Cursor on the outer fromEntries call.
    expect(
      classify(source, `Object.fromEntries(Object.entries(x).map((e) => e))`)
        .kind
    ).toBe("literal-inline-object");
  });

  it("classifies a .map(...) call as literal-inline-array", () => {
    const source = `const d = [1, 2, 3].map((x) => x * 2);`;
    expect(classify(source, `[1, 2, 3].map((x) => x * 2)`).kind).toBe(
      "literal-inline-array"
    );
  });

  it("classifies a plain-identifier call as smart-inline", () => {
    const source = `const addTwo = (a: number) => a + 2;\nconst r = addTwo(3);`;
    expect(classify(source, `addTwo(3)`).kind).toBe("smart-inline");
  });

  it("does NOT treat a .map nested in a relocated body as array (cursor on outer call)", () => {
    const source = `const f = (a: number[]) => a;\nconst r = f([1].map((x) => x));`;
    // Cursor on the outer user-function call: the inner .map is a child, not an
    // ancestor, so it must not hijack the classification.
    expect(classify(source, `f([1].map((x) => x))`).kind).toBe("smart-inline");
  });

  it("classifies a bare expression as literal-inline", () => {
    const source = `const x = 1 + 2;`;
    expect(classify(source, `1 + 2`).kind).toBe("literal-inline");
  });

  it("returns none when there is nothing at the selection", () => {
    const source = `;`;
    const sourceFile = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(classifyInlineTarget(sourceFile, 0, 0).kind).toBe("none");
  });
});
