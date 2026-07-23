// Division by zero yields Infinity; the evaluator must not fold such cases
// to a numeric literal because the printer cannot represent Infinity.
// The expression must be left unfolded.

const divByZero = (a: number) => a / 0;

export const run = () => /*<*/ divByZero(5) /*>*/;
