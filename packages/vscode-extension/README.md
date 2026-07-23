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

- Rest parameters (`...args`) and some destructuring shapes are not yet supported.
- Multi-statement bodies that can't reduce to a single expression use an IIFE
  (`((params) => body)(args)`), which preserves exact semantics.
- Method calls (`obj.f()`), constructor calls (`new F()`), and namespace calls
  (`ns.f()`) are not yet relocated — they route to the fold pass instead.

## Requirements

TypeScript or TSX file open in the editor (`typescript` / `typescriptreact`
language mode).
