// `==` is folded as if it were `===`, so a loose comparison that is true at
// runtime folds to `false`.
//
// The argument has to be a literal at the call site: folding consults an
// environment keyed by parameter name, but substitution has already replaced
// the parameter with the caller's own expression, so a `const` argument never
// reaches the evaluator.

const isOne = (v: string | number) => v == 1;

export const run = () => /*<*/ isOne("1") /*>*/;
