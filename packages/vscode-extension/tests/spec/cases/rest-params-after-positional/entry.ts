// Parameters before the rest one keep their positional binding; the rest
// parameter takes only what is left over.

const tail = (first: number, ...rest: number[]) => first * 100 + rest.length;

export const run = () => /*<*/ tail(1, 2, 3) /*>*/;
