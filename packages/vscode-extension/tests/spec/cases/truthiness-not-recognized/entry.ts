// The if/else collapse only accepts literal `true` or `false` as condition
// values. A numeric 0, which is falsy at runtime, is not recognized, so the
// expansion is refused even though the body is a single if/else statement.

const count = 0;
const describe = (n: number) => { if (n) return "some"; else return "none"; };

export const run = () => /*<*/ describe(count) /*>*/;
