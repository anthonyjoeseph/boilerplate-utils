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
import type { ModuleResolver } from "./functionResolution";
import { isDeepConstExpr, resolveConstExpression } from "./inliningConst";
import {
  tryReduceIfElseChainToExpression,
  tryReduceSwitchToExpression
} from "./inliningControlFlow";
import {
  collectImportedNames,
  collectReferencedNames,
  collectUsedImportedNames,
  narrowImportToUsedNames
} from "./inliningImports";
import { substituteAndSimplifyExpression } from "./inliningSubstitute";

export interface InlineResult {
  expression: string;
  neededImports: ts.ImportDeclaration[];
  /** Imports that were emitted anyway but will not resolve as written. */
  unresolvedImports: UnresolvedImport[];
}

export interface UnresolvedImport {
  /** The specifier as emitted. */
  specifier: string;
  /** The names the inlined code needs from it. */
  names: string[];
  reason: UnresolvedImportReason;
}

export type UnresolvedImportReason =
  /** A package the caller does not have installed. */
  | "not-installed"
  /** A module its own package keeps out of its published entry points. */
  | "not-published";

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

/**
 * The callee's type parameters, carried onto the IIFE's arrow so that the
 * parameter annotations and body assertions copied along with them still refer
 * to something. Without this, inlining a generic callee emits an unbound `T`.
 *
 * In a `.tsx` caller a bare `<T>` parses as a JSX element, and the printer will
 * not emit the `<T,>` disambiguator, so an unconstrained parameter gets the
 * inference-equivalent `<T extends unknown>` instead.
 */
function iifeTypeParameters(
  fnDecl: ts.FunctionLikeDeclaration,
  callerIsTsx: boolean
): ts.NodeArray<ts.TypeParameterDeclaration> | undefined {
  const typeParameters = fnDecl.typeParameters;
  if (!typeParameters || typeParameters.length === 0) return undefined;
  if (!callerIsTsx) return typeParameters;

  const factory = ts.factory;
  return factory.createNodeArray(
    typeParameters.map((tp) =>
      tp.constraint
        ? tp
        : factory.updateTypeParameterDeclaration(
            tp,
            tp.modifiers,
            tp.name,
            factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
            tp.default
          )
    )
  );
}

function buildIIFE(
  fnDecl: ts.FunctionLikeDeclaration,
  callExpr: ts.CallExpression,
  callerIsTsx: boolean
): ts.Expression | undefined {
  if (!fnDecl.body) return undefined;
  const factory = ts.factory;
  const arrowFn = factory.createArrowFunction(
    undefined,
    iifeTypeParameters(fnDecl, callerIsTsx),
    fnDecl.parameters,
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    fnDecl.body as ts.ConciseBody
  );
  return factory.createCallExpression(
    factory.createParenthesizedExpression(arrowFn),
    // `f<string>(x)` keeps its type arguments: `(<T>(x: T) => ...)<string>(x)`.
    callExpr.typeArguments,
    Array.from(callExpr.arguments)
  );
}

/**
 * What TypeScript itself infers for a type parameter that has no inference
 * site: its default, else its constraint, else `unknown`.
 */
function inferenceWithoutCandidates(
  tp: ts.TypeParameterDeclaration
): ts.TypeNode {
  return (
    tp.default ??
    tp.constraint ??
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
  );
}

/**
 * What each of the callee's type parameters stands for at this call site.
 *
 * Explicit type arguments say so outright. Otherwise a type parameter that
 * appears in no parameter annotation has nothing to infer from, so TypeScript
 * falls back to its default/constraint/`unknown` - and so can we. A type
 * parameter that IS inferable from the arguments is left out: resolving it
 * needs a checker, and the IIFE fallback binds it correctly anyway.
 */
function typeParameterSubstitution(
  fnDecl: ts.FunctionLikeDeclaration,
  callExpr: ts.CallExpression
): Map<string, ts.TypeNode> {
  const substitution = new Map<string, ts.TypeNode>();
  const typeParameters = fnDecl.typeParameters;
  if (!typeParameters || typeParameters.length === 0) return substitution;

  const inferable = new Set<string>();
  for (const param of fnDecl.parameters) {
    if (!param.type) continue;
    for (const tp of typeParameters) {
      const name = tp.name.text;
      if (typeParameterReferencedIn(param.type, new Set([name]))) {
        inferable.add(name);
      }
    }
  }

  const explicit = callExpr.typeArguments;
  typeParameters.forEach((tp, i) => {
    const provided = explicit?.[i];
    if (provided) {
      substitution.set(tp.name.text, provided);
    } else if (explicit || !inferable.has(tp.name.text)) {
      substitution.set(tp.name.text, inferenceWithoutCandidates(tp));
    }
  });
  return substitution;
}

/** Replace bare references to the substituted type parameters in `node`. */
function substituteTypeParameters(
  node: ts.Expression,
  substitution: Map<string, ts.TypeNode>
): ts.Expression {
  if (substitution.size === 0) return node;
  const result = ts.transform(node, [
    (context) => {
      const visit = (n: ts.Node): ts.Node => {
        if (
          ts.isTypeReferenceNode(n) &&
          ts.isIdentifier(n.typeName) &&
          !n.typeArguments
        ) {
          const replacement = substitution.get(n.typeName.text);
          if (replacement) return replacement;
        }
        return ts.visitEachChild(n, visit, context);
      };
      return (n: ts.Expression) => ts.visitNode(n, visit) as ts.Expression;
    }
  ]);
  return (result.transformed[0] as ts.Expression | undefined) ?? node;
}

/**
 * The first of `names` referenced from a type position inside `node`, if any.
 * Value positions are ignored: a caller-side variable that happens to be named
 * `T` is not a type reference.
 */
function typeParameterReferencedIn(
  node: ts.Node,
  names: Set<string>
): string | undefined {
  let found: string | undefined;
  function visit(n: ts.Node, inTypePosition: boolean): void {
    if (found) return;
    const inType = inTypePosition || ts.isTypeNode(n);
    if (inType && ts.isIdentifier(n) && names.has(n.text)) {
      found = n.text;
      return;
    }
    n.forEachChild((child) => visit(child, inType));
  }
  visit(node, false);
  return found;
}

/**
 * The npm package a file belongs to, if it is inside a `node_modules` tree:
 * the package's root directory and its name (scope included).
 */
function npmPackageOf(
  filePath: string
): { root: string; name: string } | undefined {
  const segments = filePath.split(/[\\/]/);
  const last = segments.lastIndexOf("node_modules");
  if (last < 0) return undefined;

  const first = segments[last + 1];
  if (first === undefined) return undefined;
  const parts = first.startsWith("@") ? segments.slice(last + 1, last + 3) : [first];
  if (parts.length === 0 || parts.some((p) => p === undefined)) return undefined;

  return {
    root: segments.slice(0, last + 1 + parts.length).join(path.sep),
    name: parts.join("/")
  };
}

/** The names a single import declaration brings into scope. */
function importedNamesOf(decl: ts.ImportDeclaration): string[] {
  const clause = decl.importClause;
  if (!clause) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      names.push(clause.namedBindings.name.text);
    } else {
      for (const el of clause.namedBindings.elements) names.push(el.name.text);
    }
  }
  return names;
}

const MODULE_FILE_EXTENSIONS = [
  ".d.ts",
  ".d.mts",
  ".d.cts",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
];

/**
 * Directories a package emits into. `rxjs/src/internal/util/args.ts`,
 * `rxjs/dist/types/internal/util/args.d.ts` and `rxjs/dist/cjs/internal/util/args.js`
 * are one module in three layouts; stripping the layout leaves the subpath
 * they share, which is also the subpath the package's `exports` map speaks in.
 * Longest prefixes first, so `dist/types/` wins over `dist/`.
 */
const PACKAGE_LAYOUT_PREFIXES = [
  "dist/types/",
  "dist/esm5/",
  "dist/esm/",
  "dist/cjs/",
  "dist/",
  "build/",
  "types/",
  "esm/",
  "cjs/",
  "lib/",
  "src/"
];

/** The layout-independent subpath of `filePath` within its package. */
function packageSubpath(filePath: string, packageRoot: string): string {
  let rel = path.relative(packageRoot, filePath).replace(/\\/g, "/");

  const ext = MODULE_FILE_EXTENSIONS.find((e) => rel.endsWith(e));
  if (ext) rel = rel.slice(0, -ext.length);
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  else if (rel === "index") rel = "";

  const prefix = PACKAGE_LAYOUT_PREFIXES.find((p) => rel.startsWith(p));
  if (prefix) rel = rel.slice(prefix.length);

  return rel;
}

/**
 * A specifier the caller can write to reach `targetPath`, which lives inside
 * the npm package `pkg`.
 *
 * The callee's own imports are relative paths into its source tree, and
 * rewriting those caller-relative yields `./node_modules/<pkg>/src/...` —
 * a path that reaches around the package's `exports` map. The published
 * specifier for the same module is the package name plus the layout-independent
 * subpath, but only the package decides whether that subpath is exported at
 * all, so every candidate is checked by resolving it from the caller and
 * confirming it lands on the same module.
 */
function publishedSpecifierFor(
  targetPath: string,
  pkg: { root: string; name: string },
  callerFileName: string,
  resolveModule: ModuleResolver
): string | undefined {
  const subpath = packageSubpath(targetPath, pkg.root);
  const relative = path.relative(pkg.root, targetPath).replace(/\\/g, "/");
  const withoutExtension =
    MODULE_FILE_EXTENSIONS.reduce(
      (acc, e) => (acc.endsWith(e) ? acc.slice(0, -e.length) : acc),
      relative
    ) || relative;

  const candidates =
    subpath === ""
      ? [pkg.name]
      : [`${pkg.name}/${subpath}`, `${pkg.name}/${withoutExtension}`];

  for (const candidate of candidates) {
    const resolved = resolveModule(candidate, callerFileName);
    if (!resolved) continue;
    const resolvedPkg = npmPackageOf(resolved);
    if (!resolvedPkg || resolvedPkg.name !== pkg.name) continue;
    // Same package, same module — the layout it resolved through does not matter.
    if (packageSubpath(resolved, resolvedPkg.root) === subpath) return candidate;
  }

  return undefined;
}

/**
 * The specifier a package would publish `targetPath` under if it published it
 * at all. Emitted when nothing resolves, so the caller sees the import worth
 * having (`typed-pkg/secret`) rather than one that reaches around the package
 * (`./node_modules/typed-pkg/src/secret`).
 */
function guessedSpecifierFor(
  targetPath: string | undefined,
  specifier: string,
  pkg: { root: string; name: string }
): string {
  if (!targetPath) return specifier;
  const subpath = packageSubpath(targetPath, pkg.root);
  return subpath === "" ? pkg.name : `${pkg.name}/${subpath}`;
}

/**
 * Point every import the inlined body needs at a specifier that works from the
 * caller, or explain why one of them cannot.
 *
 * Within a project this is a path rewrite, from callee-relative to
 * caller-relative. Out of an npm package it is a translation to the package's
 * own published specifier — `../util/args` inside rxjs becomes
 * `rxjs/internal/util/args` — which only succeeds if the package actually
 * exports that module.
 */
function retargetImports(
  neededImports: ts.ImportDeclaration[],
  fnSourceFile: ts.SourceFile,
  callerFileName: string,
  resolveModule: ModuleResolver | undefined
): { imports: ts.ImportDeclaration[]; unresolved: UnresolvedImport[] } {
  const calleePackage = npmPackageOf(fnSourceFile.fileName);
  const callerPackage = npmPackageOf(callerFileName);
  const crossesPackage =
    calleePackage !== undefined && calleePackage.root !== callerPackage?.root;

  const imports: ts.ImportDeclaration[] = [];
  const unresolved: UnresolvedImport[] = [];
  const note = (
    specifier: string,
    decl: ts.ImportDeclaration,
    reason: UnresolvedImportReason
  ) => {
    unresolved.push({ specifier, names: importedNamesOf(decl), reason });
  };

  for (const decl of neededImports) {
    const specifier = (decl.moduleSpecifier as ts.StringLiteral).text;

    if (!specifier.startsWith(".")) {
      // A bare specifier means the same thing from anywhere. It may still not
      // resolve — a package the callee depends on and the caller does not —
      // which is the caller's to fix by installing it, not ours to refuse over.
      if (resolveModule && !resolveModule(specifier, callerFileName)) {
        note(specifier, decl, "not-installed");
      }
      imports.push(decl);
      continue;
    }

    if (crossesPackage && calleePackage && resolveModule) {
      const target = resolveModule(specifier, fnSourceFile.fileName);
      const published = target
        ? publishedSpecifierFor(target, calleePackage, callerFileName, resolveModule)
        : undefined;
      // With no published specifier, emit the one the package would use if it
      // published the module. It is the specifier worth having, and the caller
      // can decide what to do about it.
      const emitted =
        published ??
        guessedSpecifierFor(target, specifier, calleePackage);
      if (!published) note(emitted, decl, "not-published");
      imports.push(
        ts.factory.updateImportDeclaration(
          decl,
          decl.modifiers,
          decl.importClause,
          ts.factory.createStringLiteral(emitted),
          decl.attributes
        )
      );
      continue;
    }

    if (!callerFileName) {
      imports.push(decl);
      continue;
    }

    // Same project: rewrite the path from callee-relative to caller-relative.
    const absolutePath = path.resolve(path.dirname(fnSourceFile.fileName), specifier);
    let rel = path
      .relative(path.dirname(callerFileName), absolutePath)
      .replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    imports.push(
      ts.factory.updateImportDeclaration(
        decl,
        decl.modifiers,
        decl.importClause,
        ts.factory.createStringLiteral(rel),
        decl.attributes
      )
    );
  }

  return { imports, unresolved };
}

export function inlineCallExpression(
  callExpr: ts.CallExpression,
  fnDecl: ts.FunctionLikeDeclaration,
  fnSourceFile: ts.SourceFile,
  callerConstEnv: Map<string, ts.Expression>,
  callerFileName = "",
  resolveModule?: ModuleResolver
): InlineResult | { error: string } {
  const printer = ts.createPrinter({ removeComments: false });

  const argMap = new Map<string, ts.Expression>();
  const paramConstEnv = new Map<string, ts.Expression>();
  const factory = ts.factory;

  // A rest parameter is always last, and swallows every argument from its own
  // position onward.
  const restParamIndex = fnDecl.parameters.findIndex((p) => !!p.dotDotDotToken);

  // Arguments are matched to parameters positionally, so a spread argument in
  // that region hides an unknown number of values. Inside the rest tail it is
  // harmless: it is copied verbatim into the array the rest parameter binds to.
  const spreadBoundary =
    restParamIndex >= 0 ? restParamIndex : callExpr.arguments.length;
  const hasPositionalSpread = Array.from(callExpr.arguments).some(
    (arg, i) => i < spreadBoundary && ts.isSpreadElement(arg)
  );
  if (hasPositionalSpread) {
    return {
      error:
        "Spread arguments (...) are only supported where they land in a rest parameter."
    };
  }

  for (let i = 0; i < fnDecl.parameters.length; i++) {
    const param = fnDecl.parameters[i];
    if (!param) {
      return { error: "Internal error: missing parameter node." };
    }

    if (param.dotDotDotToken) {
      if (!ts.isIdentifier(param.name)) {
        return {
          error: "Rest parameters with destructuring patterns are not yet supported."
        };
      }
      // `f(a, ...rest)` called as `f(1, 2, 3)` binds `rest` to `[2, 3]`; with no
      // arguments left, to `[]`. A spread argument stays a spread element inside
      // that array literal, which reproduces the rest array exactly:
      // `f(1, ...xs, 9)` binds `rest` to `[...xs, 9]`.
      const restArgs = Array.from(callExpr.arguments).slice(i);
      bindLocal(
        param.name.text,
        factory.createArrayLiteralExpression(restArgs, false)
      );
      continue;
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
      const pName = ts.isIdentifier(param.name)
        ? `'${param.name.text}'`
        : `at position ${i + 1}`;
      return { error: `Parameter ${pName} has no argument and no default value.` };
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
          return {
            error:
              "Object destructuring parameters with rest elements, default values, or nested patterns are not yet supported."
          };
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
          return {
            error:
              "Object destructuring parameters with computed property keys are not yet supported."
          };
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
          return {
            error:
              "Array destructuring parameters with rest elements, default values, or nested patterns are not yet supported."
          };
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
    return { error: "Unsupported parameter binding pattern." };
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

  // Types travel with the body, so a generic callee's type parameters have to be
  // resolved the same way its parameters were. Whatever is left referring to a
  // type parameter after that has to keep the arrow that declares it.
  const typeParameterNames = new Set(
    (fnDecl.typeParameters ?? []).map((tp) => tp.name.text)
  );
  if (finalExpr && typeParameterNames.size > 0) {
    finalExpr = substituteTypeParameters(
      finalExpr,
      typeParameterSubstitution(fnDecl, callExpr)
    );
  }
  const leaksTypeParameter =
    finalExpr !== undefined &&
    typeParameterNames.size > 0 &&
    typeParameterReferencedIn(finalExpr, typeParameterNames) !== undefined;

  // Use an IIFE when either: (a) the body is too complex to reduce to a single
  // expression, (b) a non-simple argument would be duplicated by blind
  // substitution (e.g. `dbl(next())` where `dbl = a => a + a` would evaluate
  // `next()` twice), or (c) the expression still names a type parameter, which
  // only the arrow can declare. The IIFE `((params) => body)(args)` is always
  // semantically correct and naturally binds each parameter once.
  const useIIFE =
    !finalExpr || wouldDuplicateEffectfulArg(fnDecl, argMap) || leaksTypeParameter;

  let exprForPrint: ts.Expression;
  let nodeForImports: ts.Node | ts.Node[];

  if (useIIFE) {
    if (!fnDecl.body) return { error: "Function has no body." };
    const iife = buildIIFE(fnDecl, callExpr, callerFileName.endsWith(".tsx"));
    if (!iife) return { error: "Could not construct IIFE fallback for this function." };
    exprForPrint = iife;
    // The IIFE carries the callee's parameter list as well as its body, so the
    // types annotating those parameters need importing too.
    nodeForImports = [fnDecl.body, ...fnDecl.parameters];
  } else {
    // Preserve side effects of extra arguments (beyond declared parameters).
    // Wrap in parentheses to avoid comma-operator precedence surprises in the
    // caller (e.g. `() => extraArg, result` would be mis-parsed as an arrow
    // returning `extraArg` followed by a standalone `result` expression).
    // A rest parameter already consumed every trailing argument.
    const extraArgs =
      restParamIndex >= 0
        ? []
        : Array.from(callExpr.arguments).slice(fnDecl.parameters.length);
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
  const usedImportedNames = Array.from(
    new Set(
      (Array.isArray(nodeForImports) ? nodeForImports : [nodeForImports]).flatMap(
        (n) => collectUsedImportedNames(n, importedNames)
      )
    )
  );
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

  // Keep only the bindings the inlined code actually mentions: the declaration
  // was pulled in for one of its names, and the rest would land as unused imports.
  const referencedNames = new Set(
    (Array.isArray(nodeForImports) ? nodeForImports : [nodeForImports]).flatMap((n) =>
      Array.from(collectReferencedNames(n))
    )
  );
  const narrowedImports = neededImports
    .map((decl) => narrowImportToUsedNames(decl, referencedNames))
    .filter((decl): decl is ts.ImportDeclaration => decl !== undefined);

  const retargeted = retargetImports(
    narrowedImports,
    fnSourceFile,
    callerFileName,
    resolveModule
  );
  const rewrittenImports = retargeted.imports;

  // Pre-synthesize caller-side inputs only. Callee-body nodes keep their
  // original source positions so the printer can read their text and comments
  // from fnSourceFile, producing output that preserves the original formatting
  // and any doc-comments inside the inlined body.
  //
  // TypeScript's printer reads from sourceFile.text[pos..end] for parsed
  // (pos >= 0) nodes and from stored .text/.escapedText for synthesized
  // (pos < 0) nodes. Caller-side nodes have positions in the caller's file,
  // not fnSourceFile — they must be synthesized so the printer uses stored
  // text rather than reading from the wrong position.
  for (const [, expr] of callerConstEnv) {
    synthesizeTree(expr);
  }
  for (const [, expr] of argMap) {
    synthesizeTree(expr);
  }
  for (const arg of callExpr.arguments) {
    synthesizeTree(arg as ts.Expression);
  }
  for (const typeArg of callExpr.typeArguments ?? []) {
    synthesizeTree(typeArg);
  }
  const inlinedText = printer.printNode(
    ts.EmitHint.Expression,
    exprForPrint,
    fnSourceFile
  );
  return {
    expression: inlinedText.trim(),
    neededImports: rewrittenImports,
    unresolvedImports: retargeted.unresolved
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
