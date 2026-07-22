// Defaults inside destructuring patterns (e.g. `{ a = 5 }`) are not
// supported. The inliner checks `element.initializer` and returns undefined
// when it is set, refusing the expansion.

const fn = ({ a = 5 }: { a?: number }) => a * 2;

export const run = () => /*<*/ fn({}) /*>*/;
