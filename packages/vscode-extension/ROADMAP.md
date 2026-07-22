# Smart Inline — Roadmap

Smart Inline is a VS Code extension (`packages/vscode-extension`) that expands a
TypeScript call at the cursor.

## What the tool does

It is a **relocation tool, not an evaluator**. Its main job: copy a function's body
to the call site, rewrite the parameters to the caller's arguments, and bring along
anything the body needs to still resolve in its new home. Impure code is fine — it is
copied, not executed.

**Collapse** (constant folding, branch elimination, loop unrolling) is a separate,
best-effort second pass over the relocated code.

Two rules govern everything:

1. **Relocation must never change runtime behavior.** Moving code is not supposed to
   mean anything.
2. **Collapse is all-or-nothing per construct.** If a construct is complicated in any
   way, leave it exactly as it was. A half-collapsed form is worse than none.

### The ES6 builtin rule

Builtins like `Object.entries`, `.map`, `.filter`, and `.reduce` have semantics we can
evaluate — but we only evaluate one when the cursor is **directly on that call**. A
builtin *inside* a body being relocated is copied verbatim.

## How the command works

There is **one command**, `smartInlineFunction.inline`. It looks at what the cursor is
on, walks outward from the cursor, and takes the first behavior that matches:

| the cursor is on… | behavior | result |
| --- | --- | --- |
| `Object.fromEntries(...)` | evaluate object | reduce to an object literal |
| `.map(...)` | evaluate array | reduce to an array literal |
| a call to a plain function name, e.g. `f(x)` | relocate | inline the function body |
| any other expression | fold | constant-fold the expression |

If nothing matches, the command reports "nothing to inline here". If the chosen
behavior can't complete (e.g. the function is too complex to relocate), it reports
*why* — it does not silently fall back to another behavior.

The cursor position is how the user chooses the behavior. This is also what the ES6
builtin rule needs: a nested `.map` is a *child* of the outer call, so walking outward
from a cursor on the outer call never reaches it.

### Where the code lives

| file | role |
| --- | --- |
| `src/inlineDispatch.ts` | `classifyInlineTarget` — picks the behavior from the cursor |
| `src/commandRunners.ts` | `runInline` — dispatches to a behavior; the per-behavior runners |
| `src/commandHandlers.ts` | `handleSmartInline` — the command; applies the edit. Takes an injected `VscodeApi` so it is testable |
| `src/inlining*.ts` | the relocation engine and collapse pass |
| `src/functionResolution.ts` | finds a called function's declaration |
| `tests/spec/` | behavioral specs for the relocation engine (see Testing) |
| `tests/inline.integration.test.ts` | tests the command's dispatch |

## Design rules

These constrain all future work.

- **Keep everything in `packages/vscode-extension`.** No separate language-server
  package until the tool actually works — it would tax every change for no benefit.
- **No `vscode` imports outside the handler layer.** `commandHandlers.ts` takes an
  injected `VscodeApi`; keep the rest of `src/` free of `vscode` so it stays
  unit-testable.

### References that don't resolve at the call site

When a relocated body uses a name that isn't in scope at the call site, classify it —
first match wins:

1. **Mutable module state (`let` / `var` at module level) → refuse.** Copying forks the
   state; importing can't support writes. Abort and name the binding.
2. **Importable (exported by a module or package) → add the import** to the caller,
   rewriting relative paths relative to the caller's directory. It's fine if the import
   is unresolved until `npm install`.
3. **Anything else → emit anyway, and warn**, listing what is now unresolved. Always
   produce output rather than refuse.

(Copying a non-exported module-local declaration into the caller is out of scope for
now — it can drag in a large dependency cone.)

## Current limitations

What doesn't work yet. Each should get a behavioral spec in `tests/spec/` when fixed.

**Relocation emits wrong code:**
- Arguments are duplicated instead of bound, so an effectful argument runs more than once.
- Extra arguments (more than parameters) are dropped, losing their effects.
- No hygiene: substitution is a blind name match, so shadowing bindings get clobbered
  and argument names can be captured.
- Relative imports in the callee are dropped, leaving dangling references.
- `==` / `!=` fold with `===` / `!==` semantics.
- Cross-file relocation prints caller-owned nodes against the wrong source file.
- Import insertion is textual: fragile dedupe, wrong offsets, ignores leading
  directives and headers.

**Resolution is limited:**
- Aliased imports (`import { a as b }`) don't resolve.
- `.js`-suffixed specifiers, tsconfig `paths`, `exports` maps, and pnpm workspace
  symlinks don't resolve.
- Only top-level declarations are visible — nested functions and class/object methods
  aren't.
- Overloads pick the last declaration, not the resolved one.
- Method (`obj.f()`), namespace (`ns.f()`), and constructor (`new F()`) calls aren't
  relocated. They route to fold, which reprints them unchanged (see the no-op item in
  Phase 6).

**Relocation refuses too much:**
- Any multi-statement body is "too complex" — as are early returns, `throw`, loops,
  `try` / `catch`, and local `const`s.
- Unsupported parameter shapes: rest params, nested destructuring, defaults inside
  patterns, computed names, `this`.
- Explicit `undefined` skips a parameter default (`f(undefined)` with `(a = 5)` yields
  `undefined`).

**Collapse barely fires:**
- if/else and switch collapse never fire (the condition is rewritten before it can
  reduce).
- Only literal `true` / `false` count — truthiness (`if (n)` with `n = 0`) doesn't.
- Most operators never fold: `&&`, `||`, `??`, `%`, `**`, bitwise, `typeof`,
  `instanceof`, `in`.
- `null`, `undefined`, bigint, and negative numbers aren't treated as simple literals.
- Switch fall-through, `break`-based switches, and multi-statement clauses fail.

**Packaging:**
- `publisher` is the placeholder `"your-name-or-org"`.
- The README advertises keybindings that `package.json` doesn't contribute.
- `schema.json` (534 KB) and `vscode-test` are unused.
- `README.md`, `README.old.md`, and `TODO.md` tell overlapping, inconsistent stories.

## What we want next

Ordered roughly by dependency. Phase 1 unlocks much of the rest.

### Phase 1 — Resolve through the TypeScript checker
Build a `ts.Program` / `ts.LanguageService` from the workspace tsconfig; cache it and
invalidate on edit. Replace `functionResolution.ts` with `getDefinitionAtPosition`
plus the type checker. This fixes, for free: aliased imports, `.js` specifiers,
tsconfig `paths` / `exports`, re-exports, workspace symlinks, nested declarations, and
overload selection (via `getResolvedSignature`).

### Phase 2 — Make relocation correct
No new capability; just stop emitting wrong code.
- Bind parameters: substitute literals and bare identifiers directly; emit a
  `const p = arg;` prologue for anything else, preserving evaluation count and order.
- Alpha-rename callee-local bindings that would collide with or capture names at the
  call site.
- Evaluate extra arguments (hoist into the prologue) instead of dropping them.
- Carry over the body's unresolved names using the rules in "References that don't
  resolve", including rewriting relative import paths.
- Rewrite import insertion: dedupe against parsed imports, insert after the last
  import, respect directives / shebangs / headers.
- Fix `==` / `!=` folding and the wrong-source-file printing.

### Phase 3 — Output shape and more call kinds
- **Hoist by default:** in a statement position (`const x = f(a)` or `f(a);`), lift the
  body's statements into the caller and replace the call with the return expression.
- **IIFE as fallback:** when the call is inside a larger expression or has early
  returns, wrap in an arrow IIFE (preserves `this`); use `await (async () => {…})()`
  for async bodies.
- **Async gating:** relocating an `await` into a sync caller is an error — offer to
  make the caller `async`.
- Support method, namespace, optional-chained, and constructor calls (mostly free after
  Phase 1).
- Support the rejected parameter shapes; honor a default for explicit `undefined`.

### Phase 4 — Collapse pass
Runs over relocated code, all-or-nothing per construct.
- if/else → ternary, only when every condition resolves statically.
- Recognize truthiness, not just literal `true` / `false`.
- Add operators: `&&`, `||`, `??`, `%`, `**`, bitwise, `typeof`, `instanceof`, `in`.
- Widen literals to `null`, `undefined`, bigint, negative numbers.
- Switch: fall-through, `break`-based, multi-statement clauses.
- **Loop unrolling** (the north-star): a hand-written `map` / `for` collapses when the
  array elements or a fixed numeric range are statically known. Requires derivable
  bounds, no `break` / `continue` / early return, and a configurable **unroll cap**.
- Evaluator hardening: a fuel budget so a divergent loop can't hang the editor; make
  `f(null)` residualize as code that throws at runtime rather than throwing during
  expansion; guard `-0`, `NaN`, `Infinity`, and float artifacts (`0.1 + 0.2`).

### Phase 5 — Output quality
- Preserve comments and formatting instead of flattening everything onto one line.
- Run the result through the project's Prettier and ESLint.
- Preserve generics and `as const` so relocation doesn't introduce type errors.
- Add golden-text snapshots once formatting is deliberate (they answer "is it
  readable" — the behavioral specs already answer "is it correct").

### Phase 6 — UX
- Ship the keybindings the README advertises.
- A preview / diff pane showing the change and any warnings before applying.
- **Report which behavior ran** ("Inlined function body", "Evaluated `.map`").
  `runInline`'s result already carries a `behavior` tag for this.
- **Detect no-ops:** when a behavior's output equals its input (e.g. folding a method
  call), say "nothing to inline here" instead of applying a silent no-op edit.
- Diagnostics that name the exact blocking node, replacing the generic "too complex".
- Fix `publisher`; delete `schema.json` and `vscode-test`; reconcile the READMEs and
  `TODO.md` into one story.

### Maybe later
- **Power-user overrides:** if cursor placement proves too coarse (e.g. a user wants to
  fold `f(x)`'s arguments rather than relocate it), add hidden per-behavior commands or
  a command argument like `{ mode: "fold" }`. Don't build this until there's demand.

## Testing

Two layers, kept separate:

- **`tests/spec/` — behavioral specs for the relocation engine.** Each spec is a
  runnable fixture with the cursor marked on one call; the runner expands it, runs the
  program before and after, and checks the effect trace, the thrown/returned
  disposition, and the result are identical. This is the core promise: relocation
  doesn't change meaning. A spec marked `"known": "broken"` asserts the tool *fails*
  today and shouts when a fix makes it pass — so fixing a bug means deleting its
  `known: broken` flag. These specs test the engine directly; **do not** route them
  through the command dispatcher, or a no-op could hide a real relocation bug. See
  `tests/spec/README.md`.
- **`tests/inline.integration.test.ts` — the command.** Drives the real handler with a
  mocked editor and checks the cursor lands on the right behavior.

`pnpm typecheck` (over `src` and `tests`) and `pnpm test` should both stay green. Spec
fixtures under `tests/spec/cases` are excluded from typecheck and lint — several are
intentionally ill-typed inputs to the tool.

## Open questions

- **Unroll cap:** what limit, and configurable how? Probably both a statement-count and
  an iteration-count.
- **Other file types:** should `.mts` / `.cts` / plain JS be supported? The extension
  activates only for `typescript` and `typescriptreact` today.
- **Surfacing warnings:** the "emit and warn" case needs somewhere to put warnings —
  `showWarningMessage` now, the preview pane later.
