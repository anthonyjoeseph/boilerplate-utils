// The `**` (exponentiation) operator on two literal numbers should fold to a literal.

const pow = (base: number, exp: number) => base ** exp;

export const run = () => /*<*/ pow(2, 10) /*>*/;
