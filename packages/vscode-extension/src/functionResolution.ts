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

const RESOLUTION_ROOT_MARKERS = ["tsconfig.json", "package.json"];

/**
 * The directory whose tsconfig and node_modules govern `filePath`.
 *
 * The VS Code workspace folder is the repo root, which in a monorepo has
 * neither the package's tsconfig (so the LanguageService falls back to
 * default compiler options and resolves nothing) nor its node_modules (fatal
 * under pnpm, where dependencies are only linked into the owning package).
 * Walk up from the file instead; fall back to the workspace root.
 */
function findResolutionRoot(filePath: string, workspaceRoot: string): string {
  let dir = path.dirname(path.resolve(filePath));
  for (;;) {
    if (RESOLUTION_ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return workspaceRoot;
    dir = parent;
  }
}

/**
 * Resolves a module specifier the way the caller's own toolchain will, honoring
 * its tsconfig (`paths`, `moduleResolution`) and the target package's `exports`
 * map and `typesVersions`. Returns the file the specifier lands on.
 */
export type ModuleResolver = (
  specifier: string,
  containingFile: string
) => string | undefined;

export function createModuleResolver(
  currentFileName: string,
  workspaceRoot: string
): ModuleResolver {
  const { host } = getServiceEntry(findResolutionRoot(currentFileName, workspaceRoot));
  const options = host.getCompilationSettings();
  const cache = new Map<string, string | undefined>();

  return (specifier, containingFile) => {
    const key = `${containingFile}\u0000${specifier}`;
    const cached = cache.get(key);
    if (cached !== undefined || cache.has(key)) return cached;

    let resolved: string | undefined;
    try {
      resolved = ts.resolveModuleName(specifier, containingFile, options, ts.sys)
        .resolvedModule?.resolvedFileName;
    } catch {
      resolved = undefined;
    }
    cache.set(key, resolved);
    return resolved;
  };
}

/**
 * Resolve the function declaration for `calleeId` using three strategies:
 *   1. Same-file lookup (no I/O, always tried first).
 *   2. TypeScript LanguageService `getDefinitionAtPosition` — handles aliased
 *      imports, tsconfig `paths`, re-exports, and workspace symlinks.
 *   3. Manual import-walking fallback — handles `.js`-suffix ESM specifiers,
 *      npm source maps, and sibling `.ts` heuristics.
 *
 * Strategies 2 and 3 both land on emitted artifacts for npm dependencies (a
 * `.d.ts` with no bodies, or a bundled `.js`), so both finish by walking
 * declaration maps, source maps, and `export … from` re-export chains back to
 * the original `.ts` source.
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

  const resolutionRoot = findResolutionRoot(currentFileName, workspaceRoot);

  // Strategy 2: LanguageService (aliases, paths, re-exports).
  const lsResult = await tryResolveViaLanguageService(
    calleeId,
    currentSourceFile,
    currentFileName,
    resolutionRoot
  );
  if (lsResult) return lsResult;

  // Strategy 3: manual import walk (fallback for edge cases LS can't handle).
  return tryResolveViaManualWalk(
    name,
    currentSourceFile,
    currentFileName,
    resolutionRoot,
    workspaceRoot
  );
}

// --------------------------------------------------------------------------
// Strategy 2: LanguageService
// --------------------------------------------------------------------------

async function tryResolveViaLanguageService(
  calleeId: ts.Identifier,
  currentSourceFile: ts.SourceFile,
  currentFileName: string,
  resolutionRoot: string
): Promise<FunctionInfo | undefined> {
  try {
    const { service, host } = getServiceEntry(resolutionRoot);
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

      // For an npm dependency the definition is an ambient `.d.ts` overload with
      // no body; follow its declaration map (and any re-exports) to the source.
      const deep = await resolveExportedFunctionDeep(def.fileName, def.name, newDeepContext());
      if (deep) return deep;
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
  resolutionRoot: string,
  workspaceRoot: string
): Promise<FunctionInfo | undefined> {
  const importInfo = findImportForIdentifier(currentSourceFile, name);
  if (!importInfo) return undefined;

  if (importInfo.isRelative) {
    const resolved = resolveRelativeModule(importInfo.moduleSpecifier, currentFileName);
    if (!resolved) return undefined;
    return resolveFirstMatchingName(resolved, exportNamesToTry(importInfo, name));
  }

  // NPM module: resolve from the importing file outward, so pnpm's per-package
  // node_modules are on the search path.
  const resolvedPath = tryResolveNodeModule(importInfo.moduleSpecifier, [
    path.dirname(currentFileName),
    resolutionRoot,
    workspaceRoot
  ]);
  if (!resolvedPath) return undefined;

  return resolveFirstMatchingName(resolvedPath, exportNamesToTry(importInfo, name));
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

// --------------------------------------------------------------------------
// Module + artifact resolution
// --------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const DECLARATION_EXTENSIONS = [".d.ts", ".d.tsx", ".d.mts", ".d.cts"];

function isDeclarationFile(filePath: string): boolean {
  return DECLARATION_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/** A `.ts`/`.tsx` we can read bodies out of (a `.d.ts` has none). */
function isSourceFilePath(filePath: string): boolean {
  return (
    SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext)) && !isDeclarationFile(filePath)
  );
}

function existsAsFile(candidate: string): boolean {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
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
    ...SOURCE_EXTENSIONS.map((ext) => full + ext),
    ...DECLARATION_EXTENSIONS.map((ext) => full + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(full, "index" + ext)),
    ...DECLARATION_EXTENSIONS.map((ext) => path.join(full, "index" + ext)),
    full,
    full + ".js",
    path.join(full, "index.js")
  ];

  for (const c of candidates) {
    if (existsAsFile(c)) return c;
  }

  return undefined;
}

/** Resolve a re-export target, which may be relative or a bare package name. */
function resolveModuleFromFile(
  moduleSpecifier: string,
  fromFile: string
): string | undefined {
  if (moduleSpecifier.startsWith(".")) {
    return resolveRelativeModule(moduleSpecifier, fromFile);
  }
  return tryResolveNodeModule(moduleSpecifier, [path.dirname(fromFile)]);
}

function tryResolveNodeModule(
  moduleSpecifier: string,
  paths: string[]
): string | undefined {
  try {
    return require.resolve(moduleSpecifier, { paths });
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

// --------------------------------------------------------------------------
// Deep resolution: declaration maps, source maps, re-export chains
// --------------------------------------------------------------------------

const MAX_HOP_DEPTH = 8;

/** Visited set + depth budget shared across one resolution attempt. */
interface DeepContext {
  seen: Set<string>;
  depth: number;
}

function newDeepContext(): DeepContext {
  return { seen: new Set<string>(), depth: 0 };
}

function descend(ctx: DeepContext): DeepContext {
  return { seen: ctx.seen, depth: ctx.depth + 1 };
}

function exportNamesToTry(importInfo: ImportInfo, localName: string): string[] {
  // A default import has no exported name to search for; the declaration is
  // usually still named after the local binding.
  return importInfo.importedName === "default" && localName !== "default"
    ? ["default", localName]
    : [importInfo.importedName];
}

async function resolveFirstMatchingName(
  filePath: string,
  names: string[]
): Promise<FunctionInfo | undefined> {
  for (const name of names) {
    const found = await resolveExportedFunctionDeep(filePath, name, newDeepContext());
    if (found) return found;
  }
  return undefined;
}

/**
 * Find the implementation of the function exported as `name` from `filePath`,
 * following whatever indirection stands between them:
 *
 *   - `filePath` is a `.d.ts` or emitted `.js`: hop to the original `.ts` via
 *     its declaration map / source map (or a sibling `.ts`).
 *   - `filePath` only re-exports the name (`export { of } from './of'`,
 *     `export * from './of'`): hop to the target module and keep looking.
 *
 * Package entry points need both: `require.resolve("rxjs")` lands on
 * `dist/cjs/index.js`, whose map leads to `src/index.ts`, which only re-exports
 * `of` from `./internal/observable/of`.
 */
async function resolveExportedFunctionDeep(
  filePath: string,
  name: string,
  ctx: DeepContext
): Promise<FunctionInfo | undefined> {
  if (ctx.depth > MAX_HOP_DEPTH) return undefined;
  const key = `${filePath} ${name}`;
  if (ctx.seen.has(key)) return undefined;
  ctx.seen.add(key);

  const text = await tryReadFile(filePath);
  if (text === undefined) return undefined;
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  if (isSourceFilePath(filePath)) {
    const local =
      findExportedFunctionInSourceFile(sf, name) ?? findFunctionInSourceFile(sf, name);
    if (local) return { sourceFile: sf, node: local };
  } else {
    // An artifact: bodies live in the mapped-from source, if any.
    for (const mapped of await mappedSourcePaths(filePath, text)) {
      const found = await resolveExportedFunctionDeep(mapped, name, descend(ctx));
      if (found) return found;
    }
    const sibling = siblingSourcePath(filePath);
    if (sibling && existsAsFile(sibling)) {
      const found = await resolveExportedFunctionDeep(sibling, name, descend(ctx));
      if (found) return found;
    }
    // An emitted `.js` with no source map: its `.d.ts` may still carry a
    // declaration map, and it keeps the re-export chain the `.js` erased.
    for (const dts of declarationCounterparts(filePath)) {
      const found = await resolveExportedFunctionDeep(dts, name, descend(ctx));
      if (found) return found;
    }
  }

  // Re-export chains, in both sources and artifacts (`.d.ts` barrels keep them).
  for (const hop of findReExportTargets(sf, name)) {
    const target = resolveModuleFromFile(hop.moduleSpecifier, filePath);
    if (!target) continue;
    const found = await resolveExportedFunctionDeep(target, hop.exportedName, descend(ctx));
    if (found) return found;
  }

  return undefined;
}

/**
 * Declaration files that describe an emitted `.js`: the one emitted beside it,
 * and the `types` entry of the package it belongs to (which is where a bundled
 * or bare entry point points).
 */
function declarationCounterparts(filePath: string): string[] {
  if (isDeclarationFile(filePath)) return [];
  const candidates: string[] = [];

  const jsMatch = /\.(js|jsx|mjs|cjs)$/.exec(filePath);
  if (jsMatch) {
    const stem = filePath.slice(0, -jsMatch[0].length);
    candidates.push(stem + ".d.ts", stem + ".d.mts", stem + ".d.cts");
  }

  const typesEntry = packageTypesEntry(filePath);
  if (typesEntry) candidates.push(typesEntry);

  return candidates.filter((c) => c !== filePath && existsAsFile(c));
}

/** The `types`/`typings` entry of the nearest enclosing package.json. */
function packageTypesEntry(filePath: string): string | undefined {
  let dir = path.dirname(filePath);
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          types?: unknown;
          typings?: unknown;
        };
        const entry = typeof pkg.types === "string" ? pkg.types : pkg.typings;
        if (typeof entry === "string") return path.resolve(dir, entry);
      } catch {
        // Unreadable/!JSON package.json: nothing to learn from it.
      }
      return undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** `foo.d.ts` to `foo.ts`, `foo.js` to `foo.ts`. */
function siblingSourcePath(filePath: string): string | undefined {
  for (const ext of DECLARATION_EXTENSIONS) {
    if (filePath.endsWith(ext)) return filePath.slice(0, -ext.length) + ".ts";
  }
  const jsMatch = /\.(js|jsx|mjs|cjs)$/.exec(filePath);
  if (jsMatch) {
    return filePath.slice(0, -jsMatch[0].length) + (jsMatch[1] === "jsx" ? ".tsx" : ".ts");
  }
  return undefined;
}

/**
 * The `.ts` sources an emitted file was generated from, via its adjacent map
 * (`foo.js.map`, `foo.d.ts.map`) or a `sourceMappingURL` comment.
 * `sourceMap` and `declarationMap` are independent tsconfig flags, so a package
 * may ship one, both, or neither.
 */
async function mappedSourcePaths(
  filePath: string,
  fileText: string
): Promise<string[]> {
  let mapPath = filePath + ".map";
  if (!fs.existsSync(mapPath)) {
    const match = /sourceMappingURL=(.+)$/m.exec(fileText);
    const url = match?.[1]?.trim();
    if (!url || url.startsWith("data:")) return [];
    mapPath = path.resolve(path.dirname(filePath), url);
    if (!fs.existsSync(mapPath)) return [];
  }

  const raw = await tryReadFile(mapPath);
  if (raw === undefined) return [];

  let json: { sources?: unknown; sourceRoot?: unknown };
  try {
    json = JSON.parse(raw) as { sources?: unknown; sourceRoot?: unknown };
  } catch {
    return [];
  }

  const sources = json.sources;
  if (!Array.isArray(sources)) return [];
  const sourceRoot = typeof json.sourceRoot === "string" ? json.sourceRoot : "";

  const resolved: string[] = [];
  for (const src of sources) {
    if (typeof src !== "string") continue;
    const full = path.resolve(path.dirname(mapPath), sourceRoot, src);
    if (!isSourceFilePath(full)) continue;
    if (!existsAsFile(full)) continue;
    resolved.push(full);
  }
  return resolved;
}

interface ReExportTarget {
  moduleSpecifier: string;
  /** The name to look for in the target module (`export { a as b }` gives `a`). */
  exportedName: string;
}

/**
 * `export { name } from "./m"`, `export { orig as name } from "./m"`, and
 * `export * from "./m"` (which may or may not supply `name`, so follow it and
 * find out). `export * as ns from "./m"` is namespaced, so it is not a hop.
 */
function findReExportTargets(
  sourceFile: ts.SourceFile,
  name: string
): ReExportTarget[] {
  const targets: ReExportTarget[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const moduleSpecifier = stmt.moduleSpecifier.text;

    if (!stmt.exportClause) {
      targets.push({ moduleSpecifier, exportedName: name });
      continue;
    }
    if (!ts.isNamedExports(stmt.exportClause)) continue;
    for (const spec of stmt.exportClause.elements) {
      if (spec.name.text === name) {
        targets.push({
          moduleSpecifier,
          exportedName: (spec.propertyName ?? spec.name).text
        });
      }
    }
  }
  return targets;
}
