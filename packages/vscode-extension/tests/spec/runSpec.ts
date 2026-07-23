/**
 * The spec runner.
 *
 * A spec is a directory holding a small, runnable TypeScript program with a
 * cursor marker on one call. The runner:
 *
 *   1. strips the marker to recover the program and the selection
 *   2. asks the extension to expand the call at that selection
 *   3. applies the resulting edit to produce the expanded program
 *   4. runs *both* programs and compares what they did
 *
 * Step 4 is the point. A golden-text comparison only says the output looks like
 * it did last week; running both programs says the expansion did not change the
 * meaning of the code. Relocating code is one of the few transformations where
 * that is directly checkable, so the harness checks it.
 *
 * Equivalence means all three of: the same effect trace, in the same order,
 * with the same repeat counts; the same returned/threw disposition; and the
 * same structural encoding of the result.
 */
import * as path from "path";

import { runSmartInline } from "../../src/commandRunners";

import { executeProgram, type ExecutionResult, type ProgramFiles } from "./sandbox";

export type { ProgramFiles };

const CARET = "/*|*/";
const OPEN = "/*<*/";
const CLOSE = "/*>*/";

export interface Selection {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Recover the selection from a fixture.
 *
 * `/*|*\/` marks an empty cursor - what a user actually has when they invoke
 * the command without selecting anything. `/*<*\/expr/*>*\/` marks a range.
 */
export const stripMarkers = (text: string): Selection => {
  const open = text.indexOf(OPEN);
  if (open !== -1) {
    const close = text.indexOf(CLOSE);
    if (close === -1) {
      throw new Error(`fixture has ${OPEN} without a matching ${CLOSE}`);
    }
    const stripped =
      text.slice(0, open) +
      text.slice(open + OPEN.length, close) +
      text.slice(close + CLOSE.length);
    // Padding the markers keeps fixtures readable, but a selection wider than
    // the node it targets contains nothing, so trim back to the marked text.
    const inner = text.slice(open + OPEN.length, close);
    const lead = inner.length - inner.trimStart().length;
    const trail = inner.length - inner.trimEnd().length;
    return {
      text: stripped,
      start: open + lead,
      end: close - OPEN.length - trail
    };
  }

  const caret = text.indexOf(CARET);
  if (caret === -1) {
    throw new Error(`fixture has no cursor marker (expected ${CARET} or ${OPEN})`);
  }
  return {
    text: text.slice(0, caret) + text.slice(caret + CARET.length),
    start: caret,
    end: caret
  };
};

export interface SpecConfig {
  /** Entry file within the fixture directory. Defaults to `entry.ts`. */
  readonly entry?: string;
  /**
   * `"equivalent"` - the expansion must succeed and preserve behavior.
   * `"refuse"`     - the expansion must be declined, with a useful message.
   */
  readonly expect?: "equivalent" | "refuse";
  /** For `expect: "refuse"` - substring the diagnostic must contain. */
  readonly errorIncludes?: string;
  /**
   * Marks a spec the tool does not yet satisfy. The runner then asserts the
   * spec *fails*, and reports loudly once it starts passing. This keeps the
   * known-broken list executable and green rather than aspirational prose.
   */
  readonly known?: "broken";
  /** Why it is broken - shown in the test name. */
  readonly reason?: string;
  /**
   * Expected text of the inlined expression. When present the runner checks
   * the actual expression against this string after the behavioral comparison.
   * Populate once the output is deliberate — it answers "is it readable"
   * while the behavioral spec answers "is it correct".
   */
  readonly golden?: string;
}

export interface SpecCase {
  readonly name: string;
  readonly dir: string;
  readonly entry: string;
  readonly config: SpecConfig;
  readonly files: ProgramFiles;
}

export type SpecOutcome =
  | { readonly ok: true; readonly expandedText?: string }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

/**
 * Apply the extension's edit.
 *
 * This is the *idealised* applier: replace the call, then add any missing
 * imports at the top of the file. It deliberately does not reproduce the
 * quirks of the vscode handler's textual insertion - a behavioral spec is
 * about the transformation, and the handler's insertion logic gets its own
 * unit tests.
 */
export const applyExpansion = (
  sourceText: string,
  result: {
    readonly expression: string;
    readonly neededImportTexts: readonly string[];
    readonly replaceStart: number;
    readonly replaceEnd: number;
  }
): string => {
  const replaced =
    sourceText.slice(0, result.replaceStart) +
    result.expression +
    sourceText.slice(result.replaceEnd);

  const missing = result.neededImportTexts.filter(
    (line) => !replaced.includes(line.trim())
  );
  return missing.length > 0 ? `${missing.join("")}${replaced}` : replaced;
};

const renderRun = (label: string, run: ExecutionResult): string =>
  [
    `${label}:`,
    `  status  ${run.status}`,
    `  value   ${run.value}`,
    `  effects ${run.effects.length === 0 ? "(none)" : ""}`,
    ...run.effects.map((e) => `    ${e}`)
  ].join("\n");

const firstDivergence = (
  before: readonly string[],
  after: readonly string[]
): string | undefined => {
  const limit = Math.max(before.length, after.length);
  for (let i = 0; i < limit; i++) {
    if (before[i] !== after[i]) {
      return `effect #${i + 1}: before ${before[i] ?? "(nothing)"} / after ${after[i] ?? "(nothing)"}`;
    }
  }
  return undefined;
};

const compare = (
  before: ExecutionResult,
  after: ExecutionResult
): SpecOutcome => {
  const detail = `${renderRun("before", before)}\n${renderRun("after", after)}`;

  const divergence = firstDivergence(before.effects, after.effects);
  if (divergence) {
    return { ok: false, reason: `effect trace diverged - ${divergence}`, detail };
  }
  if (before.status !== after.status) {
    return {
      ok: false,
      reason: `disposition changed - before ${before.status}, after ${after.status}`,
      detail
    };
  }
  if (before.value !== after.value) {
    return {
      ok: false,
      reason: `result changed - before ${before.value}, after ${after.value}`,
      detail
    };
  }
  return { ok: true };
};

/**
 * Check a single spec. Pure with respect to the filesystem: the caller supplies
 * the fixture's files, so the corpus loader and the checker can be tested
 * independently.
 */
export const checkSpec = async (kase: SpecCase): Promise<SpecOutcome> => {
  const raw = kase.files[kase.entry];
  if (raw === undefined) {
    return { ok: false, reason: `fixture has no entry file "${kase.entry}"` };
  }

  const selection = stripMarkers(raw);
  const filesBefore: ProgramFiles = { ...kase.files, [kase.entry]: selection.text };

  const result = await runSmartInline({
    sourceText: selection.text,
    start: selection.start,
    end: selection.end,
    fileName: path.join(kase.dir, kase.entry),
    workspaceRoot: kase.dir,
    scriptKind: kase.entry.endsWith("x") ? "tsx" : "ts"
  });

  const expectation = kase.config.expect ?? "equivalent";

  if (!result.ok) {
    if (expectation !== "refuse") {
      return { ok: false, reason: `expansion was refused: ${result.error}` };
    }
    const needle = kase.config.errorIncludes;
    if (needle && !result.error.includes(needle)) {
      return {
        ok: false,
        reason: `diagnostic did not mention ${JSON.stringify(needle)}`,
        detail: result.error
      };
    }
    return { ok: true };
  }

  if (expectation === "refuse") {
    return {
      ok: false,
      reason: "expected the expansion to be refused, but it succeeded",
      detail: result.expression
    };
  }

  const expandedText = applyExpansion(selection.text, result);
  const filesAfter: ProgramFiles = { ...kase.files, [kase.entry]: expandedText };

  const [before, after] = await Promise.all([
    executeProgram({ files: filesBefore, entry: kase.entry }),
    executeProgram({ files: filesAfter, entry: kase.entry })
  ]);

  const verdict = compare(before, after);
  if (!verdict.ok) return verdict;

  if (kase.config.golden !== undefined && result.expression !== kase.config.golden) {
    return {
      ok: false,
      reason: "golden text mismatch",
      detail: `expected:\n${kase.config.golden}\n\nactual:\n${result.expression}`
    };
  }

  return { ok: true, expandedText };
};
