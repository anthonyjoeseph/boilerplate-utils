# Smart Inline — Roadmap

## The model

This is a **relocation tool**, not an evaluator.

The primary job is to copy a function's body to the call site, rewrite its parameters
to the caller's arguments, and bring along whatever the body needs in order to still
resolve in its new home. Impure code is fine — it gets copied, not executed. Purity
is not a precondition, because nothing is being evaluated.

Collapse (constant folding, branch elimination, loop unrolling) is a **second pass**
that runs over the relocated code. It is best-effort and conservative: each construct
either collapses cleanly or is left exactly as it was.

Two rules follow from this framing, and most of the design falls out of them:

1. **Relocation must never change runtime behavior.** Not because the code is pure,
   but because moving code is not supposed to mean anything.
2. **Collapse is all-or-nothing per construct.** If a construct is complicated in any
   way, it stays. Partial or speculative collapse is worse than none.

### The ES6 builtin rule

`Object.keys` / `Object.entries` / `Object.values` / `Array.prototype.map` / `.filter`
/ `.reduce` and friends have well-defined semantics that we could evaluate — but we
only do so when the user **invokes expansion directly on that call**.

A builtin appearing *inside* a body being relocated is copied verbatim and left alone.

This is why there are four commands, not one:

| command | what it acts on |
| --- | --- |
| `smartInlineFunction.inline` | a user-defined function call — relocate it |
| `smartInlineFunction.literal-inline` | an expression — fold it |
| `smartInlineFunction.literal-inline-array` | a `.map(...)` call — evaluate it |
| `smartInlineFunction.literal-inline-object` | an `Object.fromEntries(...)` call — evaluate it |

The split is correct. It should be documented as intentional rather than treated as
overlapping experiments.

---

## Locked decisions

| decision | choice |
| --- | --- |
| Resolution foundation | `ts.LanguageService` over a real `Program` |
| Where the core lives | `packages/vscode-extension`, one package. No LSP extraction — see below |
| Target scope | arbitrary TypeScript, not a curated corpus |
| Multi-statement output | hoist into caller scope when possible; IIFE only as fallback |
| Parameter binding | substitute literals and bare identifiers; `const p = arg;` prologue for anything else |
| Unresolvable references | import what's importable; refuse on mutable module state; otherwise emit and warn |
| Collapse scope | statically-known arrays **and** fixed numeric ranges, with an unroll cap |
| Collapse failure | leave the construct untouched; never emit a half-collapsed form |

---

## Known-wrong today

Grouped by how the failure shows up. Everything below is either covered by a spec in
`tests/spec/cases/` or queued to be.

**Baseline: green.** It was 7 red when this document was written — property-access
arguments, element-access arguments, both destructuring cases, if/else collapse, switch
collapse, and `Object.entries(obj).map(cb)`. The first four and the last are fixed; the
two collapse cases are now `known: broken` specs, which is honest — neither has ever
worked. The package itself does **not** typecheck (43 pre-existing `tsc` errors, mostly
`noUncheckedIndexedAccess`) — **now fixed**, and `tests/` is covered too. `pnpm
typecheck` runs `tsconfig.test.json` over `src` and `tests` together and is clean, so
it can be used as a gate. Spec fixtures under `tests/spec/cases` are excluded from both
typecheck and lint: they are inputs to the tool, and several are deliberately
ill-typed.

### Fixed since this document was written

- ~~**Any body containing a nested function or arrow throws.**~~ **Fixed** —
  `nullTransformationContext` now supplies `factory: ts.factory`. This had blocked every
  callback-taking body: `.map`, `.filter`, `.reduce`.
- ~~**Property keys were substituted like variables.**~~ **Fixed** — `obj.a` with a
  parameter named `a` no longer rewrites the key.
- ~~**Any fold producing a negative number crashed.**~~ **Fixed** —
  `factory.createNumericLiteral` throws a TypeScript Debug Failure on a negative value,
  because the AST has no negative numeric literal, only unary minus over a positive
  one. This killed every subtraction crossing zero, every `-a`, and every multiply or
  divide by a negative constant. Both fold sites now route through a helper. Guarded by
  `folds-to-negative-number` and `negates-a-parameter`.

Both fixes carried a regression that the specs caught, worth recording as a pattern:
rebuilding a member access with `factory.create…` instead of `factory.update…` produces
a fresh node with no `questionDotToken`, silently turning `o?.b` into `o.b`. The
`update…` helpers delegate to the chain variants; the `create…` ones cannot. Guarded by
`optional-chain-dropped` and `optional-chain-element-dropped`.

- ~~**`export default function` declarations are invisible.**~~ **Discovered working** —
  the same-file resolver finds them. Guarded by `export-default-function`.
- ~~**`f?.()` is rejected at the identifier check.**~~ **Discovered working** — for a
  bare-identifier optional call the callee IS an `Identifier`, so the check passes and
  the body is inlined (the `?.` is dropped, which is fine when `f` is always defined).
  Guarded by `optional-call`. The claim was only correct for `obj.f?.()` where the
  callee is a `PropertyAccessExpression`.

### Silently produces wrong code

- **Arguments are duplicated, not bound.** `const dbl = (a) => a + a; dbl(next())`
  expands to `next() + next()`, calling twice. Under destructuring it's worse: every
  field re-evaluates the whole argument expression.
- **Extra arguments are deleted.** The binding loop walks `fnDecl.parameters`, never
  `callExpr.arguments`. `f(sideEffect())` where `f = () => 1` expands to `1`.
- **No hygiene.** Substitution is a blind name match over the entire body, so a
  binding that shadows a parameter gets clobbered, and an argument mentioning a name
  the body also uses gets captured.
- **Relative imports are dropped.** `inliningImports.ts` skips every specifier starting
  with `"."`, so relocating a body that uses a `./helpers` symbol emits a dangling
  identifier with no warning at all.
- **`==` and `!=` are folded as `===` and `!==`.** `isOne("1")` where
  `isOne = (v) => v == 1` folds to `false`; at runtime it is `true`.
- **Cross-file printing uses the wrong `SourceFile`.** `printNode` is handed the
  callee's file but `finalExpr` contains caller-owned argument nodes.
- **Import insertion is textual and fragile.** Dedupe is a substring test against the
  whole document (so an import mentioned inside a comment counts as present), and the
  insert offset is `lastImport.getEnd()` — before the newline — producing
  `import a from "a";import b from "b";`. With no existing imports it inserts at
  offset 0, ahead of any `"use client"` directive or license header.

### Fails loudly, but shouldn't

- **Aliased imports never resolve.** `findImportForIdentifier` computes the real
  imported name and then discards it, so `import { runMe as go }` searches the target
  file for `go`.
- **`.js`-suffixed ESM specifiers never resolve** — the exact style `template-fns` and
  `language-server` use on themselves. So do tsconfig `paths`, `exports` maps, and
  workspace `@scope/pkg` imports through pnpm symlinks.
- **Only top-level declarations are visible.** Nested functions, class methods, and
  object-literal methods are all invisible. (`export default function` was thought to be
  in this group but is handled correctly — see "Fixed since this document was written".)
- **Overloads pick the last declaration**, not the resolved one.
- **Method, namespace, and constructor calls are rejected.** `obj.f()` and `ns.f()`
  fail the identifier check (callee is a `PropertyAccessExpression`). `new F()` is a
  `NewExpression` and is not found by the call-finder at all. `(f)()` fails the
  identifier check (callee is a `ParenthesizedExpression`). `f?.()` is not in this
  group — see "Fixed since this document was written".
- **Any multi-statement body is "too complex."** So are early returns, `throw`, loops,
  `try/catch`, and local `const`s.
- **If/else and switch collapse never fire, for any input.** Constant folding consults
  an environment keyed by *parameter* name, but substitution has already rewritten the
  parameter to the caller's own identifier, which that environment knows nothing about.
  So the condition never reduces to a literal — and because a non-static condition
  aborts the whole expansion rather than just leaving the `if` alone, every function
  with an `if` or `switch` body is refused as "too complex."
- **Caller-side constant propagation is therefore mostly unreachable.** Folding only
  fires when the argument is written as a literal *at the call site*. This is why
  `const` being treated as deep immutability has not bitten yet — see
  `tests/spec/cases/mutated-const-array-not-folded`, which guards the accident.
- **Truthiness doesn't count.** `if (n)` with `n = 0` bails, because only literal
  `true` / `false` are recognized.
- **Most operators never fold** — `&&`, `||`, `??`, `%`, `**`, bitwise, `typeof`,
  `instanceof`, `in` — so the most common guard shape in real code, `if (a && b)`,
  can never reduce.
- **`null`, `undefined`, bigint, and negative numbers aren't simple literals** (`-1`
  parses as a `PrefixUnaryExpression`), so they can't be switch discriminants or cases.
- **Switch fall-through fails** (`case 1: case 2: return x`), as do `break`-based
  switches and any clause with more than one statement.
- **Rest params, nested destructuring, defaults inside patterns, computed property
  names, and `this` params** are all unsupported.
- **Explicit `undefined` skips the default.** `f(undefined)` where `f = (a = 5) => a`
  yields `undefined`.

### Hygiene / packaging

- `activationEvents` uses the pre-1.74 `onCommand:` form.
- `publisher` is the literal placeholder `"your-name-or-org"`.
- `README.md` advertises `ctrl+opt+cmd+click`, `ctrl+opt+cmd+.`, and
  `ctrl+opt+cmd+space`; `package.json` contributes zero keybindings, menus, or config.
- `schema.json` is a 534 KB table dump referenced by nothing.
- `vscode-test@1.6.1` is deprecated and unused.
- The extension is on jest; the rest of the monorepo is on vitest.
- `commandRunners.ts` has a stray mid-file `import` statement.
- `README.md` is a brainstorm, `README.old.md` is the actual feature documentation.

---

## Phases

### Phase 0 — Test harness

Nothing else is safe to attempt until a regression is detectable, and Phase 1 is a
rewrite of the resolution layer.

1. ~~**Behavioral spec harness.**~~ **Done** — `tests/spec/`. Each spec is a runnable
   fixture; the runner expands the marked call, then runs the program before and after
   and compares the effect trace, the returned/threw disposition, and a structural
   encoding of the result. See `tests/spec/README.md`.
2. ~~**Known-broken specs are executable.**~~ **Done** — `"known": "broken"` inverts the
   assertion, so the bug list runs green while open and fails loudly the moment a fix
   lands.
3. ~~**jest → vitest**~~ **Done** — `vitest.config.ts`; `runSpec.ts` was
   framework-agnostic, so only `spec.test.ts` changed.
4. ~~**Repair the red baseline.**~~ **Done** — the suite is green. Property-access and
   element-access arguments and both destructuring cases were genuinely fixed;
   if/else and switch collapse were ported to `known: broken` specs, which is the
   honest outcome since neither has ever worked.
5. ~~**Grow the corpus**~~ **Done** — 38 specs exist, covering every item in
   "Known-wrong today" that is testable with behavioral specs. Three gaps remain
   by design: (a) import insertion fragility needs unit tests not behavioral specs
   (the spec runner uses an idealised applier — see `tests/spec/README.md`);
   (b) tsconfig `paths` / `exports` maps / pnpm workspace symlinks require
   infrastructure the sandbox can't provide; (c) class methods and object-literal
   methods can't be called without method-call syntax, which is already refused.

**Deliberately not in Phase 0: golden-text snapshots.** They belong after Phase 5,
not here. Two reasons, and the second is the one that matters:

- Phase 2 and Phase 3 rewrite the output *shape* — `const p = arg;` prologues,
  alpha-renamed bindings, hoisted statements, IIFE wrappers. Every snapshot written
  today is invalidated by design.
- More seriously, a snapshot taken now records **current wrong output as expected**.
  `next() + next()` becomes a golden file. When Phase 2 fixes the duplication, the
  diff reads as a regression, and the natural reflex — re-bless the snapshot — undoes
  the fix. A snapshot cannot tell "this changed" from "this got better"; only the
  behavioral spec can, and it already does.

Snapshots answer "is the output *readable*", which is Phase 5's question. Write them
when formatting is the thing being worked on.

### Phase 1 — LanguageService foundation ✓ Done

1. ~~**Build a `ts.Program` / `ts.LanguageService` from the workspace tsconfig.**~~ **Done** —
   `functionResolution.ts` builds a `ts.LanguageService` per call backed by a
   `ts.LanguageServiceHost`. Compiler options come from the nearest `tsconfig.json`
   (walking up from the file's directory), with emit constraints (`rootDir`, `outDir`)
   stripped and module resolution forced to `Bundler` so `.js`→`.ts` and pnpm symlinks
   work. A shared `DocumentRegistry` caches lib files across calls; the current file
   always gets a unique version string so the registry never returns stale content when
   the same filename is reused (e.g. in tests) with different source text.
2. ~~**Replace `functionResolution.ts`.**~~ **Done** — The source-map reader,
   `require.resolve` fallback, file-extension guessing loop, and import-name discard
   bug are all deleted. Resolution uses `checker.getResolvedSignature(callExpr)` on the
   call expression from the program's source file; overloads fall back to
   `checker.getSymbolAtLocation` to find the implementation declaration. The
   `resolveFunctionDefinition` signature changed from `(name, sourceFile, fileName,
   workspaceRoot)` to `(callExprStart, fileName, sourceText, workspaceRoot)`.
3. ~~**Aliased imports, `.js` specifiers, tsconfig `paths`.**~~ **Done** — Both
   previously-broken specs (`aliased-import`, `js-suffix-specifier`) now pass and
   their `known: broken` tags are removed.
4. ~~**`checker.getResolvedSignature()` selects the correct overload.**~~ **Done** —
   `getResolvedSignature` is the primary path; symbol declarations are the fallback for
   overloads whose resolved signature points to a declaration without a body.
5. Keep everything in `packages/vscode-extension` — no new package. Keep `src/` free
   of direct `vscode` imports outside the handler layer, which is already true and
   costs nothing to maintain.

### Phase 2 — Relocation correctness

This phase is entirely about not emitting wrong code. No new capability.

1. ~~**Give `visitEachChild` a real transformation context.**~~ **Done.**
2. **Parameter binding.** Substitute literals and bare identifiers directly; emit a
   `const p = arg;` prologue for calls, member chains, object literals, and anything
   else. Preserves evaluation count and order without noisy output in the common case.
3. **Alpha-renaming pass.** Rename callee-local bindings that would collide with
   anything visible at the call site, and rename to avoid capturing names that appear
   in substituted arguments.
4. **Stop dropping extra arguments.** Arguments with no matching parameter must still
   be evaluated — hoist them into the prologue.
5. **Free-variable triage.** Collect every identifier in the relocated body that
   doesn't resolve at the call site and route it through the precedence rules in
   "Handling unresolvable references" below. Includes carrying over relative imports,
   rewriting each specifier to be correct relative to the *caller's* directory.
6. **Rewrite import insertion.** Structural dedupe against parsed `ImportDeclaration`
   nodes rather than a substring test; insert after the last import's trailing
   newline; respect leading directives, shebangs, and license headers.
7. Fix `==` / `!=` folding.
8. Fix `printNode` receiving the wrong `SourceFile` for caller-owned nodes.
9. **Decouple folding from parameter names.** Constant propagation keys on the
   parameter, which substitution has already erased, so it fires almost never.
   Whatever replaces it must respect the escape-analysis constraint that
   `mutated-const-array-not-folded` guards rather than reintroducing that bug.

### Phase 3 — Output shape

1. **Hoist by default.** When the call sits in a statement position — `const x = f(a)`
   or a bare `f(a);` — lift the body's statements into the caller's scope and replace
   the call with the final return expression.
2. **IIFE as fallback.** When the call is buried inside a larger expression, or has
   early returns that can't be flattened, wrap instead. Use an arrow IIFE so `this` is
   preserved; use `await (async () => { ... })()` for async bodies.
3. **Async gating.** An `await` relocated into a synchronous caller is an error —
   offer to make the caller `async` rather than silently producing invalid code.
4. Support the parameter shapes currently rejected: rest params, nested destructuring,
   defaults inside patterns, computed property names, `this` params.
5. Honor parameter defaults for an explicitly passed `undefined`.
6. Support method, namespace, optional-chained, and constructor calls — mostly free
   once Phase 1 lands.

### Phase 4 — Collapse pass

Runs over already-relocated code. Every item here is all-or-nothing per construct.

1. **If/else → ternary**, only when every condition resolves statically. When a
   condition doesn't, leave the entire `if` in place — do not partially rewrite it.
2. **Truthiness**, not just literal `true` / `false`.
3. **Missing operators**: `&&`, `||`, `??`, `%`, `**`, bitwise, `typeof`,
   `instanceof`, `in`.
4. **Widen the literal set** to `null`, `undefined`, bigint, and negative numbers.
5. **Switch**: fall-through clauses, `break`-based forms, multi-statement clauses.
6. **Loop unrolling**, the north-star case — a hand-written `map` built on a `for`
   loop should collapse:
   - over an array whose elements are all statically known at the call site, or
   - over a fixed numeric range `for (let i = 0; i < N; i++)` with constant `N`,
      emitting unrolled statements even when the values aren't known.
   - Requires: derivable bounds, no `break` / `continue` / early return, and a
      configurable **unroll cap** above which the loop is left alone.
7. **Evaluator hardening**: a fuel budget so a divergent loop can't hang the editor;
   throw containment so `f(null)` residualizes as code that throws at runtime rather
   than throwing during expansion; and guards for `-0`, `NaN`, `Infinity`, and
   float-precision artifacts (`0.1 + 0.2` should not become `0.30000000000000004` in
   your source).
8. **Fix `literal-inline`**, which per `TODO.md` never inlines the function itself —
   the `CallExpression` branch of `simplify` rewrites arguments and leaves the callee.

### Phase 5 — Output quality

1. Preserve comments and formatting. Full AST re-printing flattens everything onto one
   line today; consider splicing original text for untouched subtrees instead.
2. Run the result through the project's Prettier and ESLint config.
3. Preserve generic instantiation and `as const`, so relocation doesn't introduce type
   errors even when runtime behavior is identical.
4. **Golden-text snapshots**, deferred from Phase 0. Once formatting is deliberate,
   snapshot the expanded text alongside the behavioral check — the spec proves the
   output is correct, the snapshot proves it is readable.

### Phase 6 — UX

1. Ship the keybindings the README already advertises.
2. Preview/diff pane with attached warnings before applying.
3. Diagnostics naming the exact blocking node, replacing
   `"This function is too complex to inline safely."`
4. Fix `activationEvents`, `publisher`; delete `schema.json` and `vscode-test`.
5. Reconcile `README.md` / `README.old.md` / `TODO.md` / this file into one story.

### Not on the roadmap: LSP extraction

Everything stays in `packages/vscode-extension` until the tool actually works. A second
package buys nothing today and taxes every change with a build step and a version
boundary, and `packages/language-server` stays the `export {}` stub it is.

The one piece of discipline worth keeping: **no `import * as vscode` outside the
handler layer.** `commandHandlers.ts` already takes an injected `VscodeApi` interface,
so the seam exists — the rule is just not to breach it. That costs nothing now and is
the only part that would be expensive to retrofit later. Revisit only if a second
editor is genuinely wanted.

---

## Handling unresolvable references

Every identifier in the relocated body that doesn't resolve at the call site is
classified. The categories overlap, so they are checked **in this order** and the
first match wins.

**1. Mutable module state → refuse.** The body reads or writes a module-level `let` or
`var`. This genuinely cannot be relocated: copying the declaration forks the state, and
importing it can't support writes. Abort the whole expansion and name the offending
binding in the diagnostic. This is the case originally described as "mutates global
variables that the parent function doesn't have access to," and it is the only
hard failure in the list.

**2. Importable → add the import.** The symbol is exported by an npm package or another
module. Add the import to the caller, rewriting relative specifiers relative to the
caller's directory. It is explicitly fine for the import to be unresolved until the
user runs `npm install`.

**3. Everything else → emit, and warn.** Emit the expansion with the reference dangling
and surface a warning listing exactly what is now unresolved. The tool should always
produce output rather than refuse.

The main occupant of category 3 is a **non-exported module-local** — a module-level
`const HELPERS = ...` or an unexported sibling helper. Copying those declarations into
the caller transitively would make far more functions expandable, but it can drag in a
large dependency cone, so it's **out of scope for v1**. Revisit once the fixture corpus
can prove a transitive copy doesn't run away.

---

## Open questions

**What is the unroll cap, and is it configurable?** Both a statement-count and an
iteration-count limit probably need to exist.

**Does `.mts` / `.cts` / plain JavaScript matter?** The extension currently activates
only for `typescript` and `typescriptreact`.

**How are warnings surfaced?** Category 3 above needs somewhere to put them.
`showWarningMessage` is the cheap answer; the Phase 6 preview pane is the good one,
which may argue for pulling that item earlier.
