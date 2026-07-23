// Comments inside a function body should survive inlining when the body is
// too complex to reduce to a single expression (IIFE path).

const double = (a: number) => {
  // double the value
  const x = a * 2;
  return x;
};

export const run = () => /*<*/ double(5) /*>*/;
