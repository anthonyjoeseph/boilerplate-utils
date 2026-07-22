// Any constant fold that produces a negative number used to throw a
// TypeScript Debug Failure:
//
//   "Negative numbers should be created in combination with
//    createPrefixUnaryExpression"
//
// The AST has no negative numeric literal - only a unary minus applied to a
// positive one - so `factory.createNumericLiteral(-1)` asserts. This hit every
// subtraction that crosses zero, every `-a`, and every multiply or divide by a
// negative constant, which is a large share of real arithmetic.

const sub = (a: number, b: number) => a - b;

export const run = () => /*<*/ sub(1, 2) /*>*/;
