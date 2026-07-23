// The `%` (remainder) operator on two literal numbers should fold to a literal.

const rem = (a: number, b: number) => a % b;

export const run = () => /*<*/ rem(10, 3) /*>*/;
