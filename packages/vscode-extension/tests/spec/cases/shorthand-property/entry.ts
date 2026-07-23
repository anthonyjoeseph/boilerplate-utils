// A shorthand property assignment `{ x }` is syntactic sugar for `{ x: x }`.
// When `x` is a parameter, the value side must be substituted with the
// caller's argument while the key stays as the identifier name.

const wrap = (value: number) => ({ value });

export const run = () => /*<*/ wrap(42) /*>*/;
