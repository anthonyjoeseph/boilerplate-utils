// A function whose body has a throw on one code path is refused as
// "too complex" even when the called path never reaches the throw.

const safe = (x: number) => {
  if (x < 0) throw new Error("negative");
  return x * 2;
};

export const run = () => /*<*/ safe(5) /*>*/;
