// Negative numbers like -1 parse as PrefixUnaryExpression(-, 1), not as a
// NumericLiteral, so they are not recognized as simple literals. A switch
// discriminant of -1 causes the expansion to be refused.

const classify = (n: number) => {
  switch (n) {
    case -1:
      return "minus one";
    case 0:
      return "zero";
    default:
      return "other";
  }
};

export const run = () => /*<*/ classify(-1) /*>*/;
