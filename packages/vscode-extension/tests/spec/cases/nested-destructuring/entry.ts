// Nested binding patterns (e.g. `{ a: { b } }`) are not supported. The
// inliner checks `ts.isIdentifier(element.name)` for each destructuring
// element; a nested pattern fails that check and the expansion is refused.

const fn = ({ a: { b } }: { a: { b: number } }) => b + 1;

export const run = () => /*<*/ fn({ a: { b: 5 } }) /*>*/;
