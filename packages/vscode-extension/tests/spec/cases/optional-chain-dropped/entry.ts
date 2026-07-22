// Optional chaining must survive relocation.
//
// The property-access branch rebuilds with `factory.createPropertyAccessExpression`,
// which is a *create*, not an *update* - so it constructs a fresh node with no
// `questionDotToken`. `o?.b` becomes `o.b`, which throws instead of
// short-circuiting to undefined.
//
// It only fires when the object subexpression actually changes, i.e. when a
// parameter was substituted into it - which is every interesting case.

const pick = (o: { b: number } | null) => o?.b;

const nothing = null;

export const run = () => /*<*/ pick(nothing) /*>*/;
