# Behavioral specs

A spec is a small, **runnable** TypeScript program with a cursor marker on one
call. The runner expands that call, then runs the program **before and after**
and compares what it did.

That comparison is the point. A golden-text test says the output looks like it
did last week. A spec says the expansion did not change the meaning of the code
— which is the actual promise this extension makes, and one of the few promises
that can be checked mechanically rather than reviewed by eye.

## Adding one

Create a directory under `cases/`. No registration step.

```
cases/my-case/
  entry.ts      # required - must export `run`, and carry a cursor marker
  helper.ts     # optional siblings, resolved by relative import
  spec.json     # optional
```

```ts
// cases/my-case/entry.ts
const addTwo = (a: number) => a + 2;

export const run = () => /*<*/ addTwo(3) /*>*/;
```

**Markers.** `/*<*/expr/*>*/` selects a range; `/*|*/` places an empty cursor,
which is what a user actually has when they invoke the command without
selecting. Whitespace padding inside the markers is trimmed, so the fixture can
stay readable.

**`run`** is called and its result awaited. Fixtures are hermetic: only relative
imports resolve, so a spec can never depend on `node_modules`.

## Observing effects

A global `$` records evaluation. `$(label, value)` notes that `label` was
reached and returns `value` untouched:

```ts
export const run = () => /*<*/ dbl($("next", next())) /*>*/;
```

This is what catches an expansion that duplicates or drops an argument — the
returned value can easily come out the same while the *number of evaluations*
changes. `$.note(label, value)` records a value without being in the way.

`Math.random` is a fixed sequence and the clock is frozen, so a fixture may use
either and still compare cleanly.

## What counts as equivalent

All three must match between the two runs:

1. **Effect trace** — same labels, same order, same repeat counts.
2. **Disposition** — returned vs. threw. A spec must not turn one into the other.
3. **Result** — the structural encoding of the value.

The encoder distinguishes everything a naive deep-equal misses: `-0` vs `0`,
`NaN`, `undefined` vs an absent key, sparse array holes, key insertion order,
bigints, `Map`/`Set` ordering — and **reference sharing**. Sharing is encoded
positionally (`#1{...}` on first reach, `#1` on every later reach), so an
expansion that replaces a shared reference with a fresh literal is caught:
`{ a: xs, b: xs }` and `{ a: [1,2], b: [1,2] }` do not encode the same.

## spec.json

```jsonc
{
  "entry": "entry.tsx",       // default "entry.ts"
  "expect": "refuse",         // default "equivalent"
  "errorIncludes": "...",     // required substring of the diagnostic
  "known": "broken",          // see below
  "reason": "..."             // shown in the test name
}
```

## `known: broken`

Marks a spec the tool does not satisfy yet. The runner then asserts the spec
**fails**, and reports loudly the moment it starts passing:

```
"duplicates-effectful-arg" now passes. Remove `"known": "broken"` from its spec.json.
```

So the known-broken list is executable rather than prose in a TODO, the suite
stays green while bugs are open, and a fix cannot land silently.

It earns its keep in the other direction too. Two specs seeded from the roadmap
passed immediately, which meant the bug hypothesis was wrong for that shape —
one of them turned out to be safe only by accident, and is now a normal passing
spec (`mutated-const-array-not-folded`) guarding against a future "improvement"
that would break it.

### Auditing the known-broken list

`known: broken` passes when the spec fails for **any** reason — including a malformed
fixture or an unrelated crash. So a spec can look like it is tracking a bug while
actually testing nothing. Audit periodically by removing every marker at once and
reading the real diagnostics:

```bash
# strip every "known" flag, run, restore
python3 - <<'EOF'
import json, pathlib, shutil
for d in pathlib.Path("tests/spec/cases").iterdir():
    f = d / "spec.json"
    if f.exists() and json.loads(f.read_text()).get("known") == "broken":
        shutil.copy(f, d / "spec.json.bak")
        cfg = json.loads(f.read_text()); cfg.pop("known"); f.write_text(json.dumps(cfg))
EOF
npx vitest run tests/spec 2>&1 | grep "→ "
# then restore from the .bak files
```

Compare each diagnostic against that spec's stated `reason`. This is how
`negative-number-not-simple-literal` was found to be failing on an unrelated crash in
the numeric fold rather than on the classification bug it described — the crash was
severe, common, and completely hidden by the marker.

## Reading a failure

```
effect trace diverged - effect #2: before (nothing) / after eval next

before:
  status  returned
  value   2
  effects
    eval next
after:
  status  returned
  value   3
  effects
    eval next
    eval next
```

## Layout

| file | role |
| --- | --- |
| `observe.ts` | effect recorder and the structural encoder |
| `sandbox.ts` | transpile + CommonJS loader + `vm` execution |
| `runSpec.ts` | marker stripping, edit application, comparison |
| `corpus.ts` | loads `cases/` from disk |
| `spec.test.ts` | vitest adapter — the only framework-aware file |

`runSpec.ts` is framework-agnostic on purpose: the jest-to-vitest move touched
`spec.test.ts` alone.

One deliberate limitation: `applyExpansion` is the *idealised* applier. It
replaces the call and adds missing imports at the top of the file, rather than
reproducing the quirks of the vscode handler's textual insertion. A spec is
about the transformation; the handler's insertion logic needs its own unit
tests.
