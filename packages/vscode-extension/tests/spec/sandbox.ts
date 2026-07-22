/**
 * Executes a spec fixture as a real program.
 *
 * Fixtures are TypeScript, so each module is transpiled (never type-checked -
 * a spec asserts runtime behavior, and a fixture is allowed to be
 * type-imperfect) and run through a minimal CommonJS loader inside a single
 * `vm` context.
 *
 * One context is shared by every module in a fixture so that reference identity
 * survives module boundaries - which matters, because losing identity is one of
 * the failures a spec exists to catch.
 *
 * Fixtures are hermetic: only relative imports resolve, so a spec can never
 * depend on node_modules or on anything outside its own directory.
 *
 * Nondeterminism is neutralised rather than forbidden. `Math.random` becomes a
 * fixed sequence and the clock is frozen, so a fixture may use them and still
 * compare cleanly between the before and after runs.
 */
import * as path from "path";
import * as vm from "vm";

import * as ts from "typescript";

import { createRecorder, encode, type Effect } from "./observe";

/** Fixture sources, keyed by path relative to the fixture directory. */
export type ProgramFiles = Readonly<Record<string, string>>;

export interface ExecutionResult {
  /** `"returned"` or `"threw"` - a spec must not turn one into the other. */
  readonly status: "returned" | "threw";
  /** Structural encoding of the returned value, or of the thrown error. */
  readonly value: string;
  readonly effects: readonly Effect[];
}

const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

const FROZEN_CLOCK = 1_700_000_000_000;

const normalise = (p: string): string => p.split(path.sep).join("/");

/**
 * Resolve a relative specifier the way the fixture author means it, including
 * the NodeNext `./foo.js` form that maps onto `foo.ts` on disk.
 */
const resolveSpecifier = (
  fromFile: string,
  specifier: string,
  files: ProgramFiles
): string => {
  if (!specifier.startsWith(".")) {
    throw new Error(
      `spec fixtures are hermetic and may not import "${specifier}"`
    );
  }

  const base = normalise(
    path.posix.normalize(
      path.posix.join(path.posix.dirname(normalise(fromFile)), specifier)
    )
  );

  const withoutJs = base.replace(/\.jsx?$/, "");
  const candidates = [
    base,
    ...MODULE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...MODULE_EXTENSIONS.map((ext) => `${withoutJs}${ext}`),
    ...MODULE_EXTENSIONS.map((ext) => `${base}/index${ext}`)
  ];

  const hit = candidates.find((candidate) =>
    Object.prototype.hasOwnProperty.call(files, candidate)
  );
  if (!hit) {
    throw new Error(
      `cannot resolve "${specifier}" from "${fromFile}" (tried ${candidates.join(", ")})`
    );
  }
  return hit;
};

const transpile = (fileName: string, source: string): string =>
  ts.transpileModule(source, {
    fileName,
    reportDiagnostics: false,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      // Preserve the shape of the code as written; a spec compares behavior,
      // and downlevelling would obscure which construct produced it.
      importHelpers: false
    }
  }).outputText;

interface Sandbox {
  readonly context: vm.Context;
  readonly load: (relPath: string) => Record<string, unknown>;
}

const createSandbox = (
  files: ProgramFiles,
  recorder: ReturnType<typeof createRecorder>
): Sandbox => {
  let seed = 1;
  const deterministicMath: Math = Object.create(Math) as Math;
  Object.defineProperty(deterministicMath, "random", {
    value: () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    }
  });

  class FrozenDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(FROZEN_CLOCK);
      else super(...(args as [number]));
    }
    static override now(): number {
      return FROZEN_CLOCK;
    }
  }

  const cache = new Map<string, Record<string, unknown>>();

  const context = vm.createContext({
    $: recorder,
    Math: deterministicMath,
    Date: FrozenDate,
    console,
    // A fixture that reaches for a timer is out of scope for a spec.
    setTimeout: undefined,
    setInterval: undefined
  });

  const load = (relPath: string): Record<string, unknown> => {
    const cached = cache.get(relPath);
    if (cached) return cached;

    const source = files[relPath];
    if (source === undefined) {
      throw new Error(`spec fixture has no file "${relPath}"`);
    }

    const exports: Record<string, unknown> = {};
    const module = { exports };
    cache.set(relPath, exports);

    const compiled = vm.runInContext(
      `(function (exports, require, module, __filename, __dirname) {\n${transpile(relPath, source)}\n})`,
      context,
      { filename: relPath }
    ) as (
      exports: Record<string, unknown>,
      require: (s: string) => unknown,
      module: { exports: Record<string, unknown> },
      filename: string,
      dirname: string
    ) => void;

    compiled(
      exports,
      (specifier: string) => load(resolveSpecifier(relPath, specifier, files)),
      module,
      relPath,
      path.posix.dirname(relPath)
    );

    // Re-export in case the module reassigned `module.exports` wholesale.
    cache.set(relPath, module.exports);
    return module.exports;
  };

  return { context, load };
};

const describeThrown = (thrown: unknown): string => {
  if (thrown !== null && typeof thrown === "object") {
    const tag = Object.prototype.toString.call(thrown);
    if (tag === "[object Error]") {
      const err = thrown as Error;
      return `${err.name}: ${err.message}`;
    }
  }
  return `non-error thrown: ${encode(thrown)}`;
};

/**
 * Run a fixture and observe it.
 *
 * The entry module must export `run`. Its return value is awaited, so a fixture
 * may exercise async expansions.
 */
export const executeProgram = async (args: {
  readonly files: ProgramFiles;
  readonly entry: string;
}): Promise<ExecutionResult> => {
  const recorder = createRecorder();
  const sandbox = createSandbox(args.files, recorder);

  try {
    const module = sandbox.load(args.entry);
    const run = module["run"];
    if (typeof run !== "function") {
      throw new Error(
        `spec fixture "${args.entry}" must export a \`run\` function`
      );
    }
    const value = await (run as () => unknown)();
    return { status: "returned", value: encode(value), effects: recorder.effects };
  } catch (thrown) {
    return {
      status: "threw",
      value: describeThrown(thrown),
      effects: recorder.effects
    };
  }
};
