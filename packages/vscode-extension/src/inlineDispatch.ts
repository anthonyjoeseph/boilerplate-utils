/**
 * Selection classifier: given a cursor/selection, decide which of the four
 * inline behaviors the user is pointing at.
 *
 * This is the reusable core of the eventual single-command merge (see ROADMAP
 * "Command unification"). It is intentionally pure and side-effect free: it only
 * *classifies*; it does not resolve functions, fold, or edit. Nothing wires it up
 * yet — the four commands still exist — so adding it changes no behavior.
 *
 * The intent that the four commands encode by *which command you pick* is
 * recoverable from *which node the cursor sits on*. This is consistent with the
 * ES6-builtin rule: a builtin (`.map`, `Object.fromEntries`) is only evaluated
 * when the cursor is directly on that call; a builtin nested inside a body being
 * relocated is copied verbatim, because the cursor is on the outer call instead.
 */
import * as ts from "typescript";

import {
  findEnclosingFromEntriesCall,
  findEnclosingMapCall,
  findSelectedCallExpression,
  findSelectedExpression
} from "./callSelection";

export type InlineIntent =
  /** Cursor is on/inside `Object.fromEntries(...)` — evaluate it to an object literal. */
  | { kind: "literal-inline-object"; call: ts.CallExpression }
  /** Cursor is on/inside a `.map(...)` call — evaluate it to an array literal. */
  | { kind: "literal-inline-array"; call: ts.CallExpression }
  /** Cursor is on a call to a plain-identifier callee — relocate the function body. */
  | { kind: "smart-inline"; call: ts.CallExpression }
  /** Cursor is on some other expression — constant-fold it. */
  | { kind: "literal-inline"; expr: ts.Expression }
  /** Nothing actionable at the selection. */
  | { kind: "none" };

/**
 * Classify what the selection is pointing at, in precedence order.
 *
 * Precedence (first match wins):
 *   1. `Object.fromEntries(...)`  — most specific builtin
 *   2. `.map(...)`                — builtin
 *   3. a plain-identifier call    — user-defined function to relocate
 *   4. any other expression       — fold
 *
 * NOTE (v1 limitation, tracked on the roadmap): precedence here is a fixed order,
 * not a depth comparison. When a `.map` and a plain-identifier call are both
 * ancestors of the selection, the builtin wins even if the identifier call is the
 * inner one. The correct tie-break is "innermost enclosing construct wins"; that
 * refinement is deferred until the merge is actually wired up. In practice the
 * `findEnclosing*` helpers only walk *outward*, so a builtin that is a *child* of
 * the targeted call (`f(arr.map(g))` with the cursor on `f`) is already ignored.
 */
export function classifyInlineTarget(
  sourceFile: ts.SourceFile,
  start: number,
  end: number
): InlineIntent {
  const anchor =
    findSelectedExpression(sourceFile, start, end) ??
    findSelectedCallExpression(sourceFile, start, end);
  if (!anchor) {
    return { kind: "none" };
  }

  const fromEntries = findEnclosingFromEntriesCall(anchor);
  if (fromEntries) {
    return { kind: "literal-inline-object", call: fromEntries };
  }

  const mapCall = findEnclosingMapCall(anchor);
  if (mapCall) {
    return { kind: "literal-inline-array", call: mapCall };
  }

  const call = findSelectedCallExpression(sourceFile, start, end);
  if (call && ts.isIdentifier(call.expression)) {
    return { kind: "smart-inline", call };
  }

  if (ts.isExpression(anchor)) {
    return { kind: "literal-inline", expr: anchor };
  }

  return { kind: "none" };
}
