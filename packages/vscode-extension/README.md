# Smart Inline Function

A VS Code extension that expands a TypeScript call at the cursor — inlining the
function body, evaluating a `.map()` or `Object.fromEntries()`, or folding a
constant expression.

## Usage

Place the cursor on an expression and run **Refactor: Smart Inline**
(`Cmd+Alt+N` on macOS, `Ctrl+Alt+N` on Windows/Linux), or open the Command
Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for "Smart Inline".

The extension picks the right behavior based on what the cursor is on:

| Cursor is on… | Result |
|---|---|
| `Object.fromEntries(...)` | Evaluates to an object literal |
| `.map(...)` | Evaluates to an array literal |
| A plain function call `f(x)` | Inlines the function body |
| Any other expression | Constant-folds the expression |

## What it does

**Relocation** (`f(x)` → body with arguments substituted) copies the function
body to the call site and rewrites parameters to the caller's arguments.
Impure code is fine — it is copied, not executed. Extra imports needed by the
body are added automatically.

**Collapse** (constant folding, branch elimination) runs over the result as a
best-effort second pass. All-or-nothing per construct: if a construct can't be
fully simplified, it is left exactly as written.

## Limitations

- Some destructuring shapes (nested patterns, defaults, rest elements) are not
  yet supported. Rest parameters are: they bind to an array literal of the
  arguments they swallow.
- A spread argument (`f(...xs)`) is only supported where it lands in a rest
  parameter; against positional parameters it hides how many values it carries.
- Multi-statement bodies that can't reduce to a single expression use an IIFE
  (`((params) => body)(args)`), which preserves exact semantics.
- A generic callee's type parameters are resolved the way TypeScript resolves
  them: to the explicit type argument, or - when the parameter appears in no
  parameter annotation and so has nothing to infer from - to its default,
  constraint, or `unknown`. One that IS inferred from the arguments needs a
  checker to pin down, so the expansion keeps the arrow that declares it
  (`(<T>(xs: T[]) => xs[0] as T)(xs)`).
- Imports the body needs are pointed at the best specifier available from the
  caller. A relative import inside an npm package is translated to the form that
  package publishes - `../util/args` inside rxjs becomes
  `rxjs/internal/util/args` - and checked against the caller's own module
  resolution, which honors its tsconfig and the package's `exports` map.
- An import that does not resolve (a package you have not installed, a module
  its package does not publish) is still added, in the form worth having rather
  than a reach-around like `./node_modules/<pkg>/src/...`, and reported in a
  warning. Installing a dependency is your call, not the extension's.
- Method calls (`obj.f()`), constructor calls (`new F()`), and namespace calls
  (`ns.f()`) are not yet relocated — they route to the fold pass instead.

## Requirements

TypeScript or TSX file open in the editor (`typescript` / `typescriptreact`
language mode).
