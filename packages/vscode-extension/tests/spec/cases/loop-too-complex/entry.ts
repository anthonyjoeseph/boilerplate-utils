// A function whose body contains a loop is refused as "too complex".

const sumTo = (n: number) => {
  let s = 0;
  for (let i = 1; i <= n; i++) s += i;
  return s;
};

export const run = () => /*<*/ sumTo(4) /*>*/;
