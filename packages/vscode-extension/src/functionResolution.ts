import * as ts from "typescript";
import * as path from "path";

export interface FunctionInfo {
  sourceFile: ts.SourceFile;
  node: ts.FunctionLikeDeclaration;
}

// Shared registry so lib files are parsed only once across all calls.
// The current file always gets a unique version so the registry never returns a
// stale AST when the same filename is used with different content (e.g. tests).
const sharedRegistry = ts.createDocumentRegistry();
let buildCount = 0;

function findCompilerOptions(fromDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(fromDir, ts.sys.fileExists, "tsconfig.json");

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );
      if (!parsed.errors.length) {
        return parsed.options;
      }
    }
  }

  // Synthetic defaults: Bundler resolution handles .js→.ts and pnpm symlinks.
  return {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: false
  };
}

function buildLanguageService(
  fileName: string,
  sourceText: string,
  compilerOptions: ts.CompilerOptions
): ts.LanguageService {
  // Unique per call so the registry never reuses a stale AST for the current file.
  const fileVersion = String(++buildCount);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: (file) => (file === fileName ? fileVersion : "0"),
    getScriptSnapshot: (file) => {
      if (file === fileName) {
        return ts.ScriptSnapshot.fromString(sourceText);
      }
      const text = ts.sys.readFile(file);
      return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
    },
    getCurrentDirectory: () => path.dirname(fileName),
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (file) => (file === fileName ? true : ts.sys.fileExists(file)),
    readFile: (file) => (file === fileName ? sourceText : ts.sys.readFile(file)),
    readDirectory: ts.sys.readDirectory.bind(ts.sys),
    directoryExists: ts.sys.directoryExists.bind(ts.sys),
    getDirectories: ts.sys.getDirectories.bind(ts.sys)
  };

  return ts.createLanguageService(host, sharedRegistry);
}

function findCallExpressionAtStart(
  sf: ts.SourceFile,
  start: number
): ts.CallExpression | undefined {
  function visit(node: ts.Node): ts.CallExpression | undefined {
    if (ts.isCallExpression(node) && node.getStart(sf) === start) return node;
    return ts.forEachChild(node, visit);
  }
  return visit(sf);
}

function extractFunctionLike(
  decl: ts.SignatureDeclaration
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isFunctionLike(decl)) {
    const fn = decl as ts.FunctionLikeDeclaration;
    return fn.body ? fn : undefined;
  }
  return undefined;
}

/**
 * Resolve the function definition for the call expression starting at
 * `callExprStart` in `fileName` / `sourceText`.
 *
 * Uses a `ts.LanguageService` built from the nearest tsconfig (or synthetic
 * defaults) so aliased imports, .js-suffixed specifiers, tsconfig paths, and
 * pnpm workspace symlinks all resolve correctly.
 */
export function resolveFunctionDefinition(
  callExprStart: number,
  fileName: string,
  sourceText: string,
  _workspaceRoot: string
): FunctionInfo | undefined {
  const compilerOptions = findCompilerOptions(path.dirname(fileName));
  const ls = buildLanguageService(fileName, sourceText, compilerOptions);
  const program = ls.getProgram();
  if (!program) return undefined;

  // TypeScript normalizes paths; try both forms.
  const normalizedFileName = ts.sys.resolvePath(fileName);
  const callerSf =
    program.getSourceFile(normalizedFileName) ??
    program.getSourceFile(fileName);
  if (!callerSf) return undefined;

  const callExpr = findCallExpressionAtStart(callerSf, callExprStart);
  if (!callExpr) return undefined;

  const checker = program.getTypeChecker();

  // Use the type checker to get the resolved signature — handles overloads
  // and cross-file resolution in one step.
  let sig: ts.Signature | undefined;
  try {
    sig = checker.getResolvedSignature(callExpr);
  } catch {
    return undefined;
  }
  if (!sig) return undefined;

  const decl = sig.declaration;
  if (!decl || ts.isJSDocSignature(decl)) return undefined;

  // Happy path: declaration has a body.
  const directFn = extractFunctionLike(decl);
  if (directFn) {
    return { sourceFile: directFn.getSourceFile(), node: directFn };
  }

  // Overload without body: search the callee symbol's declarations for the
  // implementation (the one that actually has a body).
  const calleeSymbol = checker.getSymbolAtLocation(callExpr.expression);
  if (!calleeSymbol) return undefined;

  for (const symbolDecl of calleeSymbol.declarations ?? []) {
    if (ts.isFunctionLike(symbolDecl)) {
      const fn = symbolDecl as ts.FunctionLikeDeclaration;
      if (fn.body) {
        return { sourceFile: fn.getSourceFile(), node: fn };
      }
    }
  }

  return undefined;
}
