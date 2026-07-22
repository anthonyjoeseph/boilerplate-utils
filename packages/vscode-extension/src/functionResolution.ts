import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

export interface FunctionInfo {
  sourceFile: ts.SourceFile;
  node: ts.FunctionLikeDeclaration;
}

// --------------------------------------------------------------------------
// LanguageService cache (one service per workspace root)
// --------------------------------------------------------------------------

interface ServiceEntry {
  service: ts.LanguageService;
  host: SimpleLanguageServiceHost;
}

const serviceCache = new Map<string, ServiceEntry>();

class SimpleLanguageServiceHost implements ts.LanguageServiceHost {
  private readonly root: string;
  private readonly compilerOptions: ts.CompilerOptions;
  private readonly overrides = new Map<string, string>();
  private readonly versions = new Map<string, number>();

  constructor(workspaceRoot: string) {
    this.root = workspaceRoot;
    const cfgPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
    if (cfgPath) {
      const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        raw.config as object,
        ts.sys,
        path.dirname(cfgPath)
      );
      this.compilerOptions = parsed.options;
    } else {
      this.compilerOptions = { target: ts.ScriptTarget.Latest, allowJs: true };
    }
  }

  setFileContent(fileName: string, content: string): void {
    this.overrides.set(fileName, content);
    this.versions.set(fileName, (this.versions.get(fileName) ?? 0) + 1);
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  getScriptFileNames(): string[] {
    return [...this.overrides.keys()];
  }

  getScriptVersion(fileName: string): string {
    return String(this.versions.get(fileName) ?? 0);
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const ov = this.overrides.get(fileName);
    if (ov !== undefined) return ts.ScriptSnapshot.fromString(ov);
    const text = ts.sys.readFile(fileName);
    if (text !== undefined) return ts.ScriptSnapshot.fromString(text);
    return undefined;
  }

  getCurrentDirectory(): string {
    return this.root;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  fileExists(fileName: string): boolean {
    return this.overrides.has(fileName) || ts.sys.fileExists(fileName);
  }

  readFile(fileName: string, encoding?: string): string | undefined {
    return ts.sys.readFile(fileName, encoding);
  }

  readDirectory(
    dirPath: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number
  ): string[] {
    return ts.sys.readDirectory(dirPath, extensions, exclude, include, depth);
  }

  directoryExists(dirName: string): boolean {
    return ts.sys.directoryExists(dirName);
  }

  getDirectories(dirName: string): string[] {
    return ts.sys.getDirectories(dirName);
  }
}

function getServiceEntry(workspaceRoot: string): ServiceEntry {
  let entry = serviceCache.get(workspaceRoot);
  if (!entry) {
    const host = new SimpleLanguageServiceHost(workspaceRoot);
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    entry = { service, host };
    serviceCache.set(workspaceRoot, entry);
  }
  return entry;
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Resolve the function declaration for `calleeId` using three strategies:
 *   1. Same-file lookup (no I/O, always tried first).
 *   2. TypeScript LanguageService `getDefinitionAtPosition` — handles aliased
 *      imports, tsconfig `paths`, re-exports, and workspace symlinks.
 *   3. Manual import-walking fallback — handles `.js`-suffix ESM specifiers,
 *      npm source maps, and sibling `.ts` heuristics.
 */
export async function resolveFunctionDefinition(
  calleeId: ts.Identifier,
  currentSourceFile: ts.SourceFile,
  currentFileName: string,
  workspaceRoot: string
): Promise<FunctionInfo | undefined> {
  const name = calleeId.text;

  // Strategy 1: same-file declaration (no disk access).
  const local = findFunctionInSourceFile(currentSourceFile, name);
  if (local) return { sourceFile: currentSourceFile, node: local };

  // Strategy 2: LanguageService (aliases, paths, re-exports).
  const lsResult = await tryResolveViaLanguageService(
    calleeId,
    currentSourceFile,
    currentFileName,
    workspaceRoot
  );
  if (lsResult) return lsResult;

  // Strategy 3: manual import walk (fallback for edge cases LS can't handle).
  return tryResolveViaManualWalk(name, currentSourceFile, currentFileName, workspaceRoot);
}

// --------------------------------------------------------------------------
// Strategy 2: LanguageService
// --------------------------------------------------------------------------

async function tryResolveViaLanguageService(
  calleeId: ts.Identifier,
  currentSourceFile: ts.SourceFile,
  currentFileName: string,
  workspaceRoot: string
): Promise<FunctionInfo | undefined> {
  try {
    const { service, host } = getServiceEntry(workspaceRoot);
    // Inject the live buffer so the LS sees unsaved edits.
    host.setFileContent(currentFileName, currentSourceFile.text);

    const pos = calleeId.getStart(currentSourceFile);
    const defs = service.getDefinitionAtPosition(currentFileName, pos);
    if (!defs || defs.length === 0) return undefined;

    for (const def of defs) {
      if (def.fileName === currentFileName) continue;

      const defText = await tryReadFile(def.fileName);
      if (!defText) continue;

      const defSf = ts.createSourceFile(def.fileName, defText, ts.ScriptTarget.Latest, true);

      // def.name is the resolved export name (e.g. "addTwo" even when imported as "add").
      const byName =
        findFunctionInSourceFile(defSf, def.name) ??
        findExportedFunctionInSourceFile(defSf, def.name);
      if (byName) return { sourceFile: defSf, node: byName };

      // Position-based fallback for anonymous defaults or unusual patterns.
      const byPos = findFunctionAtPosition(defSf, def.textSpan.start);
      if (byPos) return { sourceFile: defSf, node: byPos };
    }
  } catch {
    // LanguageService errors are non-fatal; fall through to manual walk.
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Strategy 3: manual import walk
// --------------------------------------------------------------------------

interface ImportInfo {
  moduleSpecifier: string;
  isRelative: boolean;
  /**
   * The name as exported by the target module, which differs from the local
   * binding under `import { a as b }`. Resolution still searches for the
   * importedName (original export) rather than the local alias.
   */
  importedName: string;
}

async function tryResolveViaManualWalk(
  name: string,
  currentSourceFile: ts.SourceFile,
  currentFileName: string,
  workspaceRoot: string
): Promise<FunctionInfo | undefined> {
  const importInfo = findImportForIdentifier(currentSourceFile, name);
  if (!importInfo) return undefined;

  if (importInfo.isRelative) {
    const resolved = resolveRelativeModule(importInfo.moduleSpecifier, currentFileName);
    if (!resolved) return undefined;
    const text = await tryReadFile(resolved);
    if (!text) return undefined;
    const sf = ts.createSourceFile(resolved, text, ts.ScriptTarget.Latest, true);
    const fn = findExportedFunctionInSourceFile(sf, importInfo.importedName);
    return fn ? { sourceFile: sf, node: fn } : undefined;
  }

  // NPM module: try sibling .ts first, then source maps.
  const resolvedPath = tryResolveNodeModule(importInfo.moduleSpecifier, workspaceRoot);
  if (!resolvedPath) return undefined;

  const siblingTs = resolvedPath.replace(/\.js(x?)$/, ".ts$1");
  if (fs.existsSync(siblingTs)) {
    const text = await tryReadFile(siblingTs);
    if (text) {
      const sf = ts.createSourceFile(siblingTs, text, ts.ScriptTarget.Latest, true);
      const fn = findExportedFunctionInSourceFile(sf, name);
      if (fn) return { sourceFile: sf, node: fn };
    }
  }

  return tryResolveFromSourceMap(resolvedPath, name);
}

// --------------------------------------------------------------------------
// AST helpers
// --------------------------------------------------------------------------

function findFunctionInSourceFile(
  sourceFile: ts.SourceFile,
  name: string
): ts.FunctionLikeDeclaration | undefined {
  let match: ts.FunctionLikeDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      node.body
    ) {
      match = node;
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (
            decl.name.text === name &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            match = decl.initializer;
            return;
          }
        }
      }
    }
  });

  return match;
}

function findExportedFunctionInSourceFile(
  sourceFile: ts.SourceFile,
  name: string
): ts.FunctionLikeDeclaration | undefined {
  let match: ts.FunctionLikeDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      node.body
    ) {
      const hasExportModifier = !!node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword
      );
      if (hasExportModifier || isExportedViaExportList(sourceFile, name)) {
        match = node;
        return;
      }
    }

    if (ts.isVariableStatement(node)) {
      const hasExportModifier = !!node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword
      );
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (
            decl.name.text === name &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            if (hasExportModifier || isExportedViaExportList(sourceFile, name)) {
              match = decl.initializer;
              return;
            }
          }
        }
      }
    }
  });

  return match;
}

function isExportedViaExportList(sourceFile: ts.SourceFile, name: string): boolean {
  let exported = false;
  sourceFile.forEachChild((node) => {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const spec of node.exportClause.elements) {
        if (spec.name.text === name) {
          exported = true;
          return;
        }
      }
    }
  });
  return exported;
}

/**
 * Find the function-like declaration whose name identifier spans position `pos`
 * (character offset in sourceFile.text, no leading trivia). Used as a fallback
 * when name-based search fails (e.g. anonymous default exports).
 */
function findFunctionAtPosition(
  sourceFile: ts.SourceFile,
  pos: number
): ts.FunctionLikeDeclaration | undefined {
  function visit(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
    if (pos < node.pos || pos > node.end) return undefined;

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.name.pos <= pos &&
      pos <= node.name.end &&
      node.body
    ) {
      return node;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.pos <= pos &&
      pos <= node.name.end &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      return node.initializer;
    }

    return ts.forEachChild(node, visit);
  }
  return ts.forEachChild(sourceFile, visit);
}

function findImportForIdentifier(
  sourceFile: ts.SourceFile,
  name: string
): ImportInfo | undefined {
  for (const stmt of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !stmt.importClause ||
      !stmt.moduleSpecifier
    )
      continue;
    const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    // import runMe from "./foo";
    if (stmt.importClause.name && stmt.importClause.name.text === name) {
      return {
        moduleSpecifier,
        isRelative: moduleSpecifier.startsWith("."),
        importedName: "default"
      };
    }

    // import { runMe } from "./foo";
    if (
      stmt.importClause.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const element of stmt.importClause.namedBindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        const localName = element.name.text;
        if (localName === name) {
          return {
            moduleSpecifier,
            isRelative: moduleSpecifier.startsWith("."),
            importedName
          };
        }
      }
    }

    // import * as ns from "./foo"; -> ns.runMe (not supported)
  }
  return undefined;
}

function resolveRelativeModule(
  moduleSpecifier: string,
  fromFile: string
): string | undefined {
  const base = path.dirname(fromFile);
  // Strip .js extension: ESM-style imports use .js to reference .ts sources.
  const specifier = moduleSpecifier.endsWith(".js")
    ? moduleSpecifier.slice(0, -3)
    : moduleSpecifier;
  const full = path.resolve(base, specifier);

  const candidates = [
    full,
    full + ".ts",
    full + ".tsx",
    path.join(full, "index.ts"),
    path.join(full, "index.tsx")
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }

  return undefined;
}

function tryResolveNodeModule(
  moduleSpecifier: string,
  workspaceRoot: string
): string | undefined {
  try {
    const resolved = require.resolve(moduleSpecifier, {
      paths: [workspaceRoot]
    });
    return resolved;
  } catch {
    return undefined;
  }
}

async function tryReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function tryResolveFromSourceMap(
  jsFilePath: string,
  functionName: string
): Promise<FunctionInfo | undefined> {
  const dir = path.dirname(jsFilePath);
  let mapPath = jsFilePath + ".map";

  if (!fs.existsSync(mapPath)) {
    let jsText: string;
    try {
      jsText = await fs.promises.readFile(jsFilePath, "utf8");
    } catch {
      return undefined;
    }

    const match = jsText.match(/\/\/# sourceMappingURL=(.+)$/m);
    if (!match) return undefined;
    const sourceMappingUrl = match[1];
    if (!sourceMappingUrl) return undefined;
    mapPath = path.resolve(dir, sourceMappingUrl);
    if (!fs.existsSync(mapPath)) return undefined;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(mapPath, "utf8");
  } catch {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const sources: string[] | undefined = (json as { sources?: string[] }).sources;
  if (!Array.isArray(sources)) return undefined;

  for (const srcRel of sources) {
    const srcPath = path.resolve(path.dirname(mapPath), srcRel);
    if (!srcPath.endsWith(".ts") && !srcPath.endsWith(".tsx")) continue;
    const text = await tryReadFile(srcPath);
    if (!text) continue;
    const sf = ts.createSourceFile(srcPath, text, ts.ScriptTarget.Latest, true);
    const fn = findExportedFunctionInSourceFile(sf, functionName);
    if (fn) return { sourceFile: sf, node: fn };
  }

  return undefined;
}
