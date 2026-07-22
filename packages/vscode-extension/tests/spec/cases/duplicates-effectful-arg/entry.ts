// The parameter `a` is used twice, so blind substitution duplicates the
// argument *expression* and evaluates `next()` twice.

const dbl = (a: number) => a + a;

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

export const run = () => /*<*/ dbl($("next", next())) /*>*/;
