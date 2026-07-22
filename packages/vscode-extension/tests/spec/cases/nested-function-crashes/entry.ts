// Any body containing a nested function or arrow throws:
//   "Cannot read properties of undefined (reading 'updateArrowFunction')"
//
// `substituteAndSimplifyExpression` falls back to `ts.visitEachChild` using a
// hand-rolled `nullTransformationContext`, which does not supply a node
// factory. Every callback-taking idiom - .map, .filter, .reduce - lands here,
// so this blocks most real functions.

const scale = (a: number) => [1, 2].map((y) => y * a);

export const run = () => /*<*/ scale(7) /*>*/;
