// `undefined` is an Identifier in the TypeScript AST, not a literal, so it
// is not recognized as a simple literal. A switch case value of `undefined`
// causes the expansion to be refused.

const check = (x: number | undefined) => {
  switch (x) {
    case undefined:
      return "undef";
    default:
      return "num";
  }
};

export const run = () => /*<*/ check(undefined) /*>*/;
