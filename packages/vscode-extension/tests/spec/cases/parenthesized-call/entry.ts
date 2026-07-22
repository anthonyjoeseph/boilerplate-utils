// A call of the form (f)(args) is rejected because the callee is a
// ParenthesizedExpression, not a bare Identifier.

const inc = (n: number) => n + 1;

export const run = () => /*<*/ (inc)(5) /*>*/;
