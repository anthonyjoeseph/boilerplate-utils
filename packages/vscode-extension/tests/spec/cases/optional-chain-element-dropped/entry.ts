// Same defect on the element-access branch: `factory.createElementAccessExpression`
// drops the `questionDotToken`, so `a?.[0]` becomes `a[0]`.

const at = (a: number[] | null) => a?.[0];

const nothing = null;

export const run = () => /*<*/ at(nothing) /*>*/;
