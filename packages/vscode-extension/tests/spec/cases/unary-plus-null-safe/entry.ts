// Unary `+` applied to `null` evaluates to `NaN` in JavaScript — the evaluator
// must not throw; it should leave the expression unfolded instead.

const toNum = (x: null) => +x;

export const run = () => /*<*/ toNum(null) /*>*/;
