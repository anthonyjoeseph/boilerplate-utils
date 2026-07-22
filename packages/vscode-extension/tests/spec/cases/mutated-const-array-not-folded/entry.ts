// A guard, not a bug report.
//
// `xs` is `const`, but a const binding is not a frozen value - it is mutated
// before the call. Folding the spread would bake in the stale contents and
// silently change the result.
//
// Today this is safe by accident rather than by design: folding consults an
// environment keyed by parameter name, and substitution has already rewritten
// `a` to `xs`, which that environment knows nothing about. So the spread
// survives as `[...xs]`.
//
// This spec exists so that adding real constant propagation without escape
// analysis fails loudly here instead of quietly changing behavior.

const xs = [1, 2];

const clone = (a: number[]) => [...a];

export const run = () => {
  xs.push(3);
  return /*<*/ clone(xs) /*>*/;
};
