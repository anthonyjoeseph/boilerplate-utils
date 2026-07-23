/**
 * Command runners: pure logic for each extension command.
 * Used by the extension and by integration tests so behavior is consistent and testable.
 */
import * as ts from "typescript";

import {
  findEnclosingFromEntriesCall,
  findEnclosingMapCall,
  findSelectedCallExpression,
  findSelectedExpression
} from "./callSelection";
import { resolveFunctionDefinition } from "./functionResolution";
import { classifyInlineTarget } from "./inlineDispatch";
import {
  collectLiteralConstsVisibleAtCall,
  inlineCallExpression,
  literalInlineArray,
  literalInlineObject
} from "./inlining";
import { literalInlineExpressionAtSelection } from "./literalInline";

/** Result with replace range for array/object literal-inline (used by extension). */
export type LiteralInlineWithRangeResult =
  | { ok: true; text: string; replaceStart: number; replaceEnd: number }
  | { ok: false; error: string };

export type ScriptKind = "ts" | "tsx";

export interface RunSmartInlineParams {
  sourceText: string;
  start: number;
  end: number;
  fileName: string;
  workspaceRoot: string;
  scriptKind?: ScriptKind;
}

export type SmartInlineResult =
  | {
      ok: true;
      expression: string;
      /** Printed import lines (with newline) to add to caller if not already present. */
      neededImportTexts: string[];
      replaceStart: number;
      replaceEnd: number;
    }
  | { ok: false; error: string };

export async function runSmartInline(
  params: RunSmartInlineParams
): Promise<SmartInlineResult> {
  const {
    sourceText,
    start,
    end,
    fileName,
    workspaceRoot,
    scriptKind = "ts"
  } = params;
  const sourceFile = createSourceFile(fileName, sourceText, scriptKind);

  const callExpr = findSelectedCallExpression(sourceFile, start, end);
  if (!callExpr) {
    return {
      ok: false,
      error: "No function call expression found at the selection."
    };
  }

  const callee = callExpr.expression;
  // Unwrap a single layer of parentheses: (f)(args) is equivalent to f(args).
  const calleeId = ts.isIdentifier(callee)
    ? callee
    : ts.isParenthesizedExpression(callee) && ts.isIdentifier(callee.expression)
      ? callee.expression
      : undefined;
  if (!calleeId) {
    return {
      ok: false,
      error:
        "Only simple function identifiers are supported (no methods or property accesses)."
    };
  }

  try {
    const functionInfo = await resolveFunctionDefinition(
      calleeId,
      sourceFile,
      fileName,
      workspaceRoot
    );
    if (!functionInfo) {
      return {
        ok: false,
        error: `Could not resolve function declaration for "${calleeId.text}".`
      };
    }

    const isAsyncCallee = !!functionInfo.node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    );
    if (isAsyncCallee) {
      const asyncCheck = validateAsyncCallContext(sourceFile, callExpr);
      if (!asyncCheck.ok) {
        return {
          ok: false,
          error:
            asyncCheck.message ??
            "Cannot inline async function in this context."
        };
      }
    }

    const callerConstEnv = collectLiteralConstsVisibleAtCall(
      sourceFile,
      callExpr
    );
    const inlineResult = inlineCallExpression(
      callExpr,
      functionInfo.node,
      functionInfo.sourceFile,
      callerConstEnv,
      fileName
    );
    if ("error" in inlineResult) {
      return { ok: false, error: inlineResult.error };
    }
    const printer = ts.createPrinter({ removeComments: false });
    const neededImportTexts = inlineResult.neededImports.map(
      (decl) =>
        printer.printNode(
          ts.EmitHint.Unspecified,
          decl,
          functionInfo.sourceFile
        ) + "\n"
    );
    return {
      ok: true,
      expression: inlineResult.expression,
      neededImportTexts,
      replaceStart: callExpr.getStart(sourceFile),
      replaceEnd: callExpr.getEnd()
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Smart Inline Function failed: ${message}`
    };
  }
}

/** Which of the four behaviors the unified command dispatched to. */
export type InlineBehavior =
  | "smart-inline"
  | "literal-inline"
  | "literal-inline-array"
  | "literal-inline-object";

export type RunInlineResult =
  | {
      ok: true;
      /** The behavior chosen from context, for diagnostics / status messages. */
      behavior: InlineBehavior;
      /** Text to substitute for the replaced range. */
      expression: string;
      /** Printed import lines (with newline) to add; always [] except smart-inline. */
      neededImportTexts: string[];
      replaceStart: number;
      replaceEnd: number;
    }
  | { ok: false; error: string };

/**
 * The unified command. Classifies what the selection points at, then dispatches
 * to the matching behavior. This is the single entry the `smartInlineFunction.inline`
 * command uses; the four behaviors are no longer separate commands.
 *
 * There is deliberately no fall-through from a failed `smart-inline` to `fold`: a
 * call the user pointed at that can't be relocated should say *why* ("too complex",
 * "could not resolve") rather than silently reprinting itself as a no-op fold. Cases
 * that genuinely want folding are already classified as `literal-inline` up front.
 */
export async function runInline(
  params: RunSmartInlineParams
): Promise<RunInlineResult> {
  const { sourceText, start, end, fileName, scriptKind = "ts" } = params;
  const sourceFile = createSourceFile(fileName, sourceText, scriptKind);
  const intent = classifyInlineTarget(sourceFile, start, end);

  switch (intent.kind) {
    case "none":
      return {
        ok: false,
        error:
          "Nothing to inline at the selection. Place the cursor on a function call, a .map(...) or Object.fromEntries(...) call, or a foldable expression."
      };
    case "smart-inline": {
      const r = await runSmartInline(params);
      return r.ok
        ? {
            ok: true,
            behavior: "smart-inline",
            expression: r.expression,
            neededImportTexts: r.neededImportTexts,
            replaceStart: r.replaceStart,
            replaceEnd: r.replaceEnd
          }
        : r;
    }
    case "literal-inline-array": {
      const r = runLiteralInlineArray({
        sourceText,
        start,
        end,
        fileName,
        scriptKind
      });
      return r.ok
        ? {
            ok: true,
            behavior: "literal-inline-array",
            expression: r.text,
            neededImportTexts: [],
            replaceStart: r.replaceStart,
            replaceEnd: r.replaceEnd
          }
        : r;
    }
    case "literal-inline-object": {
      const r = runLiteralInlineObject({
        sourceText,
        start,
        end,
        fileName,
        scriptKind
      });
      return r.ok
        ? {
            ok: true,
            behavior: "literal-inline-object",
            expression: r.text,
            neededImportTexts: [],
            replaceStart: r.replaceStart,
            replaceEnd: r.replaceEnd
          }
        : r;
    }
    case "literal-inline": {
      const r = runLiteralInline({
        sourceText,
        start,
        end,
        fileName,
        scriptKind
      });
      return r.ok
        ? {
            ok: true,
            behavior: "literal-inline",
            expression: r.text,
            neededImportTexts: [],
            replaceStart: r.replaceStart,
            replaceEnd: r.replaceEnd
          }
        : r;
    }
  }
}

export interface RunLiteralInlineParams {
  sourceText: string;
  start: number;
  end: number;
  fileName: string;
  scriptKind?: ScriptKind;
}

export type LiteralInlineTextResult =
  | { ok: true; text: string; replaceStart: number; replaceEnd: number }
  | { ok: false; error: string };

export function runLiteralInline(
  params: RunLiteralInlineParams
): LiteralInlineTextResult {
  const { sourceText, start, end, fileName, scriptKind = "ts" } = params;
  const sourceFile = createSourceFile(fileName, sourceText, scriptKind);

  const expr = findSelectedExpression(sourceFile, start, end);
  if (!expr) {
    return {
      ok: false,
      error: "No expression found at the selection to literal-inline."
    };
  }
  const text = literalInlineExpressionAtSelection(sourceFile, expr);
  return {
    ok: true,
    text,
    replaceStart: expr.getStart(sourceFile),
    replaceEnd: expr.getEnd()
  };
}

export interface RunLiteralInlineArrayParams {
  sourceText: string;
  start: number;
  end: number;
  fileName: string;
  scriptKind?: ScriptKind;
}

export function runLiteralInlineArray(
  params: RunLiteralInlineArrayParams
): LiteralInlineWithRangeResult {
  const { sourceText, start, end, fileName, scriptKind = "ts" } = params;
  const sourceFile = createSourceFile(fileName, sourceText, scriptKind);

  const expr = findSelectedExpression(sourceFile, start, end);
  if (!expr) {
    return {
      ok: false,
      error: "No expression found at the selection."
    };
  }
  const mapCall = findEnclosingMapCall(expr);
  if (!mapCall) {
    return {
      ok: false,
      error:
        "Selection must be inside a .map(...) call (e.g. myArray.map(...) or Object.entries(obj).map(...))."
    };
  }
  const result = literalInlineArray(sourceFile, mapCall);
  if (!result.ok) return result as LiteralInlineWithRangeResult;
  return {
    ok: true,
    text: result.text,
    replaceStart: mapCall.getStart(sourceFile),
    replaceEnd: mapCall.getEnd()
  };
}

export interface RunLiteralInlineObjectParams {
  sourceText: string;
  start: number;
  end: number;
  fileName: string;
  scriptKind?: ScriptKind;
}

export function runLiteralInlineObject(
  params: RunLiteralInlineObjectParams
): LiteralInlineWithRangeResult {
  const { sourceText, start, end, fileName, scriptKind = "ts" } = params;
  const sourceFile = createSourceFile(fileName, sourceText, scriptKind);

  const expr = findSelectedExpression(sourceFile, start, end);
  if (!expr) {
    return {
      ok: false,
      error: "No expression found at the selection."
    };
  }
  const fromEntriesCall = findEnclosingFromEntriesCall(expr);
  if (!fromEntriesCall) {
    return {
      ok: false,
      error: "Selection must be inside Object.fromEntries(...)."
    };
  }
  const result = literalInlineObject(sourceFile, fromEntriesCall);
  if (!result.ok) return result as LiteralInlineWithRangeResult;
  return {
    ok: true,
    text: result.text,
    replaceStart: fromEntriesCall.getStart(sourceFile),
    replaceEnd: fromEntriesCall.getEnd()
  };
}

function createSourceFile(
  fileName: string,
  sourceText: string,
  scriptKind: ScriptKind
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

interface AsyncContextCheckResult {
  ok: boolean;
  message?: string;
}

function isTopLevelAwaitAllowed(sourceFile: ts.SourceFile): boolean {
  return (sourceFile.flags & ts.NodeFlags.AwaitContext) !== 0;
}

function validateAsyncCallContext(
  sourceFile: ts.SourceFile,
  callExpr: ts.CallExpression
): AsyncContextCheckResult {
  const parent = callExpr.parent;
  const isAwaited = ts.isAwaitExpression(parent);

  let current: ts.Node | undefined = callExpr;
  let enclosingFunction:
    | ts.FunctionDeclaration
    | ts.MethodDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration
    | ts.ConstructorDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | undefined;

  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      enclosingFunction = current;
      break;
    }
    current = current.parent;
  }

  if (enclosingFunction) {
    const isParentAsync = !!enclosingFunction.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    );
    if (!isParentAsync) {
      return {
        ok: false,
        message:
          "Cannot inline async function here: enclosing function is not async."
      };
    }
    if (!isAwaited) {
      return {
        ok: false,
        message:
          "Cannot inline async function here: the call is not awaited and inlining would change its behavior."
      };
    }
    return { ok: true };
  }

  if (!isAwaited) {
    return {
      ok: false,
      message:
        "Cannot inline async function at top level unless the call is awaited."
    };
  }
  if (!isTopLevelAwaitAllowed(sourceFile)) {
    return {
      ok: false,
      message:
        "Cannot inline async function here: top-level await is not allowed in this file."
    };
  }
  return { ok: true };
}

/**
 * Helper for tests: given source code and the exact substring that is the "selection",
 * returns the start and end offsets. Assumes the selection is the first occurrence of that substring.
 */
export function selectionOffsets(
  sourceText: string,
  selectedSubstring: string
): { start: number; end: number } {
  const start = sourceText.indexOf(selectedSubstring);
  if (start === -1) {
    throw new Error(
      `Selection substring not found: ${JSON.stringify(selectedSubstring)}`
    );
  }
  return { start, end: start + selectedSubstring.length };
}
