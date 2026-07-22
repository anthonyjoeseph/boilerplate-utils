// The unary-minus fold path, distinct from the binary one - both sites called
// createNumericLiteral directly and both asserted on a negative result.

const neg = (a: number) => -a;

export const run = () => /*<*/ neg(3) /*>*/;
