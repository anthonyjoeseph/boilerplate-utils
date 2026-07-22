// The `&&` operator is not in the set of foldable binary operators, so a
// condition like `a && b` never reduces to a boolean even when both operands
// are statically known. The if/else collapse is therefore refused.

const fn = (a: boolean, b: boolean) => { if (a && b) return "both"; else return "not both"; };

export const run = () => /*<*/ fn(true, true) /*>*/;
