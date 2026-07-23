/**
 * Smart Inline Function: main entry and public API.
 *
 * This module re-exports the main inline entry (inlineCallExpression,
 * collectLiteralConstsVisibleAtCall) and literal-inline APIs from smaller
 * modules. Other modules: inliningConst, inliningSubstitute, inliningControlFlow,
 * inliningImports, inliningLiteral.
 */

import * as path from "path";

import * as ts from "typescript";
import { isDeepConstExpr, resolveConstExpression } from "./inliningConst";
import {
  tryReduceIfElseChainToExpression,
  tryReduceSwitchToExpression
} from "./inliningControlFlow";
import {
  collectImportedNames,
  collectUsedImportedNames
} from "./inliningImports";
import { substituteAndSimplifyExpression } from "./inliningSubstitute";

export interface InlineResult {
  expression: string;
  neededImports: ts.ImportDeclaration[];
}

/**
 * Marks every node in the subtree as synthesized (pos = −1, end = −1).
 * TypeScript's printer checks isNodeSynthesized() — true iff pos < 0 — to
 * decide whether to read node text from sourceFile.text or from the node's
 * stored .text/.escapedText. Setting pos/end to −1 forces it to use the
 * stored values, which is correct when the expression tree mixes nodes from
 * different source files (callee body + caller argument nodes).
 */
function synthesizeTree(node: ts.Node): void {
  (node as unknown as { pos: number; end: number }).pos = -1;
  (node as unknown as { pos: number; end: number }).end = -1;
  node.forEachChild(synthesizeTree);
}

function isSimpleArg(expr: ts.Expression): boolean {
  return (
    ts.isLiteralExpression(expr) ||
    ts.isIdentifier(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  );
}

function countParamUses(name: string, node: ts.Node): number {
  let count = 0;
  function walk(n: ts.Node): void {
    if (ts.isIdentifier(n) && n.text === name) count++;
    n.forEachChild(walk);
  }
  walk(node);
  return count;
}

function wouldDuplicateEffectfulArg(
  fnDecl: ts.FunctionLikeDeclaration,
  argMap: Map<string, ts.Expression>
): boolean {
  if (!fnDecl.body) return false;
  for (const [name, expr] of argMap) {
    if (isSimpleArg(expr)) continue;
    if (countParamUses(name, fnDecl.body) > 1) return true;
  }
  return false;
}

function buildIIFE(
  fnDecl: ts.FunctionLikeDeclaration,
  callExpr: ts.CallExpression
): ts.Expression | undefined {
  if (!fnDecl.body) return undefined;
  const factory = ts.factory;
  const arrowFn = factory.createArrowFunction(
    undefined,
    undefined,
    fnDecl.parameters,
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    fnDecl.body as ts.ConciseBody
  );
  return factory.createCallExpression(
    factory.createParenthesizedExpression(arrowFn),
    undefined,
    Array.from(callExpr.arguments)
  );
}

export function inlineCallExpression(
  callExpr: ts.CallExpression,
  fnDecl: ts.FunctionLikeDeclaration,
  fnSourceFile: ts.SourceFile,
  callerConstEnv: Map<string, ts.Expression>,
  callerFileName = ""
): InlineResult | undefined {
  const printer = ts.createPrinter({ removeComments: false });

  const argMap = new Map<string, ts.Expression>();
  const paramConstEnv = new Map<string, ts.Expression>();
  const factory = ts.factory;

  for (let i = 0; i < fnDecl.parameters.length; i++) {
    const param = fnDecl.parameters[i];
    if (!param) {
      return undefined;
    }

    if (param.dotDotDotToken) {
      return undefined; // rest params not supported
    }

    const hasDefault = !!param.initializer;
    const providedArg = callExpr.arguments[i] as ts.Expression | undefined;
    const isExplicitUndefined =
      providedArg !== undefined &&
      ts.isIdentifier(providedArg) &&
      providedArg.text === "undefined";

    let effectiveArg: ts.Expression | undefined;
    if (isExplicitUndefined && hasDefault) {
      effectiveArg = param.initializer as ts.Expression;
    } else if (providedArg !== undefined) {
      effectiveArg = providedArg;
    } else if (hasDefault && param.initializer) {
      effectiveArg = param.initializer as ts.Expression;
    }

    if (!effectiveArg) {
      // No argument and no default value -> cannot safely inline.
      return undefined;
    }

    const name = param.name;

    function bindLocal(localName: string, valueExpr: ts.Expression) {
      argMap.set(localName, valueExpr);
      if (callerConstEnv.size > 0) {
        const constExpr = resolveConstExpression(valueExpr, callerConstEnv, 0);
        if (constExpr && isDeepConstExpr(constExpr)) {
          paramConstEnv.set(localName, constExpr);
        }
      }
    }

    // Simple identifier parameter: map directly.
    if (ts.isIdentifier(name)) {
      bindLocal(name.text, effectiveArg);
      continue;
    }

    // Object destructuring parameter, e.g. ({ one, two }: Foo)
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (
          element.dotDotDotToken ||
          element.initializer ||
          !ts.isIdentifier(element.name)
        ) {
          return undefined; // rest, defaults, or nested patterns not yet supported
        }

        const localId = element.name;
        const prop = element.propertyName ?? element.name;

        let accessExpr: ts.Expression | undefined;
        if (ts.isIdentifier(prop)) {
          accessExpr = factory.createPropertyAccessExpression(
            effectiveArg,
            prop
          );
        } else if (ts.isStringLiteral(prop) || ts.isNumericLiteral(prop)) {
          accessExpr = factory.createElementAccessExpression(
            effectiveArg,
            prop
          );
        } else {
          return undefined; // computed property names not supported
        }

        bindLocal(localId.text, accessExpr);
      }
      continue;
    }

    // Array/tuple destructuring parameter, e.g. ([one, two]: [number, number])
    if (ts.isArrayBindingPattern(name)) {
      let index = 0;
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) {
          // Skip holes but advance index.
          index++;
          continue;
        }
        if (
          !ts.isBindingElement(element) ||
          element.dotDotDotToken ||
          element.initializer ||
          !ts.isIdentifier(element.name)
        ) {
          return undefined; // rest, defaults, or nested patterns not yet supported
        }

        const localId = element.name;
        const accessExpr = factory.createElementAccessExpression(
          effectiveArg,
          factory.createNumericLiteral(index)
        );
        bindLocal(localId.text, accessExpr);
        index++;
      }
      continue;
    }

    // Any other complex parameter pattern is not supported.
    return undefined;
  }

  let finalExpr: ts.Expression | undefined;

  if (ts.isArrowFunction(fnDecl) && fnDecl.body && !ts.isBlock(fnDecl.body)) {
    finalExpr = substituteAndSimplifyExpression(
      fnDecl.body,
      argMap,
      paramConstEnv
    );
  } else if (fnDecl.body && ts.isBlock(fnDecl.body)) {
    const statements = fnDecl.body.statements;
    const onlyStatement = statements.length === 1 ? statements[0] : undefined;
    if (
      onlyStatement &&
      ts.isReturnStatement(onlyStatement) &&
      onlyStatement.expression
    ) {
      finalExpr = substituteAndSimplifyExpression(
        onlyStatement.expression,
        argMap,
        paramConstEnv
      );
    } else {
      // Try to reduce a simple if / else-if / else chain where all branches return.
      finalExpr = tryReduceIfElseChainToExpression(
        fnDecl.body,
        argMap,
        paramConstEnv
      );
      // If that fails, try to reduce a simple switch statement where all cases return.
      if (!finalExpr) {
        finalExpr = tryReduceSwitchToExpression(
          fnDecl.body,
          argMap,
          paramConstEnv
        );
      }
    }
  }

  // Use an IIFE when either: (a) the body is too complex to reduce to a single
  // expression, or (b) a non-simple argument would be duplicated by blind
  // substitution (e.g. `dbl(next())` where `dbl = a => a + a` would evaluate
  // `next()` twice). The IIFE `((params) => body)(args)` is always semantically
  // correct and naturally binds each parameter once.
  const useIIFE = !finalExpr || wouldDuplicateEffectfulArg(fnDecl, argMap);

  let exprForPrint: ts.Expression;
  let nodeForImports: ts.Node;

  if (useIIFE) {
    if (!fnDecl.body) return undefined;
    const iife = buildIIFE(fnDecl, callExpr);
    if (!iife) return undefined;
    exprForPrint = iife;
    nodeForImports = fnDecl.body;
  } else {
    // Preserve side effects of extra arguments (beyond declared parameters).
    // Wrap in parentheses to avoid comma-operator precedence surprises in the
    // caller (e.g. `() => extraArg, result` would be mis-parsed as an arrow
    // returning `extraArg` followed by a standalone `result` expression).
    const extraArgs = Array.from(callExpr.arguments).slice(fnDecl.parameters.length);
    if (extraArgs.length > 0) {
      let commaLeft: ts.Expression = extraArgs[0]!;
      for (let i = 1; i < extraArgs.length; i++) {
        commaLeft = ts.factory.createBinaryExpression(
          commaLeft,
          ts.SyntaxKind.CommaToken,
          extraArgs[i]!
        );
      }
      finalExpr = ts.factory.createParenthesizedExpression(
        ts.factory.createBinaryExpression(
          commaLeft,
          ts.SyntaxKind.CommaToken,
          finalExpr!
        )
      );
    }
    exprForPrint = finalExpr!;
    nodeForImports = exprForPrint;
  }

  // Determine which imported symbols from the callee file are referenced
  // in the final inlined expression, so we can add missing imports in the caller.
  const importedNames = collectImportedNames(fnSourceFile);
  const usedImportedNames = collectUsedImportedNames(nodeForImports, importedNames);
  const neededImports = Array.from(
    new Set(
      usedImportedNames.map(
        (decl) =>
          `${(decl.moduleSpecifier as ts.StringLiteral).text}::${decl.getText(
            fnSourceFile
          )}`
      )
    )
  )
    .map((key) => {
      const [moduleSpecifierText] = key.split("::");
      if (moduleSpecifierText === undefined) return undefined;
      // Re-find the declaration by module specifier + textual match.
      const candidates = importedNames.getAllByModule(moduleSpecifierText);
      return (
        candidates.find(
          (d) =>
            d.getText(fnSourceFile) === key.slice(moduleSpecifierText.length + 2)
        ) ?? candidates[0]
      );
    })
    .filter((d): d is ts.ImportDeclaration => d !== undefined);

  // Rewrite relative import paths from callee-relative to caller-relative.
  const rewrittenImports = callerFileName
    ? neededImports.map((decl) => {
        const spec = decl.moduleSpecifier as ts.StringLiteral;
        if (!spec.text.startsWith(".")) return decl;
        const calleeDir = path.dirname(fnSourceFile.fileName);
        const callerDir = path.dirname(callerFileName);
        const absolutePath = path.resolve(calleeDir, spec.text);
        let rel = path.relative(callerDir, absolutePath).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = "./" + rel;
        return ts.factory.updateImportDeclaration(
          decl,
          decl.modifiers,
          decl.importClause,
          ts.factory.createStringLiteral(rel),
          decl.assertClause
        );
      })
    : neededImports;

  // Synthesize the entire expression tree (set pos/end = -1 on every node).
  // TypeScript's printer reads node text from sourceFile.text[pos..end] for
  // parsed nodes (pos >= 0) but uses the node's stored .text/.escapedText for
  // synthesized nodes (pos < 0, i.e. isNodeSynthesized() is true). The
  // expression may mix callee nodes and caller argument nodes from different
  // source files — synthesizing everything forces the printer to use stored
  // text rather than reading from positions that may not match fnSourceFile.
  synthesizeTree(exprForPrint);
  const inlinedText = printer.printNode(
    ts.EmitHint.Expression,
    exprForPrint,
    fnSourceFile
  );
  return {
    expression: inlinedText.trim(),
    neededImports: rewrittenImports
  };
}

// Re-export const env and literal APIs so callers can still use a single entry point.
export { collectLiteralConstsVisibleAtCall } from "./inliningConst";
export {
  literalFoldExpression,
  literalInlineArray,
  literalInlineObject,
  type LiteralInlineResult
} from "./inliningLiteral";
