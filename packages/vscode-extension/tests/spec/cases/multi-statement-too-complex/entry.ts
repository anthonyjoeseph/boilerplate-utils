// A function with a single local const followed by a return is refused as
// "too complex" even though it is straightforward to inline.

const double = (a: number) => {
  const x = a * 2;
  return x;
};

export const run = () => /*<*/ double(5) /*>*/;
