// `ns` is used twice, so substituting the array literal would evaluate every
// effectful argument twice. The IIFE fallback binds it once instead.

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

const joined = (...ns: number[]) => ns.concat(ns);

export const run = () => /*<*/ joined($("next", next()), 10) /*>*/;
